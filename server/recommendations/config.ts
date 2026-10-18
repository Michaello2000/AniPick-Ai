import type { AiStatus } from '../../shared/recommendations.js';
import type { RecommendationProvider } from './contracts.js';
import { GoogleRecommendationProvider } from './google.js';

export interface AiConfiguration { provider: RecommendationProvider | null; status: AiStatus }
export function configureAi(env: NodeJS.ProcessEnv): AiConfiguration {
  const name = env.AI_PROVIDER?.trim() || 'google';
  const model = env.AI_MODEL?.trim() || 'gemma-4-26b-a4b-it';
  const key = env.GEMINI_API_KEY?.trim();
  const status: AiStatus = { configured: false, provider: 'Google AI Studio', model, message: '' };
  if (name !== 'google') return { provider: null, status: { ...status, message: 'This build supports AI_PROVIDER=google. A Qwen provider adapter can be added without changing import or recommendation validation.' } };
  if (!/^gemma-4-[a-z0-9-]+-it$/.test(model)) return { provider: null, status: { ...status, message: 'AI_MODEL must be a Google Gemma 4 instruction-tuned model ID.' } };
  if (!key) return { provider: null, status: { ...status, message: 'Add GEMINI_API_KEY to the server .env and restart AniPick to enable AI. Your library browser remains available.' } };
  return { provider: new GoogleRecommendationProvider({ apiKey: key, model }), status: { ...status, configured: true, message: 'Ready to check model access on your first request.' } };
}
