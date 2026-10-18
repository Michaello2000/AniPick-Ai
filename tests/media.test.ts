import { describe, expect, it } from 'vitest';
import { parseTikTokUrl, youtubeTrailer, youtubeSearch, tiktokSearch, playerUrl } from '../shared/media.js';
import { normalizeAniList } from '../server/normalize.js';
import { LibraryStore } from '../server/storage.js';
import { anilistEntry, entry } from './fixtures.js';

describe('source trailers and community URLs', () => {
  it('normalizes valid source-provided YouTube IDs and refuses unsafe IDs', () => {
    expect(youtubeTrailer('Abc_def-123', 'AniList')).toEqual({ videoId: 'Abc_def-123', source: 'AniList' });
    for (const id of [null, '', '../embed', 'https://youtube.com/watch?v=Abc_def-123', '<script>']) expect(youtubeTrailer(id, 'AniList')).toBeNull();
    const source = anilistEntry(1);
    expect(normalizeAniList({ ...source, media: { ...source.media, trailer: { id: 'Abc_def-123', site: 'youtube' } } }, 'POINT_10').trailer?.videoId).toBe('Abc_def-123');
    expect(normalizeAniList({ ...source, media: { ...source.media, trailer: { id: 'Abc_def-123', site: 'dailymotion' } } }, 'POINT_10').trailer).toBeNull();
  });
  it('accepts canonical full TikTok video links and strips tracking', () => {
    expect(parseTikTokUrl(' https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1#x ')).toEqual({ videoId: '6718335390845095173', creator: 'scout2015', url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' });
    expect(parseTikTokUrl('https://m.tiktok.com/@viewer.name/video/6718335390845095173')?.creator).toBe('viewer.name');
    for (const url of ['http://www.tiktok.com/@a/video/6718335390845095173', 'https://www.tiktok.com.evil.test/@a/video/6718335390845095173', 'https://evil.test/?url=https://www.tiktok.com/@a/video/6718335390845095173', 'https://user:pass@www.tiktok.com/@a/video/6718335390845095173', 'https://www.tiktok.com:8443/@a/video/6718335390845095173', 'https://vm.tiktok.com/short', 'javascript:alert(1)', 'https://www.tiktok.com/@a/photo/6718335390845095173', 'https://www.tiktok.com/@a/video/123']) expect(parseTikTokUrl(url)).toBeNull();
  });
  it('uses fixed official player hosts with autoplay off and encoded search terms', () => {
    expect(playerUrl('youtube', 'Abc_def-123')).toBe('https://www.youtube-nocookie.com/embed/Abc_def-123?autoplay=0&playsinline=1&rel=0');
    expect(playerUrl('tiktok', '6718335390845095173')).toContain('https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0');
    expect(new URL(youtubeSearch('Title & #2')).searchParams.get('search_query')).toBe('Title & #2 official anime trailer');
    expect(new URL(tiktokSearch('Title & #2')).searchParams.get('q')).toContain('Title & #2');
  });
  it('saves community videos idempotently by stable anime ID and preserves them on list refresh', () => {
    const store = new LibraryStore(':memory:');
    try {
      store.save('anilist', 'Viewer', [entry()]);
      const video = parseTikTokUrl('https://www.tiktok.com/@scout2015/video/6718335390845095173');
      if (!video) throw new Error('Invalid fixture');
      store.saveTikTok('anilist:1', video);
      store.saveTikTok('anilist:1', video);
      store.save('anilist', 'Viewer', [entry()]);
      expect(store.getTikToks('anilist:1')).toHaveLength(1);
      expect(store.getTikToks('anilist:2')).toHaveLength(0);
      store.deleteTikTok('anilist:1', video.videoId);
      expect(store.getTikToks('anilist:1')).toHaveLength(0);
    } finally { store.close(); }
  });
});
