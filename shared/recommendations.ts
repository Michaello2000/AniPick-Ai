import { z } from 'zod';

export const lengthSchema = z.enum(['all', '12', '24', 'movie', '25']);
export const moodSchema = z.enum(['any', 'uplifting', 'relaxing', 'adventurous', 'thoughtful', 'intense', 'emotional']);
export const recommendationPreferencesSchema = z.strictObject({
  length: lengthSchema.default('all'),
  mood: moodSchema.default('any'),
  genre: z.string().max(80).default(''),
  airing: z.enum(['any', 'finished', 'airing', 'upcoming']).default('any'),
  englishDub: z.enum(['any', 'verified']).default('any'),
  maxResults: z.number().int().min(1).max(5).default(5),
});
export type RecommendationPreferences = z.infer<typeof recommendationPreferencesSchema>;
export const aiSelectionSchema = z.strictObject({
  mode: z.enum(['cloud', 'local']).optional(),
  model: z.string().trim().min(1).max(500).optional(),
});
export type AiSelection = z.infer<typeof aiSelectionSchema>;
export const recommendationRequestSchema = z.strictObject({
  libraryId: z.string().min(1).max(100),
  preferences: recommendationPreferencesSchema,
  allowCloudProcessing: z.boolean().default(false),
  ai: aiSelectionSchema.optional(),
});
export type RecommendationRequest = z.infer<typeof recommendationRequestSchema>;

const prose = z.string().trim().min(1).max(1000);
const patternSchema = z.strictObject({
  pattern: z.string().trim().min(1).max(220), history_ids: z.array(z.string().max(80)).min(1).max(5),
});
export const tasteProfileSchema = z.strictObject({
  summary: prose,
  likes: z.array(patternSchema).max(6),
  possible_dislikes: z.array(patternSchema).max(6),
  limitations: z.array(z.string().trim().min(1).max(350)).max(6),
});
export type TasteProfile = z.infer<typeof tasteProfileSchema>;
export const rankingSchema = z.strictObject({
  recommendations: z.array(z.strictObject({
    candidate_id: z.string().min(1).max(80),
    reason: prose,
    history_ids: z.array(z.string().max(80)).max(5),
    shared_genres: z.array(z.string().max(80)).max(5),
    shared_tags: z.array(z.string().max(100)).max(5),
    tradeoff: z.string().trim().min(1).max(500).nullable(),
    confidence: z.enum(['high', 'medium', 'low']),
  })).max(5),
});
export type Ranking = z.infer<typeof rankingSchema>;

export const aiStatusSchema = z.object({
  configured: z.boolean(), provider: z.string(), model: z.string(), message: z.string(),
  mode: z.enum(['cloud', 'local']).optional(), timeoutMs: z.number().int().positive().optional(),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;
export const localModelsSchema = z.object({
  models: z.array(z.string()), baseUrl: z.string(), timeoutMs: z.number(), defaultModel: z.string(),
});
export const recommendationContextSchema = z.object({
  ai: aiStatusSchema, totalHistory: z.number(), totalPlanning: z.number(),
  cloud: aiStatusSchema.optional(),
  verifiedDubs: z.number(), genres: z.array(z.string()),
});
export type RecommendationContext = z.infer<typeof recommendationContextSchema>;
export const recommendationResponseSchema = z.object({
  profile: tasteProfileSchema,
  recommendations: rankingSchema.shape.recommendations,
  provider: z.string(), model: z.string(), createdAt: z.string(), cached: z.boolean(), profileCached: z.boolean(),
  coverage: z.object({ historyTotal: z.number(), historySent: z.number(), ratedHistorySent: z.number(), eligibleTotal: z.number(), candidatesSent: z.number() }),
  warnings: z.array(z.string()),
});
export type RecommendationResponse = z.infer<typeof recommendationResponseSchema>;
export const moodLabels: Record<RecommendationPreferences['mood'], string> = {
  any: 'Open to anything', uplifting: 'Something uplifting', relaxing: 'An easy, relaxing watch', adventurous: 'A sense of adventure',
  thoughtful: 'Something thought-provoking', intense: 'Keep me on the edge', emotional: 'Make me feel something',
};
