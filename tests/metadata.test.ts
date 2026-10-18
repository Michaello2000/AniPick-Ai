import { describe, expect, it } from 'vitest';
import { MetadataService } from '../server/metadata.js';
import { LibraryStore } from '../server/storage.js';
import { UpstreamClient } from '../server/upstream.js';
import { entry } from './fixtures.js';

describe('Jikan enrichment', () => {
  it('deduplicates concurrent reads and reuses durable metadata', async () => {
    const store = new LibraryStore(':memory:');
    let requests = 0;
    const client = new UpstreamClient(async () => {
      requests++;
      return Response.json({ data: { mal_id: 1, synopsis: '<b>Story</b>', genres: [{ name: 'Drama' }], themes: [{ name: 'Space' }], demographics: [] } });
    }, async () => {});
    try {
      const service = new MetadataService(store, client);
      const [first, second] = await Promise.all([service.get(1), service.get(1)]);
      expect(first).toEqual(second);
      expect(first.synopsis).toBe('Story');
      expect(first.tags).toEqual(['Space']);
      expect(await new MetadataService(store, client).get(1)).toEqual(first);
      expect(requests).toBe(1);
    } finally { store.close(); }
  });
  it('does not cache a mismatched ID or disturb the imported library', async () => {
    const store = new LibraryStore(':memory:');
    const saved = store.save('anilist', 'Viewer', [entry()]);
    try {
      const service = new MetadataService(store, new UpstreamClient(async () => Response.json({ data: { mal_id: 2 } }), async () => {}));
      await expect(service.get(1)).rejects.toThrow('different anime');
      expect(store.getMetadata(1)).toBeNull();
      expect(store.get(saved.id)?.entries[0]?.id).toBe('anilist:1');
    } finally { store.close(); }
  });
  it('rejects expired metadata so the next detail view refreshes it', () => {
    const store = new LibraryStore(':memory:');
    try {
      store.saveMetadata({ malId: 1, synopsis: null, genres: [], tags: [], source: 'Jikan / MyAnimeList', fetchedAt: '2020-01-01T00:00:00.000Z' });
      expect(store.getMetadata(1)).toBeNull();
    } finally { store.close(); }
  });
});
