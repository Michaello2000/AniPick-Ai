import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LibraryStore } from '../server/storage.js';
import { entry } from './fixtures.js';

describe('durable library snapshots', () => {
  it('removes one saved library durably, clears unscoped AI caches, and preserves other libraries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'anipick-remove-'));
    const path = join(directory, 'watchlist.sqlite');
    let store = new LibraryStore(path);
    try {
      const first = store.save('anilist', 'First', [entry(1)]);
      const second = store.save('anilist', 'Second', [entry(2)]);
      store.saveAiCache('profile', 'profile', { summary: 'Personal taste' }, 60000);
      expect(store.remove(first.id)).toBe(true);
      expect(store.remove(first.id)).toBe(false);
      expect(store.getAiCache('profile', 'profile')).toBeNull();
      store.close();
      store = new LibraryStore(path);
      expect(store.get(first.id)).toBeNull();
      expect(store.get(second.id)).toEqual(second);
      expect(store.list().map(library => library.id)).toEqual([second.id]);
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('survives reopening the database and keeps accounts separate', () => {
    const directory = mkdtempSync(join(tmpdir(), 'anipick-test-'));
    try {
      const path = join(directory, 'watchlist.sqlite');
      const store = new LibraryStore(path);
      const a = store.save('anilist', 'Viewer', [entry(1)]);
      store.save('mal', 'Viewer', [{ ...entry(2), id: 'mal:2', provider: 'mal', sourceIds: { anilist: null, mal: 2 } }]);
      store.saveAiCache('profile-key', 'profile', { summary: 'A persisted test profile' }, 60000);
      store.saveMalClientId('test-persisted-client-id');
      store.saveTikTok('anilist:1', { videoId: '6718335390845095173', creator: 'scout2015', url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' });
      store.saveTrailer('anilist:1', { trailer: { videoId: 'Abc_def-123', source: 'AniList' }, checkedAt: new Date().toISOString(), warnings: [] });
      store.close();
      const reopened = new LibraryStore(path);
      expect(reopened.get(a.id)?.entries[0]?.id).toBe('anilist:1');
      expect(reopened.list()).toHaveLength(2);
      expect(reopened.getAiCache('profile-key', 'profile')).toEqual({ summary: 'A persisted test profile' });
      expect(reopened.getAiCache('profile-key', 'recommendation')).toBeNull();
      expect(reopened.getMalClientId()).toBe('test-persisted-client-id');
      expect(reopened.getTikToks('anilist:1')[0]?.videoId).toBe('6718335390845095173');
      expect(reopened.getTrailer('anilist:1')?.trailer?.videoId).toBe('Abc_def-123');
      reopened.save('anilist', 'VIEWER', [entry(3)]);
      expect(reopened.list()).toHaveLength(2);
      expect(reopened.get(a.id)?.entries[0]?.id).toBe('anilist:3');
      reopened.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('rejects an invalid replacement without erasing the previous snapshot', () => {
    const store = new LibraryStore(':memory:');
    try {
      const saved = store.save('anilist', 'Viewer', [entry(1)]);
      expect(() => store.save('anilist', 'Viewer', [{ ...entry(2), episodes: -1 }])).toThrow();
      expect(store.get(saved.id)?.entries[0]?.id).toBe('anilist:1');
    } finally { store.close(); }
  });
});
