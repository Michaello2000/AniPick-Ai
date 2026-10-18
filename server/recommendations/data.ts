import { createHash } from 'node:crypto';
import { filterAnime } from '../../shared/filter.js';
import type { Anime, Library } from '../../shared/model.js';
import type { RecommendationPreferences } from '../../shared/recommendations.js';

export function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export function eligibleCandidates(entries: Anime[], preferences: RecommendationPreferences): Anime[] {
  return filterAnime(entries, { status: 'planning', length: preferences.length, genre: preferences.genre }).filter(anime => {
    const status = anime.airingStatus?.toUpperCase();
    if (preferences.airing === 'finished' && status !== 'FINISHED' && status !== 'FINISHED_AIRING') return false;
    if (preferences.airing === 'airing' && status !== 'RELEASING' && status !== 'CURRENTLY_AIRING') return false;
    if (preferences.airing === 'upcoming' && status !== 'NOT_YET_RELEASED' && status !== 'NOT_YET_AIRED') return false;
    if (preferences.englishDub === 'verified' && (!anime.englishDub?.available || !anime.englishDub.source.startsWith('https://'))) return false;
    return true;
  });
}

export function compactAnime(anime: Anime) {
  return {
    candidate_id: anime.id, title: anime.title.slice(0, 160), status: anime.status,
    personal_rating: anime.personalScore,
    genres: anime.genres.slice(0, 12).map(value => value.slice(0, 80)),
    tags: anime.tags.slice(0, 12).map(value => value.slice(0, 100)),
    description: anime.synopsis?.slice(0, 300) ?? null,
    format: anime.format, episodes: anime.episodes, airing_status: anime.airingStatus,
  };
}
export type ModelAnime = ReturnType<typeof compactAnime>;

function stableOrder(rows: Anime[]): Anime[] {
  return [...rows].sort((a, b) => fingerprint(a.id).localeCompare(fingerprint(b.id)) || a.id.localeCompare(b.id));
}
function balancedHistory(rows: Anime[]): Anime[] {
  const buckets = new Map<string, Anime[]>();
  for (const anime of stableOrder(rows)) {
    const score = anime.personalScore?.normalized100;
    const bucket = score === undefined ? `unrated:${anime.status}` : score >= 70 ? 'higher-rated' : score < 40 ? 'lower-rated' : 'middle-rated';
    const group = buckets.get(bucket) ?? [];
    group.push(anime); buckets.set(bucket, group);
  }
  const groups = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => group);
  const result: Anime[] = [];
  for (let index = 0; result.length < rows.length; index++) {
    for (const group of groups) { const anime = group[index]; if (anime) result.push(anime); }
  }
  return result;
}
function bounded(rows: Anime[], budget: number, limit: number): ModelAnime[] {
  const result: ModelAnime[] = [];
  for (const anime of rows) {
    if (result.length >= limit) break;
    const compact = compactAnime(anime);
    if (Buffer.byteLength(JSON.stringify([...result, compact])) > budget) break;
    result.push(compact);
  }
  return result;
}

export function prepareInput(library: Library, preferences: RecommendationPreferences) {
  const allHistory = library.entries.filter(anime => anime.status !== 'planning');
  const eligible = eligibleCandidates(library.entries, preferences);
  const history = bounded(balancedHistory(allHistory), 6000, 16);
  const candidateLimit = Math.min(24, 8 + preferences.maxResults * 4);
  const candidateBudget = 5000 + preferences.maxResults * 1000;
  const candidates = bounded(stableOrder(eligible), candidateBudget, candidateLimit);
  return {
    history, candidates,
    coverage: { historyTotal: allHistory.length, historySent: history.length, ratedHistorySent: history.filter(anime => anime.personal_rating !== null).length, eligibleTotal: eligible.length, candidatesSent: candidates.length },
  };
}
