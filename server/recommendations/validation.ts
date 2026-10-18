import { z } from 'zod';
import { tasteProfileSchema, rankingSchema, type TasteProfile, type Ranking } from '../../shared/recommendations.js';
import { ApiError } from '../upstream.js';
import type { ModelAnime } from './data.js';

const repairHints = {
  json: 'Return only one complete, valid JSON object. Do not include commentary or thinking tokens.',
  schema: 'Follow the exact supplied JSON schema, including required fields, string lengths, array limits, and no extra fields.',
  history_ids: 'Use unique history_ids copied exactly from the supplied history candidate_id values. Do not invent references.',
  candidate_ids: 'Use only supplied candidate_id values from the eligible candidates, each at most once.',
  shared_traits: 'shared_genres and shared_tags must be exact intersections of the candidate metadata and the cited history metadata. Use empty arrays when unsure.',
  prose: 'Do not restate numeric ratings, episode counts, durations, match percentages, or claims about dubs, licensing, or streaming in any prose field. Describe taste patterns qualitatively.',
  recommendation_count: 'Return at least one recommendation and no more than max_results.',
  missing_citations: 'When history exists, cite at least one supplied history_id for each recommendation.',
  empty_history: 'With no history, return no preference patterns and include an explicit limitation about missing history.',
  response_size: 'Return a concise JSON object within the supplied schema limits.',
  provider_response: 'Return a complete text response containing the requested JSON object.',
} as const;
type ValidationReason = keyof typeof repairHints;
const failureLabels: Record<ValidationReason, string> = {
  json: 'malformed JSON', schema: 'incorrect response structure', history_ids: 'invalid history references',
  candidate_ids: 'invalid or repeated anime IDs', shared_traits: 'unsupported shared genres or themes',
  prose: 'ratings, length, or availability claims in generated prose', recommendation_count: 'incorrect recommendation count',
  missing_citations: 'missing history references', empty_history: 'missing history limitation',
  response_size: 'response too large', provider_response: 'incomplete provider response',
};

export class ModelValidationError extends ApiError {
  readonly repairHint: string;
  constructor(readonly reason: ValidationReason, readonly fields: string[] = []) {
    const location = fields.length ? ` Check fields: ${fields.join(', ')}.` : '';
    super('AI_INVALID_RESPONSE', `The model response failed validation: ${failureLabels[reason]}.${location} No recommendations were saved. Retry Pick for Me.`);
    this.repairHint = `${repairHints[reason]}${location}`;
  }
}
export function invalidOutput(reason: ValidationReason = 'schema'): ModelValidationError { return new ModelValidationError(reason); }

function schemaFailure(error: z.ZodError): ModelValidationError {
  // Only known schema field names and array positions leave this boundary, never
  // model-provided values, unknown keys, prose, or raw Zod messages.
  const allowed = new Set(['summary', 'likes', 'possible_dislikes', 'limitations', 'pattern', 'history_ids', 'recommendations', 'candidate_id', 'reason', 'shared_genres', 'shared_tags', 'tradeoff', 'confidence']);
  const fields = [...new Set(error.issues.map(issue => issue.path.map(part => typeof part === 'number' ? part : allowed.has(String(part)) ? part : '[field]').join('.') || 'root'))].slice(0, 8);
  return new ModelValidationError('schema', fields);
}

// The model selects and explains. Exact metadata joins belong to the backend.
export const rankingSelectionSchema = z.strictObject({
  recommendations: z.array(rankingSchema.shape.recommendations.element.omit({ shared_genres: true, shared_tags: true })).max(5),
});

export function validateSelection(input: unknown, history: ModelAnime[], candidates: ModelAnime[], maxResults: number): Ranking {
  const selected = rankingSelectionSchema.safeParse(input);
  if (!selected.success) throw schemaFailure(selected.error);
  const eligible = new Map(candidates.map(anime => [anime.candidate_id, anime]));
  const recommendations = selected.data.recommendations.map(recommendation => {
    const candidate = eligible.get(recommendation.candidate_id);
    if (!candidate) throw invalidOutput('candidate_ids');
    const cited = history.filter(anime => recommendation.history_ids.includes(anime.candidate_id));
    const shared = (key: 'genres' | 'tags') => [...new Set(candidate[key].filter(trait => cited.some(anime => anime[key].includes(trait))))].slice(0, 5);
    return { ...recommendation, shared_genres: shared('genres'), shared_tags: shared('tags') };
  });
  return validateRanking({ recommendations }, history, candidates, maxResults);
}

export function parseModelJson(text: string): unknown {
  if (Buffer.byteLength(text) > 64000) throw invalidOutput('response_size');
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  try { return JSON.parse(fenced?.[1] ?? trimmed); }
  catch { throw invalidOutput('json'); }
}

function validateHistoryIds(ids: string[], historyIds: Set<string>) {
  if (new Set(ids).size !== ids.length || ids.some(id => !historyIds.has(id))) throw invalidOutput('history_ids');
}

function validateProse(text: string) {
  // These facts belong to source metadata, not generated prose. This is a coarse
  // extra guard; it does not claim to prove arbitrary natural-language truth.
  if (/\b\d+(?:\.\d+)?\s*(?:\/|out\s+of)\s*\d+|\b\d+(?:\.\d+)?\s*(?:%|percent|episodes?\b|eps\b|minutes?\b)|\b(?:dubbed|dubbing|dubs?|streaming|netflix|crunchyroll|hidive|hulu|funimation|licensed)\b/i.test(text)) throw invalidOutput('prose');
}

export function validateProfile(input: unknown, history: ModelAnime[]): TasteProfile {
  const result = tasteProfileSchema.safeParse(input);
  if (!result.success) throw schemaFailure(result.error);
  const ids = new Set(history.map(anime => anime.candidate_id));
  validateProse(result.data.summary);
  for (const pattern of [...result.data.likes, ...result.data.possible_dislikes]) { validateHistoryIds(pattern.history_ids, ids); validateProse(pattern.pattern); }
  for (const limitation of result.data.limitations) validateProse(limitation);
  if (history.length === 0 && result.data.limitations.length === 0) throw invalidOutput('empty_history');
  return result.data;
}

export function validateRanking(input: unknown, history: ModelAnime[], candidates: ModelAnime[], maxResults: number): Ranking {
  const result = rankingSchema.safeParse(input);
  if (!result.success) throw schemaFailure(result.error);
  if (result.data.recommendations.length > maxResults || result.data.recommendations.length === 0) throw invalidOutput('recommendation_count');
  const eligible = new Map(candidates.map(anime => [anime.candidate_id, anime]));
  const sourceHistory = new Map(history.map(anime => [anime.candidate_id, anime]));
  const ids = new Set<string>();
  for (const recommendation of result.data.recommendations) {
    validateProse(recommendation.reason);
    if (recommendation.tradeoff) validateProse(recommendation.tradeoff);
    const candidate = eligible.get(recommendation.candidate_id);
    if (!candidate || ids.has(recommendation.candidate_id)) throw invalidOutput('candidate_ids');
    ids.add(recommendation.candidate_id);
    validateHistoryIds(recommendation.history_ids, new Set(sourceHistory.keys()));
    if (history.length > 0 && recommendation.history_ids.length === 0) throw invalidOutput('missing_citations');
    const citedHistory = recommendation.history_ids.flatMap(id => { const anime = sourceHistory.get(id); return anime ? [anime] : []; });
    // Only supplied factual intersections can be presented as shared traits.
    for (const [traits, candidateTraits, key] of [
      [recommendation.shared_genres, candidate.genres, 'genres'],
      [recommendation.shared_tags, candidate.tags, 'tags'],
    ] as const) {
      if (new Set(traits).size !== traits.length || traits.some(trait => !candidateTraits.includes(trait) || !citedHistory.some(anime => anime[key].includes(trait)))) throw invalidOutput('shared_traits');
    }
  }
  return result.data;
}
