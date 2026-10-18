import type { Anime } from '../shared/model.js';

// Test fixtures are never included in the app or used as a live-data fallback.
export function entry(id = 1, episodes: number | null = 12, format = 'TV'): Anime {
  return {
    id: `anilist:${id}`, provider: 'anilist', sourceIds: { anilist: id, mal: null }, sourceEntryId: id,
    title: `Title ${id}`, titles: { english: null, romaji: null, native: null, synonyms: [] },
    poster: null, synopsis: null, genres: [], tags: [], format, episodes,
    airingStatus: null, year: null, communityScore: null, status: 'planning', sourceStatus: 'PLANNING',
    personalScore: null, progress: 0, repeat: 0, rewatching: false,
    entryCreatedAt: null, entryUpdatedAt: null, startedOn: null, completedOn: null,
  };
}

export function anilistEntry(id: number, score = 0, status = 'PLANNING') {
  return { id: id + 1000, status, score, normalizedScore: score * 10, progress: 0, repeat: 0, createdAt: 1700000000,
    media: { id, idMal: id + 100, title: { romaji: `Title ${id}` }, episodes: 12, format: 'TV', averageScore: 82 } };
}

export function malEntry(id: number, score = 0, status = 'plan_to_watch') {
  return { node: { id, title: `MAL ${id}`, num_episodes: 12, media_type: 'tv', mean: 8.3 }, list_status: { status, score, num_episodes_watched: 0, is_rewatching: false } };
}
