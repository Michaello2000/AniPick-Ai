import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('import API setup and transport messages', () => {
  it.each([
    new Response('', { status: 500 }),
    new Response('<html>Vite frontend only</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  ])('explains a missing/misrouted API instead of exposing a JSON parser exception', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(api.import('anilist', 'Viewer')).rejects.toThrow(/pnpm dev/);
  });
  it('preserves actionable backend errors such as missing MAL configuration', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'MAL_NOT_CONFIGURED', message: 'Add MAL_CLIENT_ID to .env and restart.' } }, { status: 503 })));
    await expect(api.import('mal', 'Viewer')).rejects.toThrow('Add MAL_CLIENT_ID');
  });
  it('still validates successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'job', state: 'running', pages: 0, imported: 0, message: 'Connecting' })));
    expect(await api.import('anilist', 'Viewer')).toMatchObject({ id: 'job', state: 'running' });
  });
});
