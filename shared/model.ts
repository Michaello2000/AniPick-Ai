import { z } from 'zod';
import { trailerSchema } from './media.js';

export const providerSchema = z.enum(['anilist', 'mal']);
export type Provider = z.infer<typeof providerSchema>;
export const statusSchema = z.enum(['planning', 'watching', 'completed', 'paused', 'dropped']);
export type ListStatus = z.infer<typeof statusSchema>;
export const scoreFormatSchema = z.enum(['POINT_100', 'POINT_10', 'POINT_10_DECIMAL', 'POINT_5', 'POINT_3']);
export type ScoreFormat = z.infer<typeof scoreFormatSchema>;

export const animeSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  sourceIds: z.object({ anilist: z.number().int().positive().nullable(), mal: z.number().int().positive().nullable() }),
  sourceEntryId: z.number().int().nullable(),
  title: z.string(),
  titles: z.object({ english: z.string().nullable(), romaji: z.string().nullable(), native: z.string().nullable(), synonyms: z.array(z.string()) }),
  poster: z.string().nullable(),
  trailer: trailerSchema.nullable().optional(),
  synopsis: z.string().nullable(),
  genres: z.array(z.string()),
  tags: z.array(z.string()),
  format: z.string().nullable(),
  episodes: z.number().int().positive().nullable(),
  airingStatus: z.string().nullable(),
  year: z.number().int().nullable(),
  communityScore: z.object({ value: z.number(), scale: z.number().positive() }).nullable(),
  status: statusSchema,
  sourceStatus: z.string(),
  personalScore: z.object({ value: z.number().positive(), scale: z.number().positive(), format: scoreFormatSchema, normalized100: z.number().min(0).max(100) }).nullable(),
  progress: z.number().int().nonnegative(),
  repeat: z.number().int().nonnegative(),
  rewatching: z.boolean(),
  entryCreatedAt: z.string().nullable(),
  entryUpdatedAt: z.string().nullable(),
  startedOn: z.string().nullable(),
  completedOn: z.string().nullable(),
  englishDub: z.object({ available: z.boolean(), source: z.url({ protocol: /^https$/ }), checkedAt: z.iso.datetime() }).nullable().optional(),
});
export type Anime = z.infer<typeof animeSchema>;

export const librarySchema = z.object({
  id: z.string(), provider: providerSchema, username: z.string(), importedAt: z.string(),
  entries: z.array(animeSchema),
});
export type Library = z.infer<typeof librarySchema>;
export const librarySummarySchema = librarySchema.omit({ entries: true }).extend({ count: z.number(), planning: z.number() });
export type LibrarySummary = z.infer<typeof librarySummarySchema>;
export const progressSchema = z.object({
  id: z.string(), state: z.enum(['running', 'complete', 'failed']),
  message: z.string(), pages: z.number(), imported: z.number(), libraryId: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type ImportProgress = z.infer<typeof progressSchema>;
export const capabilitiesSchema = z.object({ malConfigured: z.boolean() });
export const metadataSchema = z.object({
  malId: z.number().int().positive(), synopsis: z.string().nullable(), genres: z.array(z.string()),
  tags: z.array(z.string()), fetchedAt: z.string(), source: z.literal('Jikan / MyAnimeList'),
  trailer: trailerSchema.nullable().optional(),
});
export type AnimeMetadata = z.infer<typeof metadataSchema>;

export const statusLabels: Record<ListStatus, string> = {
  planning: 'Plan to Watch', watching: 'Watching', completed: 'Completed', paused: 'On hold', dropped: 'Dropped',
};
export const providerLabels: Record<Provider, string> = { anilist: 'AniList', mal: 'MyAnimeList' };
