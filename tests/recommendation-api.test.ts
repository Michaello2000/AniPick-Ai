import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { LibraryStore } from '../server/storage.js';
import { UpstreamClient } from '../server/upstream.js';
import { GoogleRecommendationProvider } from '../server/recommendations/google.js';
import { entry } from './fixtures.js';

const resources: { server: Server; store: LibraryStore }[] = [];
afterEach(async () => {
  for (const { server, store } of resources.splice(0)) {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    store.close();
  }
});
const profile = { summary: 'Drama appears in your history.', likes: [{ pattern: 'Drama', history_ids: ['anilist:1'] }], possible_dislikes: [], limitations: ['The history is sparse.'] };
const ranking = { recommendations: [{ candidate_id: 'anilist:2', reason: 'The dramatic themes align with your history.', history_ids: ['anilist:1'], confidence: 'low', tradeoff: null }] };
async function setup(failure = false) {
  const store = new LibraryStore(':memory:');
  const library = store.save('anilist', 'Viewer', [{ ...entry(1), status: 'completed', genres: ['Drama'] }, { ...entry(2), genres: ['Drama'] }]);
  let calls = 0;
  const provider = new GoogleRecommendationProvider({ apiKey: 'test-server-secret', model: 'gemma-4-26b-a4b-it', fetcher: async (_url, init) => {
    if (failure) return new Response('test-server-secret', { status: 429, headers: { 'Retry-After': '60' } });
    if (init?.method !== 'POST') return Response.json({ name: 'models/gemma-4-26b-a4b-it', supportedGenerationMethods: ['generateContent'] });
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(calls++ === 0 ? profile : ranking) }] } }] });
  } });
  const server = createApp({ store, client: new UpstreamClient(), malClientId: '', dev: true, ai: { provider, status: { configured: true, provider: provider.provider, model: provider.model, message: 'Configured' } } }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  resources.push({ server, store });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const base = `http://127.0.0.1:${address.port}`;
  const submit = () => fetch(`${base}/api/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: library.id, preferences: {}, allowCloudProcessing: true }) });
  return { base, submit, calls: () => calls };
}

describe('recommendation HTTP boundary', () => {
  it('returns source-grounded, cached results through the real adapter without exposing the key', async () => {
    const { base, submit, calls } = await setup();
    const status = await (await fetch(`${base}/api/ai/status`)).text();
    expect(status).not.toContain('test-server-secret');
    const response = await submit();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recommendations[0].candidate_id).toBe('anilist:2');
    expect(body.coverage.historySent).toBe(1);
    expect((await (await submit()).json()).cached).toBe(true);
    expect(calls()).toBe(2);
    expect(JSON.stringify(body)).not.toContain('test-server-secret');
  });
  it('surfaces retry timing and sanitizes provider failure bodies', async () => {
    const { submit } = await setup(true);
    const response = await submit();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    const text = await response.text();
    expect(text).toContain('AI_RATE_LIMITED');
    expect(text).not.toContain('test-server-secret');
  });
});
