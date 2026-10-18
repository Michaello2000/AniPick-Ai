import type { AiSelection, AiStatus } from '../../shared/recommendations.js';
import type { RecommendationProvider } from './contracts.js';
import { GoogleRecommendationProvider } from './google.js';
import { LocalRecommendationProvider, localSettingsSchema, type LocalSettings } from './local.js';
import { ApiError } from '../upstream.js';

export interface AiConnection { provider: RecommendationProvider | null; status: AiStatus; cacheIdentity?: string }
export interface AiConfiguration extends AiConnection {
  cloud?: AiConnection;
  local?: { settings: LocalSettings | null; model: string; message: string };
}
export function configureAi(env: NodeJS.ProcessEnv): AiConfiguration {
  const name = env.AI_PROVIDER?.trim() || 'google';
  const model = env.AI_MODEL?.trim() || 'gemma-4-26b-a4b-it';
  const key = env.GEMINI_API_KEY?.trim();
  const status: AiStatus = { configured: false, provider: 'Google AI Studio', model, mode: 'cloud', timeoutMs: 120000, message: '' };
  let cloud: AiConnection;
  if (!/^gemma-4-[a-z0-9-]+-it$/.test(model)) cloud = { provider: null, status: { ...status, message: 'AI_MODEL must be a Google Gemma 4 instruction-tuned model ID.' } };
  else if (!key) cloud = { provider: null, status: { ...status, message: 'Add GEMINI_API_KEY to the server .env and restart AniPick to enable cloud AI. Your library browser remains available.' } };
  else cloud = { provider: new GoogleRecommendationProvider({ apiKey: key, model }), status: { ...status, configured: true, message: 'Ready to check model access on your first request.' } };
  const localModel = env.LOCAL_AI_MODEL?.trim() ?? '';
  let local: NonNullable<AiConfiguration['local']>;
  try {
    local = { settings: localSettingsSchema.parse({ baseUrl: env.LOCAL_AI_BASE_URL?.trim() || undefined, apiKey: env.LOCAL_AI_API_KEY?.trim(), runtime: env.LOCAL_AI_RUNTIME?.trim() || undefined,
      timeoutMs: env.LOCAL_AI_TIMEOUT_MS || undefined, maxTokens: env.LOCAL_AI_MAX_TOKENS || undefined, sampling: env.LOCAL_AI_SAMPLING?.trim() || undefined }), model: localModel, message: '' };
  } catch {
    local = { settings: null, model: localModel, message: 'Invalid local AI configuration. Use an HTTP loopback /v1 endpoint, a supported runtime/sampling profile, timeout 30000–1800000 ms, and output budget 1024–65536 tokens.' };
  }
  const configuration: AiConfiguration = { ...cloud, cloud, local };
  if (name === 'local') {
    const selected = selectAi(configuration, { mode: 'local', ...(localModel ? { model: localModel } : {}) });
    return { ...configuration, ...selected };
  }
  if (name !== 'google') return { ...configuration, provider: null, status: { ...status, message: 'AI_PROVIDER must be google or local.' } };
  return configuration;
}

export function selectAi(configuration: AiConfiguration, selection?: AiSelection): AiConnection {
  const mode = selection?.mode ?? configuration.status.mode ?? 'cloud';
  if (mode === 'cloud') {
    const cloud = configuration.cloud ?? configuration;
    if (selection?.model && selection.model !== cloud.status.model) throw new ApiError('AI_MODEL_UNAVAILABLE', 'Cloud model selection is configured server-side with AI_MODEL.', 400);
    return cloud;
  }
  const local = configuration.local;
  const model = selection?.model ?? local?.model ?? '';
  const settings = local?.settings;
  const status: AiStatus = { configured: Boolean(settings && model), mode: 'local', provider: 'Local OpenAI-compatible', model, timeoutMs: settings?.timeoutMs ?? 600000,
    message: !settings ? local?.message || 'Local inference is not configured.' : !model ? 'Refresh local models and select a model to enable inference.' : 'Ready to verify the selected local model.' };
  return { provider: settings && model ? new LocalRecommendationProvider(settings, model) : null, status,
    ...(settings ? { cacheIdentity: JSON.stringify({ baseUrl: settings.baseUrl, runtime: settings.runtime, sampling: settings.sampling, maxTokens: settings.maxTokens }) } : {}) };
}
