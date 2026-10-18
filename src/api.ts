import { z } from 'zod';
import { capabilitiesSchema, librarySchema, librarySummarySchema, metadataSchema, progressSchema, type Provider } from '../shared/model.js';
import { aiStatusSchema, recommendationContextSchema, recommendationResponseSchema, type RecommendationRequest } from '../shared/recommendations.js';
import { savedTikTokSchema, trailerResponseSchema } from '../shared/media.js';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new Error(parsed.success ? parsed.data.error.message : `AniPick returned an error (${response.status}). Retry the operation.`);
  }
  return schema.parse(body);
}

export const api = {
  capabilities: (signal?: AbortSignal) => request('/health', capabilitiesSchema, { signal }),
  libraries: (signal?: AbortSignal) => request('/libraries', z.object({ libraries: z.array(librarySummarySchema) }), { signal }),
  library: (id: string, signal?: AbortSignal) => request(`/libraries/${encodeURIComponent(id)}`, librarySchema, { signal }),
  activeImport: (signal?: AbortSignal) => request('/imports', z.object({ job: progressSchema.nullable() }), { signal }),
  import: (provider: Provider, username: string, refresh = false) => request('/imports', progressSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, username, refresh }) }),
  progress: (id: string, signal?: AbortSignal) => request(`/imports/${encodeURIComponent(id)}`, progressSchema, { signal }),
  metadata: (id: number, signal?: AbortSignal) => request(`/metadata/${id}`, metadataSchema, { signal: signal ?? AbortSignal.timeout(90000) }),
  trailer: (id: string, signal: AbortSignal) => request(`/anime/${encodeURIComponent(id)}/trailer`, trailerResponseSchema, { signal: AbortSignal.any([signal, AbortSignal.timeout(130000)]) }),
  tiktoks: (id: string, signal?: AbortSignal) => request(`/anime/${encodeURIComponent(id)}/tiktok`, z.object({ videos: z.array(savedTikTokSchema) }), { signal }),
  saveTikTok: (id: string, url: string) => request(`/anime/${encodeURIComponent(id)}/tiktok`, savedTikTokSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }),
  deleteTikTok: (id: string, videoId: string) => request(`/anime/${encodeURIComponent(id)}/tiktok/${encodeURIComponent(videoId)}`, z.object({ removed: z.boolean() }), { method: 'DELETE' }),
  recommendationContext: (id: string, signal?: AbortSignal) => request(`/libraries/${encodeURIComponent(id)}/recommendation-context`, recommendationContextSchema, { signal }),
  checkAi: () => request('/ai/check', aiStatusSchema, { method: 'POST', signal: AbortSignal.timeout(20000) }),
  recommend: (input: RecommendationRequest, signal: AbortSignal) => request('/recommendations', recommendationResponseSchema, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([signal, AbortSignal.timeout(130000)]),
  }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'Could not reach the local server. Check that AniPick is running, then retry.';
  return error instanceof Error ? error.message : 'Something went wrong. Please retry.';
}
