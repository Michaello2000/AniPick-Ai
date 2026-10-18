import { describe, expect, it } from 'vitest';
import { normalizeAniList, normalizeMal, personalScore } from '../server/normalize.js';
import { anilistEntry, malEntry } from './fixtures.js';

describe('rating preservation', () => {
  it('preserves unrated entries as null', () => {
    expect(personalScore(0, 'POINT_10')).toBeNull();
    expect(personalScore(null, 'POINT_100')).toBeNull();
  });
  it.each([['POINT_100', 85, 100, 85], ['POINT_10', 8, 10, 80], ['POINT_10_DECIMAL', 8.5, 10, 85], ['POINT_5', 4, 5, 80], ['POINT_3', 2, 3, 60]] as const)('preserves %s source values', (format, value, scale, normalized) => {
    expect(personalScore(value, format, normalized)).toEqual({ value, format, scale, normalized100: normalized });
  });
  it('uses AniList server conversion for smiley ratings', () => {
    expect(normalizeAniList({ ...anilistEntry(1, 2), normalizedScore: 60 }, 'POINT_3').personalScore?.normalized100).toBe(60);
  });
});

describe('normalization', () => {
  it('keeps user and community scores distinct, preserving source IDs and dates', () => {
    const anime = normalizeAniList(anilistEntry(1, 9, 'COMPLETED'), 'POINT_10');
    expect(anime.personalScore?.value).toBe(9);
    expect(anime.communityScore).toEqual({ value: 82, scale: 100 });
    expect(anime.sourceIds).toEqual({ anilist: 1, mal: 101 });
    expect(anime.entryCreatedAt).toBe('2023-11-14T22:13:20.000Z');
  });
  it.each([['CURRENT', 'watching'], ['PLANNING', 'planning'], ['COMPLETED', 'completed'], ['PAUSED', 'paused'], ['DROPPED', 'dropped'], ['REPEATING', 'watching']] as const)('maps AniList %s', (source, status) => {
    expect(normalizeAniList(anilistEntry(1, 0, source), 'POINT_10').status).toBe(status);
  });
  it.each([['watching', 'watching'], ['completed', 'completed'], ['on_hold', 'paused'], ['dropped', 'dropped'], ['plan_to_watch', 'planning']] as const)('maps MAL %s', (source, status) => {
    expect(normalizeMal(malEntry(1, 0, source)).status).toBe(status);
  });
  it('retains MAL personal scores and avoids invented creation dates', () => {
    const anime = normalizeMal(malEntry(1, 7));
    expect(anime.personalScore).toMatchObject({ value: 7, scale: 10, normalized100: 70 });
    expect(anime.entryCreatedAt).toBeNull();
  });
  it('keeps absent metadata unknown and rejects unrecognized statuses', () => {
    expect(normalizeMal({ node: { id: 1, title: 'Minimal' }, list_status: { status: 'plan_to_watch' } }).episodes).toBeNull();
    expect(() => normalizeMal(malEntry(1, 0, 'new_status'))).toThrow();
  });
  it('strips markup and unsafe poster URLs', () => {
    const anime = normalizeAniList({ ...anilistEntry(1), media: { id: 1, title: { romaji: 'A' }, description: '<b>A story.</b><br>Another line', coverImage: { large: 'javascript:alert(1)' } } }, 'POINT_10');
    expect(anime.synopsis).toBe('A story.\nAnother line');
    expect(anime.poster).toBeNull();
  });
});
