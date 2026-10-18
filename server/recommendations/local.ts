import { z } from 'zod';
import { ApiError, type Fetcher } from '../upstream.js';
import type { InferenceRequest, RecommendationProvider } from './contracts.js';
import { invalidOutput, parseModelJson } from './validation.js';

export function localBaseUrl(value: string): string {
  // Literal hosts only: no DNS aliases, userinfo, redirects, query, or path tricks.
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::[1-9]\d{0,4})?\/v1\/?$/i.test(value)) {
    throw new ApiError('LOCAL_AI_CONFIG', 'LOCAL_AI_BASE_URL must be an HTTP loopback URL ending in /v1, such as http://127.0.0.1:8080/v1.', 400);
  }
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ApiError('LOCAL_AI_CONFIG', 'The local inference URL has an invalid port.', 400); }
  // Pin localhost to a literal IP instead of relying on DNS or proxy aliases.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.href.replace(/\/$/, '');
}

export const localSettingsSchema = z.object({
  baseUrl: z.string().default('http://127.0.0.1:8080/v1').transform(localBaseUrl),
  apiKey: z.string().default(''),
  runtime: z.enum(['llamacpp', 'ollama', 'lmstudio']).default('llamacpp'),
  timeoutMs: z.coerce.number().int().min(30000).max(1800000).default(600000),
  maxTokens: z.coerce.number().int().min(1024).max(65536).default(16384),
  sampling: z.enum(['auto', 'generic', 'bonsai2-small', 'bonsai2-27b']).default('auto'),
});
export type LocalSettings = z.infer<typeof localSettingsSchema>;
const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).max(500) })).max(2000) });
const replySchema = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable(), message: z.object({ content: z.string().nullable(), reasoning_content: z.string().nullish(), reasoning: z.string().nullish() }) })).min(1) });

function bonsaiProfile(model: string): 'bonsai2-small' | 'bonsai2-27b' | 'generic' {
  if (!/bonsai[-_ .]?2[-_ .]/i.test(model)) return 'generic';
  if (/(?:^|[-_ ./])(2b|4b|9b)(?:$|[-_ .:/])/i.test(model)) return 'bonsai2-small';
  return /(?:^|[-_ ./])27b(?:$|[-_ .:/])/i.test(model) ? 'bonsai2-27b' : 'generic';
}
function priority(id: string): number {
  if (bonsaiProfile(id) === 'bonsai2-small' && /9b/i.test(id)) return 0;
  return bonsaiProfile(id) === 'bonsai2-27b' ? 1 : 2;
}
function finalContent(value: string): string {
  let content = value.trim();
  // Never extract JSON from inside a chain of thought or an incomplete thought.
  while (content.startsWith('<think>')) {
    const end = content.indexOf('</think>');
    if (end < 0) throw invalidOutput('provider_response');
    content = content.slice(end + '</think>'.length).trim();
  }
  if (!content || content.includes('<think>') || content.includes('</think>')) throw invalidOutput('provider_response');
  return content;
}

export class LocalRecommendationProvider implements RecommendationProvider {
  readonly provider = 'Local OpenAI-compatible';
  constructor(readonly settings: LocalSettings, readonly model: string, private readonly fetcher: Fetcher = fetch) {
    // Validate even when constructed outside configureAi (e.g. an injected transport).
    this.settings = localSettingsSchema.parse(settings);
  }
  async models(signal: AbortSignal): Promise<string[]> {
    const parsed = modelsSchema.safeParse(await this.call('/models', undefined, signal, 15000));
    if (!parsed.success) throw new ApiError('LOCAL_AI_RESPONSE', 'The local server returned an invalid /v1/models response. Check its OpenAI-compatible API.', 502);
    return [...new Set(parsed.data.data.map(model => model.id))].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  }
  async verify(signal: AbortSignal): Promise<void> {
    if (!(await this.models(signal)).includes(this.model)) throw new ApiError('LOCAL_MODEL_UNAVAILABLE', 'Select a model ID returned by the local server. Refresh models after loading or switching a model.', 503);
  }
  async generate(request: InferenceRequest): Promise<unknown> {
    await this.verify(request.signal);
    const profile = this.settings.sampling === 'auto' ? bonsaiProfile(this.model) : this.settings.sampling;
    const bonsai = profile !== 'generic';
    const body = {
      model: this.model, stream: false,
      messages: [
        { role: 'system', content: `${request.system}\nReturn only a final JSON document matching this schema, with no prose outside JSON:\n${JSON.stringify(request.schema)}` },
        { role: 'user', content: JSON.stringify(request.data) },
      ],
      response_format: { type: 'json_object' }, max_tokens: this.settings.maxTokens,
      temperature: bonsai ? 1 : 0.3, top_p: 0.95,
      ...(bonsai ? { presence_penalty: profile === 'bonsai2-small' ? 1 : 0 } : {}),
      ...(bonsai && this.settings.runtime === 'llamacpp' ? {
        top_k: 20, min_p: profile === 'bonsai2-small' ? 0 : 0.05, repeat_penalty: 1,
        ...(profile === 'bonsai2-small' ? { repeat_last_n: 64 } : {}),
        reasoning_effort: 'medium', chat_template_kwargs: { enable_thinking: true },
      } : {}),
    };
    const parsed = replySchema.safeParse(await this.call('/chat/completions', body, request.signal, this.settings.timeoutMs));
    if (!parsed.success) throw invalidOutput('provider_response');
    const choice = parsed.data.choices[0];
    if (choice?.finish_reason === 'length') throw new ApiError('AI_TRUNCATED', 'The local model exhausted its output budget, possibly during reasoning. Increase LOCAL_AI_MAX_TOKENS or use a smaller model.', 502);
    if (choice?.finish_reason !== 'stop') throw new ApiError('LOCAL_AI_INCOMPLETE', 'The local model did not return a complete final answer. Check its chat template and JSON support.', 502);
    if (!choice.message.content) throw invalidOutput('provider_response');
    // Separate reasoning fields are deliberately ignored and never logged or saved.
    return parseModelJson(finalContent(choice.message.content));
  }
  private async call(path: string, body: object | undefined, signal: AbortSignal, timeout: number): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    try {
      const response = await this.fetcher(`${this.settings.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: deadline,
        headers: { 'Content-Type': 'application/json', ...(this.settings.apiKey ? { Authorization: `Bearer ${this.settings.apiKey}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError('LOCAL_AI_UNAVAILABLE', response.status === 429 ? 'The local server is busy or rate limiting. Wait for its current request to finish.' : 'Local inference failed. Check the loaded model, runtime, API authentication, and server console.', 503);
      }
      if (!response.body) throw invalidOutput('provider_response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1000000) { await reader.cancel(); throw invalidOutput('response_size'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw invalidOutput('provider_response'); }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (deadline.aborted || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) throw new ApiError('LOCAL_AI_TIMEOUT', 'Local inference timed out. Try a smaller model or raise LOCAL_AI_TIMEOUT_MS. Your saved library is unchanged.', 504);
      throw new ApiError('LOCAL_AI_UNREACHABLE', 'Could not reach the local inference server. Start it on loopback and check LOCAL_AI_BASE_URL; AniPick will not fall back to cloud.', 503);
    }
  }
}
