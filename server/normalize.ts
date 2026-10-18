import { z } from 'zod';
import { scoreFormatSchema, type Anime, type ScoreFormat, type ListStatus } from '../shared/model.js';
import { youtubeTrailer } from '../shared/media.js';

const text = z.string().nullish();
const number = z.number().nullish();
const names = z.array(z.object({ name: z.string() })).nullish();
const fuzzyDate = z.object({ year: number, month: number, day: number }).nullish();

export const anilistEntrySchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED', 'REPEATING']),
  score: number, normalizedScore: number, progress: number, repeat: number,
  createdAt: number, updatedAt: number, startedAt: fuzzyDate, completedAt: fuzzyDate,
  media: z.object({
    id: z.number().int().positive(), idMal: number,
    title: z.object({ romaji: text, english: text, native: text }),
    synonyms: z.array(z.string()).nullish(), coverImage: z.object({ large: text }).nullish(),
    description: text, genres: z.array(z.string()).nullish(),
    tags: z.array(z.object({ name: z.string(), isMediaSpoiler: z.boolean().nullish() })).nullish(),
    format: text, episodes: number, status: text, averageScore: number,
    startDate: fuzzyDate,
    trailer: z.object({ id: text, site: text }).nullish(),
  }),
});

export const malEntrySchema = z.object({
  node: z.object({
    id: z.number().int().positive(), title: z.string(), main_picture: z.object({ large: text, medium: text }).nullish(),
    alternative_titles: z.object({ en: text, ja: text, synonyms: z.array(z.string()).nullish() }).nullish(),
    synopsis: text, genres: names, media_type: text, num_episodes: number,
    status: text, mean: number, start_date: text,
  }),
  list_status: z.object({
    status: z.enum(['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch']),
    score: number, num_episodes_watched: number, is_rewatching: z.boolean().nullish(),
    num_times_rewatched: number, updated_at: text, start_date: text, finish_date: text,
  }),
});

export function plainText(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() || null;
}

export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    // Missing or malformed upstream images render the accessible cover fallback.
    return null;
  }
}

const scales: Record<ScoreFormat, number> = { POINT_100: 100, POINT_10: 10, POINT_10_DECIMAL: 10, POINT_5: 5, POINT_3: 3 };
export function personalScore(value: number | null | undefined, format: ScoreFormat, normalized?: number | null): Anime['personalScore'] {
  if (!value || value <= 0) return null;
  const scale = scales[format];
  if (value > scale) throw new Error('Upstream personal rating exceeds its scale.');
  const converted = normalized ?? (format === 'POINT_3' ? [0, 35, 60, 85][value] : value / scale * 100);
  if (converted === undefined || converted < 0 || converted > 100) throw new Error('Invalid normalized rating.');
  return { value, scale, format, normalized100: converted };
}

function timestamp(seconds: number | null | undefined): string | null {
  return seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}
function date(value: z.infer<typeof fuzzyDate>): string | null {
  if (!value?.year) return null;
  return [value.year, ...(value.month ? [String(value.month).padStart(2, '0'), ...(value.day ? [String(value.day).padStart(2, '0')] : [])] : [])].join('-');
}
const anilistStatuses: Record<z.infer<typeof anilistEntrySchema>['status'], ListStatus> = {
  CURRENT: 'watching', PLANNING: 'planning', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped', REPEATING: 'watching',
};
const malStatuses: Record<z.infer<typeof malEntrySchema>['list_status']['status'], ListStatus> = {
  watching: 'watching', completed: 'completed', on_hold: 'paused', dropped: 'dropped', plan_to_watch: 'planning',
};

export function normalizeAniList(input: unknown, scoreFormat: ScoreFormat): Anime {
  scoreFormatSchema.parse(scoreFormat);
  const entry = anilistEntrySchema.parse(input);
  const media = entry.media;
  return {
    id: `anilist:${media.id}`, provider: 'anilist', sourceIds: { anilist: media.id, mal: media.idMal ?? null }, sourceEntryId: entry.id,
    title: media.title.english || media.title.romaji || media.title.native || `Untitled (${media.id})`,
    titles: { english: media.title.english ?? null, romaji: media.title.romaji ?? null, native: media.title.native ?? null, synonyms: media.synonyms ?? [] },
    poster: safeUrl(media.coverImage?.large), synopsis: plainText(media.description), genres: media.genres ?? [],
    trailer: media.trailer?.site?.toLowerCase() === 'youtube' ? youtubeTrailer(media.trailer.id, 'AniList') : null,
    tags: (media.tags ?? []).filter(tag => !tag.isMediaSpoiler).map(tag => tag.name),
    format: media.format ?? null, episodes: media.episodes && media.episodes > 0 ? media.episodes : null,
    airingStatus: media.status ?? null, year: media.startDate?.year ?? null,
    communityScore: media.averageScore && media.averageScore > 0 ? { value: media.averageScore, scale: 100 } : null,
    status: anilistStatuses[entry.status], sourceStatus: entry.status,
    personalScore: personalScore(entry.score, scoreFormat, entry.normalizedScore),
    progress: entry.progress ?? 0, repeat: entry.repeat ?? 0, rewatching: entry.status === 'REPEATING',
    entryCreatedAt: timestamp(entry.createdAt), entryUpdatedAt: timestamp(entry.updatedAt),
    startedOn: date(entry.startedAt), completedOn: date(entry.completedAt),
  };
}

export function normalizeMal(input: unknown): Anime {
  const { node: media, list_status: entry } = malEntrySchema.parse(input);
  const year = media.start_date ? Number(media.start_date.slice(0, 4)) : null;
  return {
    id: `mal:${media.id}`, provider: 'mal', sourceIds: { anilist: null, mal: media.id }, sourceEntryId: null,
    title: media.title,
    titles: { english: media.alternative_titles?.en || null, native: media.alternative_titles?.ja || null, romaji: null, synonyms: media.alternative_titles?.synonyms ?? [] },
    poster: safeUrl(media.main_picture?.large || media.main_picture?.medium), synopsis: plainText(media.synopsis),
    genres: (media.genres ?? []).map(genre => genre.name), tags: [],
    format: media.media_type && media.media_type !== 'unknown' ? media.media_type.toUpperCase() : null,
    episodes: media.num_episodes && media.num_episodes > 0 ? media.num_episodes : null,
    airingStatus: media.status ?? null, year: year && Number.isFinite(year) ? year : null,
    communityScore: media.mean && media.mean > 0 ? { value: media.mean, scale: 10 } : null,
    status: malStatuses[entry.status], sourceStatus: entry.status,
    personalScore: personalScore(entry.score, 'POINT_10'), progress: entry.num_episodes_watched ?? 0,
    repeat: entry.num_times_rewatched ?? 0, rewatching: entry.is_rewatching ?? false,
    entryCreatedAt: null, entryUpdatedAt: entry.updated_at ?? null,
    startedOn: entry.start_date ?? null, completedOn: entry.finish_date ?? null,
  };
}
