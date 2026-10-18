import { describe, expect, it } from 'vitest';
import { filterAnime } from '../shared/filter.js';
import { entry } from './fixtures.js';

describe('backlog filters', () => {
  const entries = [entry(1, 12), entry(2, 13), entry(3, 24), entry(4, 25), entry(5, null), entry(6, 1, 'MOVIE')];
  it('defaults to planning and unrestricted length, including unknowns', () => {
    expect(filterAnime([...entries, { ...entry(7, 12), status: 'completed' }], {}).map(x => x.id)).toHaveLength(6);
  });
  it.each([['12', [1, 6]], ['24', [1, 2, 3, 6]], ['25', [4]], ['movie', [6]]] as const)('enforces %s boundaries and excludes unknown length', (length, ids) => {
    expect(filterAnime(entries, { length }).map(x => Number(x.id.split(':')[1]))).toEqual(ids);
  });
  it('searches alternate titles, filters genre, and sorts missing scores last', () => {
    const rows = [
      { ...entry(1, 12), title: 'Zulu', genres: ['Drama'], communityScore: null },
      { ...entry(2, 12), title: 'Alpha', genres: ['Drama'], titles: { english: 'Alternate', romaji: null, native: null, synonyms: [] }, communityScore: { value: 8, scale: 10 } },
    ];
    expect(filterAnime(rows, { search: 'alternate' }).map(x => x.id)).toEqual(['anilist:2']);
    expect(filterAnime(rows, { genre: 'Action' })).toEqual([]);
    expect(filterAnime(rows, { sort: 'score' }).map(x => x.id)).toEqual(['anilist:2', 'anilist:1']);
  });
  it('does not mutate the stored entries', () => {
    const rows = [entry(2, 12), entry(1, 12)];
    filterAnime(rows, { sort: 'title' });
    expect(rows[0]?.id).toBe('anilist:2');
  });
});
