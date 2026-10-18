import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { ApiError, type Fetcher } from '../upstream.js';
import type { InferenceRequest, RecommendationProvider } from './contracts.js';
import { invalidOutput, parseModelJson } from './validation.js';

interface QuotaInfo {
  quotaKind: 'input_tokens' | 'requests' | 'unknown';
  quotaWindow: 'minute' | 'day' | 'unknown';
  quotaLimit?: number;
}
export class AiRateLimitError extends ApiError {
  readonly quotaKind: QuotaInfo['quotaKind'];
  readonly quotaWindow: QuotaInfo['quotaWindow'];
  readonly quotaLimit?: number;
  constructor(public readonly retryAfterSeconds: number, quota: QuotaInfo = { quotaKind: 'unknown', quotaWindow: 'unknown' }) {
    const name = quota.quotaKind === 'input_tokens' ? 'input-token' : quota.quotaKind === 'requests' ? 'request' : 'AI';
    const limit = quota.quotaLimit === undefined ? '' : ` (limit ${quota.quotaLimit.toLocaleString('en-US')})`;
    const message = quota.quotaLimit === 0
      ? 'Google reports no available quota for this model on your project. Check model access and project quotas in AI Studio; waiting a minute will not establish access.'
      : quota.quotaWindow === 'day'
        ? `Google reports that the daily ${name} quota is exhausted${limit}. Check project usage in AI Studio and wait for the daily reset or resolve the quota restriction; a 60-second wait will not reset a daily quota.`
        : quota.quotaWindow === 'minute'
          ? `Google reports a per-minute ${name} limit${limit}. Wait at least ${retryAfterSeconds} seconds before retrying. Other apps in the same Google project share this quota.`
          : `Google is rate limiting AI requests. Wait at least ${retryAfterSeconds} seconds before retrying. Check AI Studio usage to see whether a token, request, or daily quota was reached.`;
    super('AI_RATE_LIMITED', `${message} Your saved library is still available.`, 429);
    this.quotaKind = quota.quotaKind; this.quotaWindow = quota.quotaWindow; this.quotaLimit = quota.quotaLimit;
  }
}

const quotaResponseSchema = z.object({ error: z.object({ details: z.array(z.object({
  '@type': z.string().optional(), retryDelay: z.string().optional(),
  violations: z.array(z.object({ quotaMetric: z.string().optional(), quotaId: z.string().optional(), quotaValue: z.string().optional() })).optional(),
})).optional() }) });

async function rateLimitError(response: Response): Promise<AiRateLimitError> {
  const header = response.headers.get('retry-after');
  const headerSeconds = header ? (/^\d+(?:\.\d+)?$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000) : 0;
  let body: unknown;
  try { body = await response.json(); }
  catch {
    // A non-JSON provider error has no trusted quota details; use its header instead.
    body = null;
  }
  const parsed = quotaResponseSchema.safeParse(body);
  const details = parsed.success ? parsed.data.error.details ?? [] : [];
  const bodyDelays = details.filter(detail => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo').map(detail => {
    const duration = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay ?? '');
    return duration?.[1] ? Number(duration[1]) : 0;
  });
  const delays = [headerSeconds, ...bodyDelays].filter(value => Number.isFinite(value) && value > 0);
  const seconds = Math.max(1, Math.min(86400, Math.ceil(delays.length ? Math.max(...delays) : 60)));
  const quotas: QuotaInfo[] = details.filter(detail => detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure').flatMap(detail => detail.violations ?? []).map(violation => {
    const name = `${violation.quotaMetric ?? ''} ${violation.quotaId ?? ''}`.toLowerCase();
    const value = violation.quotaValue && /^\d+$/.test(violation.quotaValue) ? Number(violation.quotaValue) : undefined;
    return {
      quotaKind: /input.*token/.test(name) ? 'input_tokens' : /request/.test(name) ? 'requests' : 'unknown',
      quotaWindow: /perday|daily/.test(name) ? 'day' : /perminute/.test(name) ? 'minute' : 'unknown',
      quotaLimit: value !== undefined && Number.isSafeInteger(value) ? value : undefined,
    };
  });
  const quota = quotas.find(value => value.quotaLimit === 0) ?? quotas.find(value => value.quotaWindow === 'day') ?? quotas.find(value => value.quotaKind === 'input_tokens') ?? quotas[0];
  return new AiRateLimitError(seconds, quota);
}

interface GoogleOptions { apiKey: string; model: string; fetcher?: Fetcher }
const modelSchema = z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()) });
const generationSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }).optional(),
  })).optional(),
});

export class GoogleRecommendationProvider implements RecommendationProvider {
  readonly provider = 'Google AI Studio';
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private verifiedUntil = 0;
  constructor({ apiKey, model, fetcher = fetch }: GoogleOptions) {
    if (!/^gemma-4-[a-z0-9-]+-it$/.test(model)) throw new Error('AI_MODEL must be a Gemma 4 instruction-tuned model ID supported by Google.');
    this.model = model; this.apiKey = apiKey; this.fetcher = fetcher;
  }
  async verify(signal: AbortSignal): Promise<void> {
    if (Date.now() < this.verifiedUntil) return;
    const result = modelSchema.safeParse(await this.call('', undefined, signal, 10000));
    if (!result.success || result.data.name !== `models/${this.model}` || !result.data.supportedGenerationMethods.includes('generateContent')) {
      throw new ApiError('AI_MODEL_UNAVAILABLE', 'The configured Gemma model is not available for generateContent on this API key. Check AI_MODEL and AI Studio model access.', 503);
    }
    this.verifiedUntil = Date.now() + 60 * 60 * 1000;
  }
  async generate(request: InferenceRequest): Promise<unknown> {
    const body = {
      systemInstruction: { parts: [{ text: `${request.system}\nReturn only a JSON document matching this exact schema. Do not include markdown, thoughts, or extra fields.\n${JSON.stringify(request.schema)}` }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(request.data) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 6144, thinkingConfig: { thinkingLevel: 'minimal' } },
    };
    // Gemma-specific docs verify system instructions and thinking control, but not native
    // JSON Schema decoding. Request JSON in the prompt and enforce both shape and IDs here.
    const result = generationSchema.safeParse(await this.call(':generateContent', body, request.signal, 40000));
    if (!result.success) throw invalidOutput('provider_response');
    if (result.data.promptFeedback?.blockReason) throw new ApiError('AI_BLOCKED', 'Google blocked this inference request. Try a different mood or a narrower list; browsing remains available.', 422);
    const candidate = result.data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new ApiError('AI_TRUNCATED', 'The model ran out of output space. Try fewer results or narrower preferences.', 502);
    if (candidate?.finishReason !== 'STOP') throw new ApiError('AI_BLOCKED', 'The model did not produce a complete response. Try again with narrower preferences.', 422);
    const text = candidate.content?.parts.filter(part => !part.thought).map(part => part.text ?? '').join('');
    if (!text) throw invalidOutput('provider_response');
    return parseModelJson(text);
  }
  private async call(suffix: string, body: object | undefined, signal: AbortSignal, timeout: number): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}${suffix}`, {
          method: body ? 'POST' : 'GET', redirect: 'error', signal: deadline,
          headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (error) {
        if (deadline.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) throw new ApiError('AI_TIMEOUT', 'AI analysis timed out. Retry with narrower preferences. Your library has not changed.', 504);
        throw new ApiError('AI_NETWORK_ERROR', 'Could not reach Google AI Studio. Check your connection and retry; browsing remains available.', 502);
      }
      if (response.status === 429) {
        throw await rateLimitError(response);
      }
      if (response.status === 401 || response.status === 403) throw new ApiError('AI_ACCESS_DENIED', 'Google rejected AI access. Check GEMINI_API_KEY, model access, region, and project restrictions in AI Studio.', 503);
      if (response.status === 404) throw new ApiError('AI_MODEL_UNAVAILABLE', 'Google could not find the configured model for this key. Check AI_MODEL and AI Studio model access.', 503);
      if (response.status >= 500 && attempt === 0) {
        try { await delay(1000, undefined, { signal: deadline }); }
        catch { throw new ApiError('AI_TIMEOUT', 'AI analysis timed out while waiting to retry.', 504); }
        continue;
      }
      if (!response.ok) throw new ApiError('AI_PROVIDER_ERROR', 'Google could not complete the AI request. Check model capabilities and project limits, then retry.', 502);
      try {
        const text = await response.text();
        if (Buffer.byteLength(text) > 500000) throw invalidOutput('response_size');
        return JSON.parse(text);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (deadline.aborted) throw new ApiError('AI_TIMEOUT', 'AI response timed out. Retry Pick for Me.', 504);
        throw invalidOutput('provider_response');
      }
    }
    throw new ApiError('AI_PROVIDER_ERROR', 'Google AI Studio is temporarily unavailable.', 502);
  }
}
