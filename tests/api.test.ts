import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { LibraryStore } from '../server/storage.js';
import { UpstreamClient } from '../server/upstream.js';
import { anilistEntry, entry } from './fixtures.js';

const resources: { server: Server; store: LibraryStore }[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { server, store } of resources.splice(0)) {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    store.close();
  }
});

async function setup(responses: unknown[] = []) {
  const store = new LibraryStore(':memory:');
  const client = new UpstreamClient(async () => {
    const response = responses.shift();
    if (response === undefined) throw new Error('Unexpected upstream request');
    return response instanceof Response ? response : Response.json(response);
  }, async () => {});
  const server = createApp({ store, client, malClientId: '', dev: true }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  resources.push({ server, store });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return { base: `http://127.0.0.1:${address.port}`, store };
}

describe('localhost API', () => {
  it('supports local community links and a real-source no-trailer response with strict URL validation', async () => {
    const { base, store } = await setup([{ data: { Media: { id: 1, trailer: null } } }]);
    store.save('anilist', 'Viewer', [entry()]);
    const root = `${base}/api/anime/anilist%3A1`;
    expect((await (await fetch(`${root}/trailer`)).json()).trailer).toBeNull();
    const save = (url: string, headers = {}) => fetch(`${root}/tiktok`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url }) });
    expect((await save('https://evil.test/@a/video/6718335390845095173')).status).toBe(400);
    expect((await save('https://www.tiktok.com/@a/video/6718335390845095173', { Origin: 'https://evil.test' })).status).toBe(403);
    const saved = await save('https://www.tiktok.com/@scout2015/video/6718335390845095173?tracking=remove');
    expect(saved.status).toBe(201);
    expect((await saved.json()).url).toBe('https://www.tiktok.com/@scout2015/video/6718335390845095173');
    expect((await (await fetch(`${root}/tiktok`)).json()).videos).toHaveLength(1);
    expect((await fetch(`${base}/api/anime/anilist%3A999/tiktok`)).status).toBe(404);
    expect((await (await fetch(`${root}/tiktok/6718335390845095173`, { method: 'DELETE' })).json()).removed).toBe(true);
    expect((await (await fetch(`${root}/tiktok`)).json()).videos).toHaveLength(0);
  });
  it('keeps browsing available without AI configuration and rejects unconsented requests', async () => {
    const { base, store } = await setup();
    const saved = store.save('anilist', 'Viewer', [entry()]);
    const context = await (await fetch(`${base}/api/libraries/${encodeURIComponent(saved.id)}/recommendation-context`)).json();
    expect(context.ai.configured).toBe(false);
    expect(context.totalPlanning).toBe(1);
    expect(context.verifiedDubs).toBe(0);
    const unconsented = await fetch(`${base}/api/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: saved.id, preferences: {}, allowCloudProcessing: false }) });
    expect(unconsented.status).toBe(400);
    const missingKey = await fetch(`${base}/api/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: saved.id, preferences: {}, allowCloudProcessing: true }) });
    expect(missingKey.status).toBe(503);
    expect((await missingKey.json()).error.code).toBe('AI_NOT_CONFIGURED');
    expect((await fetch(`${base}/api/libraries/${encodeURIComponent(saved.id)}`)).status).toBe(200);
  });
  it('validates input and blocks external-origin mutations', async () => {
    const { base } = await setup();
    const invalid = await fetch(`${base}/api/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'anilist', username: '../../bad' }) });
    expect(invalid.status).toBe(400);
    const crossOrigin = await fetch(`${base}/api/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://external.invalid' }, body: '{}' });
    expect(crossOrigin.status).toBe(403);
  });
  it('runs an import job through HTTP and persists the full result', async () => {
    const { base, store } = await setup([{ data: { User: { id: 1, name: 'Viewer', mediaListOptions: { scoreFormat: 'POINT_10' } } } }, { data: { MediaListCollection: { hasNextChunk: false, user: { id: 1, name: 'Viewer', mediaListOptions: { scoreFormat: 'POINT_10' } }, lists: [{ entries: [anilistEntry(1)] }] } } }]);
    const started = await fetch(`${base}/api/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'anilist', username: 'Viewer' }) });
    expect(started.status).toBe(202);
    const job: { id: string } = await started.json();
    let state: { state: string; libraryId?: string } = { state: 'running' };
    for (let i = 0; i < 50 && state.state === 'running'; i++) {
      state = await (await fetch(`${base}/api/imports/${job.id}`)).json();
      if (state.state === 'running') await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(state.state).toBe('complete');
    expect(store.get(state.libraryId ?? '')?.entries).toHaveLength(1);
    expect((await fetch(`${base}/api/libraries/${encodeURIComponent(state.libraryId ?? '')}`)).status).toBe(200);
  });
  it.each([
    [403, 'PRIVATE_LIST'], [404, 'USER_NOT_FOUND'], [503, 'UPSTREAM_UNAVAILABLE'],
  ])('preserves the complete saved library when refresh fails with HTTP %s', async (status, code) => {
    const { base, store } = await setup(Array.from({ length: 3 }, () => new Response('', { status })));
    const saved = store.save('anilist', 'Viewer', [entry()]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    const response = await fetch(`${base}/api/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'anilist', username: 'Viewer', refresh: true }) });
    expect(response.status).toBe(202);
    const job: { id: string } = await response.json();
    let result: { state: string; error?: { code: string } } = { state: 'running' };
    for (let i = 0; i < 50 && result.state === 'running'; i++) {
      result = await (await fetch(`${base}/api/imports/${job.id}`)).json();
      if (result.state === 'running') await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(result).toMatchObject({ state: 'failed', error: { code } });
    expect(await (await fetch(`${base}/api/libraries/${encodeURIComponent(saved.id)}`)).json()).toEqual(saved);
  });
  it('reports missing MAL configuration and leaves the saved list readable', async () => {
    const { base, store } = await setup();
    const saved = store.save('mal', 'Viewer', [{ ...entry(), provider: 'mal' }]);
    expect((await fetch(`${base}/api/libraries/${encodeURIComponent(saved.id)}`)).status).toBe(200);
    const response = await fetch(`${base}/api/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'mal', username: 'Other' }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('MAL_NOT_CONFIGURED');
  });
});
