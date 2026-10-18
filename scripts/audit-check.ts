import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { createApp } from '../server/app.js';
import { configureAi } from '../server/recommendations/config.js';
import { LibraryStore } from '../server/storage.js';
import { ApiError, UpstreamClient } from '../server/upstream.js';
import { filterAnime } from '../shared/filter.js';
import { librarySchema, progressSchema } from '../shared/model.js';
import { lengthSchema, recommendationResponseSchema, type RecommendationRequest } from '../shared/recommendations.js';

// Public account only, isolated database. --infer explicitly enables cloud analysis
// of this imported public sample; the user's saved database is never opened.
const infer = process.argv.includes('--infer');
const directory = resolve(mkdtempSync(join(tmpdir(), 'anipick-audit-')));
assert(directory.startsWith(resolve(tmpdir()) + sep));
const path = join(directory, 'audit.sqlite');
let store = new LibraryStore(path);
let server: Server | undefined;
const configuration = configureAi(process.env);
const rawScores = new Map<number, { score: number | null; normalizedScore: number | null; status: string }>();
const rawChunk = z.object({ data: z.object({ MediaListCollection: z.object({ lists: z.array(z.object({ entries: z.array(z.object({ media: z.object({ id: z.number() }), score: z.number().nullable(), normalizedScore: z.number().nullable(), status: z.string() })).nullable() })).nullable() }) }) });
const client = new UpstreamClient(async (url, init) => {
  const response = await fetch(url, init);
  if (response.ok && String(url) === 'https://graphql.anilist.co') {
    const parsed = rawChunk.safeParse(await response.clone().json());
    if (parsed.success) for (const list of parsed.data.data.MediaListCollection.lists ?? []) {
      for (const entry of list.entries ?? []) rawScores.set(entry.media.id, entry);
    }
  }
  return response;
});

async function start(): Promise<string> {
  server = createApp({ store, client, malClientId: process.env.MAL_CLIENT_ID?.trim() ?? '', ai: configuration }).listen(0, '127.0.0.1');
  await new Promise<void>((done, reject) => { server?.once('listening', done); server?.once('error', reject); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function stop(): Promise<void> {
  const running = server;
  if (running) {
    await new Promise<void>((done, reject) => { running.close(error => error ? reject(error) : done()); running.closeIdleConnections(); });
    server = undefined;
  }
}
async function post(base: string, route: string, data: unknown): Promise<Response> {
  return fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(130000) });
}
const failureSchema = z.object({ error: z.object({ code: z.string() }) });
async function successful(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) throw new ApiError(failureSchema.parse(body).error.code, 'Audit request failed.', response.status);
  return body;
}

try {
  let base = await start();
  assert.equal((await fetch(base)).status, 200, 'Production page requires pnpm build first.');
  const job = progressSchema.parse(await successful(await post(base, '/api/imports', { provider: 'anilist', username: 'derF' })));
  let progress = job;
  const deadline = Date.now() + 180000;
  while (progress.state === 'running' && Date.now() < deadline) {
    await delay(300);
    progress = progressSchema.parse(await successful(await fetch(`${base}/api/imports/${job.id}`)));
  }
  assert.equal(progress.state, 'complete', `Import did not complete: ${progress.error?.code ?? progress.state}`);
  assert(progress.libraryId);
  const libraryRoute = `/api/libraries/${encodeURIComponent(progress.libraryId)}`;
  const library = librarySchema.parse(await successful(await fetch(base + libraryRoute)));
  assert.equal(library.entries.length, rawScores.size);
  for (const anime of library.entries) {
    const raw = rawScores.get(anime.sourceIds.anilist ?? -1);
    assert(raw);
    assert.equal(anime.sourceStatus, raw.status);
    assert.equal(anime.personalScore?.value ?? null, raw.score ? raw.score : null);
    assert.equal(anime.personalScore?.normalized100 ?? null, raw.score ? raw.normalizedScore : null);
  }
  const completed = library.entries.filter(anime => anime.status === 'completed');
  assert(completed.some(anime => anime.personalScore));
  const planning = filterAnime(library.entries, {});
  assert(planning.length > 0);
  console.log('Live HTTP import / source score comparison: PASS', JSON.stringify({ pages: progress.pages, total: library.entries.length, completed: completed.length, planning: planning.length, rated: library.entries.filter(anime => anime.personalScore).length }));

  let cachedRequest: RecommendationRequest | undefined;
  let generated = 0;
  for (const length of lengthSchema.options) {
    const eligible = filterAnime(library.entries, { length });
    assert(eligible.length > 0, `Public account has no eligible titles for ${length}; cannot verify inference for this filter.`);
    console.log('Live imported eligibility: PASS', JSON.stringify({ length, eligible: eligible.length }));
    if (!infer) continue;
    // Separate filter requests to avoid bursts against the shared project quota.
    if (generated > 0) { console.log('Waiting 65 seconds before the next cloud request.'); await delay(65000); }
    const request: RecommendationRequest = { libraryId: library.id, preferences: { length, mood: 'any', genre: '', airing: 'any', englishDub: 'any', maxResults: 1 }, allowCloudProcessing: true };
    try {
      const result = recommendationResponseSchema.parse(await successful(await post(base, '/api/recommendations', request)));
      assert.equal(result.cached, false);
      assert(result.profile.summary.length > 0);
      assert.equal(result.recommendations.length, 1);
      assert.equal(result.coverage.eligibleTotal, eligible.length);
      const allowed = new Set(eligible.map(anime => anime.id));
      for (const pick of result.recommendations) assert(allowed.has(pick.candidate_id));
      assert.equal(result.profileCached, generated > 0);
      cachedRequest = request;
      generated++;
      console.log('Real AI profile / eligible recommendation: PASS', JSON.stringify({ length, model: result.model, profileCached: result.profileCached, coverage: result.coverage }));
    } catch (error) {
      console.error('Real inference: FAIL', JSON.stringify({ length, code: error instanceof ApiError ? error.code : 'AUDIT_ASSERTION_OR_SCHEMA' }));
      process.exitCode = 1;
      // Do not repeatedly submit after an inference/quota failure.
      break;
    }
  }

  await stop();
  store.close();
  store = new LibraryStore(path);
  base = await start();
  assert.deepEqual(librarySchema.parse(await successful(await fetch(base + libraryRoute))), library);
  if (cachedRequest) {
    const cached = recommendationResponseSchema.parse(await successful(await post(base, '/api/recommendations', cachedRequest)));
    assert.equal(cached.cached, true);
    assert.equal(cached.profileCached, true);
    console.log('AI cache after server/database restart: PASS');
  }
  console.log('Complete library / personal scores after server/database restart: PASS');
  if (!infer) console.log('Cloud inference: NOT RUN (use --infer to analyze the public audit sample).');
} catch (error) {
  console.error('Journey audit: FAIL', error instanceof ApiError ? error.code : error instanceof Error ? error.message : 'Unknown audit failure');
  process.exitCode = 1;
} finally {
  await stop();
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
