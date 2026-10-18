import { describe, expect, it } from 'vitest';
import { TrailerService } from '../server/media.js';
import { MetadataService } from '../server/metadata.js';
import { LibraryStore } from '../server/storage.js';
import { UpstreamClient } from '../server/upstream.js';
import { entry } from './fixtures.js';

function setup(replies: unknown[]) {
  const store = new LibraryStore(':memory:');
  let calls = 0;
  const client = new UpstreamClient(async () => { calls++; const reply = replies.shift(); return reply instanceof Response ? reply : Response.json(reply); }, async () => {});
  return { store, client, service: new TrailerService(store, client, new MetadataService(store, client)), calls: () => calls };
}
describe('real-source trailer orchestration', () => {
  it('uses imported source IDs and durably caches on-demand AniList trailers', async () => {
    const { store, service, calls, client } = setup([{ data: { Media: { id: 1, trailer: { id: 'Abc_def-123', site: 'youtube' } } } }]);
    try {
      const [first, second] = await Promise.all([service.get(entry()), service.get(entry())]);
      expect(first).toEqual(second);
      expect(first.trailer?.source).toBe('AniList');
      expect((await new TrailerService(store, client, new MetadataService(store, client)).get(entry())).trailer?.videoId).toBe('Abc_def-123');
      expect(calls()).toBe(1);
      expect((await service.get({ ...entry(2), trailer: { videoId: 'Abc_def-123', source: 'AniList' } })).trailer?.videoId).toBe('Abc_def-123');
      expect(calls()).toBe(1);
    } finally { store.close(); }
  });
  it('returns an explicit no-trailer result without inventing an ID', async () => {
    const { store, service } = setup([{ data: { Media: { id: 1, trailer: null } } }]);
    try { expect((await service.get(entry())).trailer).toBeNull(); }
    finally { store.close(); }
  });
  it('uses Jikan trailer metadata for MAL entries and rejects mismatched source IDs', async () => {
    const { store, service } = setup([{ data: { mal_id: 1, trailer: { youtube_id: 'Abc_def-123' } } }, { data: { Media: { id: 999, trailer: { id: 'Abc_def-123', site: 'youtube' } } } }]);
    try {
      expect((await service.get({ ...entry(), id: 'mal:1', sourceIds: { anilist: null, mal: 1 } })).trailer?.source).toBe('Jikan / MyAnimeList');
      await expect(service.get(entry())).rejects.toThrow();
      expect(store.getTrailer('anilist:1')).toBeNull();
    } finally { store.close(); }
  });
  it('reports a Jikan failure without caching a false definitive absence', async () => {
    const { store, service } = setup([{ data: { Media: { id: 1, trailer: null } } }, new Response('', { status: 503 }), new Response('', { status: 503 }), new Response('', { status: 503 })]);
    try {
      const result = await service.get({ id: 'anilist:1', sourceIds: { anilist: 1, mal: 1 } });
      expect(result.trailer).toBeNull();
      expect(result.warnings.join(' ')).toContain('Jikan');
      expect(store.getTrailer('anilist:1')).toBeNull();
    } finally { store.close(); }
  });
  it('falls back to Jikan when AniList is unavailable and discloses the failed source', async () => {
    const { store, service, calls } = setup([new Response('', { status: 503 }), new Response('', { status: 503 }), new Response('', { status: 503 }), { data: { mal_id: 1, trailer: { youtube_id: 'Abc_def-123' } } }]);
    try {
      const result = await service.get({ id: 'anilist:1', sourceIds: { anilist: 1, mal: 1 } });
      expect(result.trailer?.source).toBe('Jikan / MyAnimeList');
      expect(result.warnings.join(' ')).toContain('AniList');
      expect(calls()).toBe(4);
    } finally { store.close(); }
  });
  it('expires both positive and negative trailer-cache entries', () => {
    const store = new LibraryStore(':memory:');
    try {
      store.saveTrailer('anilist:1', { trailer: null, checkedAt: '2020-01-01T00:00:00.000Z', warnings: [] });
      expect(store.getTrailer('anilist:1')).toBeNull();
      store.saveTrailer('anilist:1', { trailer: { videoId: 'Abc_def-123', source: 'AniList' }, checkedAt: '2020-01-01T00:00:00.000Z', warnings: [] });
      expect(store.getTrailer('anilist:1')).toBeNull();
    } finally { store.close(); }
  });
});
