import { describe, expect, it } from 'vitest';
import { RecommendationService } from '../server/recommendations/service.js';
import { LibraryStore } from '../server/storage.js';
import type { InferenceRequest, RecommendationProvider } from '../server/recommendations/contracts.js';
import { AiRateLimitError } from '../server/recommendations/google.js';
import { recommendationPreferencesSchema } from '../shared/recommendations.js';
import { entry } from './fixtures.js';

const profile = { summary: 'Drama recurs in your history.', likes: [{ pattern: 'Character drama', history_ids: ['anilist:1'] }], possible_dislikes: [], limitations: ['Sparse ratings make this tentative.'] };
const ranking = { recommendations: [{ candidate_id: 'anilist:2', reason: 'The dramatic themes connect to your history.', history_ids: ['anilist:1'], tradeoff: null, confidence: 'high' }] };
class TestProvider implements RecommendationProvider {
  readonly provider = 'test-only'; readonly model = 'test-model';
  readonly requests: InferenceRequest[] = [];
  constructor(private readonly replies: unknown[]) {}
  async verify(): Promise<void> {}
  async generate(request: InferenceRequest): Promise<unknown> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error('Unexpected model request');
    return reply;
  }
}
function setup(replies: unknown[]) {
  const store = new LibraryStore(':memory:');
  const library = store.save('anilist', 'Viewer', [
    { ...entry(1), status: 'completed', genres: ['Drama'] },
    { ...entry(2), genres: ['Drama'] }, { ...entry(3, 25), genres: ['Action'] },
  ]);
  const provider = new TestProvider(replies);
  const configuration = { provider, status: { configured: true, provider: provider.provider, model: provider.model, message: 'test' } };
  const service = new RecommendationService(store, configuration);
  const request = { libraryId: library.id, preferences: recommendationPreferencesSchema.parse({ length: '12' }), allowCloudProcessing: true };
  return { store, library, provider, configuration, service, request };
}

describe('real recommendation orchestration with an injected test transport', () => {
  it('performs separate model analysis and ranking and durably caches validated output', async () => {
    const { store, service, provider, configuration, request } = setup([profile, ranking]);
    try {
      const result = await service.recommend(request);
      expect(result.recommendations.map(x => x.candidate_id)).toEqual(['anilist:2']);
      expect(result.recommendations[0]?.confidence).toBe('low');
      expect(result.recommendations[0]?.shared_genres).toEqual(['Drama']);
      expect(provider.requests).toHaveLength(2);
      expect((await new RecommendationService(store, configuration).recommend(request)).cached).toBe(true);
      expect(provider.requests).toHaveLength(2);
    } finally { store.close(); }
  });
  it('reuses taste analysis across mood changes and invalidates it when history changes', async () => {
    const { store, service, provider, request, library } = setup([profile, ranking, ranking, profile, ranking]);
    try {
      await service.recommend(request);
      expect((await service.recommend({ ...request, preferences: { ...request.preferences, mood: 'emotional' } })).profileCached).toBe(true);
      expect(provider.requests).toHaveLength(3);
      store.save('anilist', 'Viewer', library.entries.map(anime => anime.id === 'anilist:1' ? { ...anime, synopsis: 'New history metadata' } : anime));
      expect((await service.recommend(request)).profileCached).toBe(false);
      expect(provider.requests).toHaveLength(5);
    } finally { store.close(); }
  });
  it('retries an invented candidate once and never exposes it', async () => {
    const bad = { recommendations: [{ ...ranking.recommendations[0], candidate_id: 'anilist:99999' }] };
    const { store, service, provider, request } = setup([profile, bad, ranking]);
    try {
      expect((await service.recommend(request)).recommendations[0]?.candidate_id).toBe('anilist:2');
      expect(provider.requests).toHaveLength(3);
      expect(provider.requests[2]?.system).toContain('supplied candidate_id');
    } finally { store.close(); }
  });
  it('explains the specific repair without echoing invalid model data', async () => {
    const bad = { recommendations: [{ ...ranking.recommendations[0], reason: 'You rated private title 9/10.' }] };
    const { store, service, provider, request } = setup([profile, bad, ranking]);
    try {
      await service.recommend(request);
      expect(provider.requests[2]?.system).toContain('Do not restate numeric ratings');
      expect(provider.requests[2]?.system).not.toContain('private title');
      expect(provider.requests[0]?.system).toContain('Do not restate numeric ratings');
    } finally { store.close(); }
  });
  it('identifies the failed inference stage after the bounded repair is exhausted', async () => {
    const { store, service, provider, request } = setup([{}, {}]);
    try {
      await expect(service.recommend(request)).rejects.toThrow('Taste analysis failed');
      expect(provider.requests).toHaveLength(2);
    } finally { store.close(); }
  });
  it('fails explicitly after repeated invalid responses, without caching fake results', async () => {
    const { store, service, provider, request } = setup([profile, {}, {}, ranking]);
    try {
      await expect(service.recommend(request)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
      expect((await service.recommend(request)).cached).toBe(false);
      expect(provider.requests).toHaveLength(4);
    } finally { store.close(); }
  });
  it('does not call a model for empty eligibility or without explicit cloud consent', async () => {
    const { store, service, provider, request } = setup([]);
    try {
      await expect(service.recommend({ ...request, preferences: { ...request.preferences, englishDub: 'verified' } })).rejects.toMatchObject({ code: 'NO_ELIGIBLE_ANIME' });
      await expect(service.recommend({ ...request, allowCloudProcessing: false })).rejects.toThrow();
      expect(provider.requests).toHaveLength(0);
    } finally { store.close(); }
  });
  it('retains a successful profile through rate limiting and prevents immediate inference repeats', async () => {
    const quota = { quotaKind: 'input_tokens', quotaWindow: 'minute', quotaLimit: 16000 } as const;
    const { store, service, provider, request } = setup([profile, new AiRateLimitError(60, quota)]);
    try {
      await expect(service.recommend(request)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' });
      await expect(service.recommend({ ...request, preferences: { ...request.preferences, mood: 'relaxing' } })).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', ...quota });
      expect(provider.requests).toHaveLength(2);
      expect(store.get(request.libraryId)?.entries).toHaveLength(3);
    } finally { store.close(); }
  });
  it('coalesces identical in-flight requests instead of generating twice', async () => {
    const { store, service, provider, request } = setup([profile, ranking]);
    try {
      const [first, second] = await Promise.all([service.recommend(request), service.recommend(request)]);
      expect(first).toEqual(second);
      expect(provider.requests).toHaveLength(2);
    } finally { store.close(); }
  });
  it('handles an unrated, history-free library with explicit uncertainty', async () => {
    const sparseProfile = { summary: 'There is no history to infer personal taste.', likes: [], possible_dislikes: [], limitations: ['These are exploratory suggestions from mood and metadata.'] };
    const sparseRanking = { recommendations: [{ ...ranking.recommendations[0], history_ids: [] }] };
    const { store, service, request } = setup([sparseProfile, sparseRanking]);
    try {
      store.save('anilist', 'Viewer', [{ ...entry(2), genres: ['Drama'] }]);
      const result = await service.recommend(request);
      expect(result.coverage.historySent).toBe(0);
      expect(result.recommendations[0]?.confidence).toBe('low');
      expect(result.warnings.join(' ')).toContain('Very little watch history');
    } finally { store.close(); }
  });
});
