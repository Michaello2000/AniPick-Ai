import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { LibraryStore } from '../server/storage.js';
import { UpstreamClient } from '../server/upstream.js';
import { malEntry } from './fixtures.js';

let store: LibraryStore | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((done, reject) => { server?.close(error => error ? reject(error) : done()); server?.closeAllConnections(); });
  store?.close(); server = undefined; store = undefined;
});
async function setup(replies: Response[]) {
  store = new LibraryStore(':memory:');
  const calls: { url: string; clientId: string | null }[] = [];
  const client = new UpstreamClient(async (url, init) => {
    calls.push({ url: String(url), clientId: new Headers(init?.headers).get('X-MAL-CLIENT-ID') });
    const reply = replies.shift();
    if (!reply) throw new Error('Unexpected request');
    return reply;
  }, async () => {});
  server = createApp({ store, client, malClientId: '', dev: true }).listen(0, '127.0.0.1');
  await new Promise<void>(done => server?.once('listening', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const base = `http://127.0.0.1:${address.port}`;
  const save = (clientId: string, origin?: string) => fetch(`${base}/api/settings/mal`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ clientId }) });
  return { base, calls, save };
}
describe('in-app MAL setup', () => {
  it('validates and saves a server-side client ID, then imports without restart or exposing it', async () => {
    const { base, calls, save } = await setup([Response.json({ id: 1 }), Response.json({ data: [malEntry(1, 9, 'completed')], paging: {} })]);
    const clientId = 'test-client-id-only';
    expect((await (await fetch(`${base}/api/health`)).json()).malConfigured).toBe(false);
    const response = await save(clientId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ malConfigured: true });
    expect(calls[0]).toEqual({ url: 'https://api.myanimelist.net/v2/anime/1?fields=id', clientId });
    const health = await (await fetch(`${base}/api/health`)).text();
    expect(health).not.toContain(clientId);
    expect(JSON.parse(health).malConfigured).toBe(true);
    const started = await fetch(`${base}/api/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'mal', username: 'Viewer' }) });
    expect(started.status).toBe(202);
    const { id } = await started.json();
    let state = 'running';
    for (let i = 0; i < 30 && state === 'running'; i++) {
      state = (await (await fetch(`${base}/api/imports/${id}`)).json()).state;
      if (state === 'running') await new Promise(done => setTimeout(done, 10));
    }
    expect(state).toBe('complete');
    expect(store?.get('mal:viewer')?.entries[0]?.personalScore?.value).toBe(9);
    expect(calls[1]?.clientId).toBe(clientId);
  });
  it('rejects invalid credentials, malformed input and external origins without saving them', async () => {
    const { calls, save } = await setup([new Response('', { status: 401 })]);
    expect((await save('too short!')).status).toBe(400);
    expect((await save('valid-format-id', 'https://evil.test')).status).toBe(403);
    expect((await save('AIza-test-google-key')).status).toBe(400);
    expect(calls).toHaveLength(0);
    const invalid = await save('invalid-client-id');
    expect(invalid.status).toBe(503);
    expect((await invalid.json()).error.code).toBe('PROVIDER_AUTH');
    expect(store?.getMalClientId()).toBeNull();
  });
});
