import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { configureAi } from '../server/recommendations/config.js';
import { LibraryStore } from '../server/storage.js';
import { UpstreamClient } from '../server/upstream.js';
import { entry } from './fixtures.js';

const servers: Server[] = [];
const stores: LibraryStore[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); });
  for (const store of stores.splice(0)) store.close();
});
async function address(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>(done => server.once('listening', done));
  const value = server.address();
  if (!value || typeof value === 'string') throw new Error('No test port');
  return `http://127.0.0.1:${value.port}`;
}
async function setup() {
  let generations = 0;
  let forged = false;
  const localUrl = await address(createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'local-model-a' }, { id: 'local-model-b' }] })); return; }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
    const buffers: Buffer[] = [];
    for await (const part of req) buffers.push(Buffer.from(part));
    const body: { messages: { content: string }[] } = JSON.parse(Buffer.concat(buffers).toString());
    generations++;
    const profile = body.messages[0]?.content.includes('TASK: Analyze only');
    const output = profile ? { summary: 'Character drama recurs in your history.', likes: [{ pattern: 'Character drama', history_ids: ['anilist:1'] }], possible_dislikes: [], limitations: ['Sparse history limits confidence.'] }
      : { recommendations: [{ candidate_id: forged ? 'anilist:999' : 'anilist:2', reason: 'The drama connects to your completed history.', history_ids: ['anilist:1'], confidence: 'low', tradeoff: null }] };
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output), reasoning_content: 'Private reasoning' } }] }));
  }).listen(0, '127.0.0.1'));
  const store = new LibraryStore(':memory:');
  stores.push(store);
  const library = store.save('anilist', 'Viewer', [{ ...entry(1), status: 'completed', genres: ['Drama'] }, { ...entry(2), genres: ['Drama'] }]);
  const configuration = configureAi({ LOCAL_AI_BASE_URL: `${localUrl}/v1`, LOCAL_AI_MODEL: 'local-model-a' });
  const base = await address(createApp({ store, client: new UpstreamClient(), malClientId: '', ai: configuration, dev: true }).listen(0, '127.0.0.1'));
  const submit = (model = 'local-model-a', allowCloudProcessing = false, mode = 'local') => fetch(`${base}/api/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: library.id, preferences: { maxResults: 1 }, allowCloudProcessing, ai: { mode, ...(mode === 'local' ? { model } : {}) } }) });
  return { base, submit, store, library, generations: () => generations, forge: () => { forged = true; } };
}

describe('local HTTP integration with an injected inference server, not a real model', () => {
  it('allows local analysis without cloud consent, validates IDs and caches by selected model', async () => {
    const { base, submit, generations } = await setup();
    expect((await (await fetch(`${base}/api/ai/models`)).json()).models).toEqual(['local-model-a', 'local-model-b']);
    const response = await submit();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model).toBe('local-model-a');
    expect(body.recommendations[0].candidate_id).toBe('anilist:2');
    expect(JSON.stringify(body)).not.toContain('Private reasoning');
    expect((await (await submit()).json()).cached).toBe(true);
    expect(generations()).toBe(2);
    expect((await submit('local-model-b')).status).toBe(200);
    expect(generations()).toBe(4);
    const cloud = await submit('', false, 'cloud');
    expect(cloud.status).toBe(400);
    expect((await cloud.json()).error.code).toBe('CLOUD_CONSENT_REQUIRED');
    expect((await submit('', true, 'cloud')).status).toBe(503);
    expect(generations()).toBe(4);
  });
  it('never saves forged recommendations or falls back to Google when local inference fails', async () => {
    const { submit, forge, store, library, generations } = await setup();
    forge();
    const response = await submit();
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('AI_INVALID_RESPONSE');
    expect(generations()).toBe(3); // profile, invalid ranking, bounded repair
    expect(store.get(library.id)?.entries).toHaveLength(2);
    expect((await submit('invented')).status).toBe(503);
    expect(generations()).toBe(3);
  });
});

describe('local/cloud configuration', () => {
  it('retains Google configuration and isolates an unsafe local endpoint', () => {
    const config = configureAi({ GEMINI_API_KEY: 'test-key', LOCAL_AI_BASE_URL: 'http://evil.test/v1' });
    expect(config.status.configured).toBe(true);
    expect(config.status.mode).toBe('cloud');
    expect(config.local?.settings).toBeNull();
    expect(JSON.stringify(config.status)).not.toContain('test-key');
  });
  it('uses a separate local default model and a longer configured operation deadline', () => {
    const config = configureAi({ AI_PROVIDER: 'local', LOCAL_AI_MODEL: 'server-alias', LOCAL_AI_TIMEOUT_MS: '900000' });
    expect(config.status).toMatchObject({ configured: true, model: 'server-alias', mode: 'local', timeoutMs: 900000 });
    expect(config.cloud?.status.model).toBe('gemma-4-26b-a4b-it');
  });
  it('does not silently clamp invalid local timeouts', () => {
    expect(configureAi({ LOCAL_AI_TIMEOUT_MS: '999999999' }).local?.settings).toBeNull();
  });
});
