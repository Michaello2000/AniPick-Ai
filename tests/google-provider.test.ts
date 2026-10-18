import { describe, expect, it } from 'vitest';
import { GoogleRecommendationProvider } from '../server/recommendations/google.js';

const request = { system: 'Analyze only supplied data.', data: { history: [], candidates: [] }, schema: { type: 'object' }, signal: AbortSignal.timeout(5000) };
describe('Google Gemma REST adapter', () => {
  it('verifies model access and capabilities; keeps the key in headers and ignores thought parts', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const provider = new GoogleRecommendationProvider({ apiKey: 'test-secret-never-in-url', model: 'gemma-4-26b-a4b-it', fetcher: async (url, init) => {
      calls.push({ url, init });
      return Response.json(init?.method === 'POST' ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private thinking' }, { text: '{"ok":true}' }] } }] } : { name: 'models/gemma-4-26b-a4b-it', supportedGenerationMethods: ['generateContent'] });
    } });
    await provider.verify(request.signal);
    expect(await provider.generate(request)).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls.every(call => !call.url.includes('test-secret'))).toBe(true);
    expect(new Headers(calls[1]?.init?.headers).get('x-goog-api-key')).toBe('test-secret-never-in-url');
    const body = JSON.parse(String(calls[1]?.init?.body));
    expect(body.systemInstruction.parts[0].text).toContain('Analyze only supplied data.');
    expect(body.contents[0].parts[0].text).toContain('history');
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });
  it('refuses unavailable or non-generation models before sending watchlist data', async () => {
    const provider = new GoogleRecommendationProvider({ apiKey: 'test-key', model: 'gemma-4-26b-a4b-it', fetcher: async () => Response.json({ name: 'models/gemma-4-26b-a4b-it', supportedGenerationMethods: ['countTokens'] }) });
    await expect(provider.verify(request.signal)).rejects.toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' });
    expect(() => new GoogleRecommendationProvider({ apiKey: 'x', model: 'closed-model' })).toThrow();
  });
  it('honors rate limits without repeating an expensive request or exposing upstream errors', async () => {
    let calls = 0;
    const provider = new GoogleRecommendationProvider({ apiKey: 'secret-key', model: 'gemma-4-26b-a4b-it', fetcher: async () => { calls++; return new Response('secret-key leaked upstream', { status: 429, headers: { 'Retry-After': '42' } }); } });
    await expect(provider.generate(request)).rejects.toMatchObject({ code: 'AI_RATE_LIMITED', retryAfterSeconds: 42 });
    expect(calls).toBe(1);
    await expect(provider.generate(request)).rejects.not.toThrow('secret-key');
  });
  it('uses structured retry timing and distinguishes input-token limits without exposing raw provider text', async () => {
    const provider = new GoogleRecommendationProvider({ apiKey: 'secret-key', model: 'gemma-4-26b-a4b-it', fetcher: async () => Response.json({ error: {
      message: 'Do not expose secret-key or private upstream diagnostics',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count', quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier', quotaValue: '16000' }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '38.4s' },
      ],
    } }, { status: 429 }) });
    await expect(provider.generate(request)).rejects.toMatchObject({ retryAfterSeconds: 39, quotaKind: 'input_tokens', quotaWindow: 'minute', quotaLimit: 16000 });
    await expect(provider.generate(request)).rejects.toThrow('input-token');
    await expect(provider.generate(request)).rejects.not.toThrow('secret-key');
  });
  it('does not claim a short wait resolves a daily quota or zero available quota', async () => {
    const daily = new GoogleRecommendationProvider({ apiKey: 'key', model: 'gemma-4-26b-a4b-it', fetcher: async () => Response.json({ error: { details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' },
    ] } }, { status: 429 }) });
    await expect(daily.generate(request)).rejects.toMatchObject({ quotaKind: 'requests', quotaWindow: 'day' });
    await expect(daily.generate(request)).rejects.toThrow('daily');
    const unavailable = new GoogleRecommendationProvider({ apiKey: 'key', model: 'gemma-4-26b-a4b-it', fetcher: async () => Response.json({ error: { details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '0' }] },
    ] } }, { status: 429 }) });
    await expect(unavailable.generate(request)).rejects.toMatchObject({ quotaLimit: 0 });
    await expect(unavailable.generate(request)).rejects.toThrow('no available quota');
  });
  it('uses the longer of structured and header retry delays', async () => {
    const provider = new GoogleRecommendationProvider({ apiKey: 'key', model: 'gemma-4-26b-a4b-it', fetcher: async () => Response.json({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '90s' }] } }, { status: 429, headers: { 'Retry-After': '10' } }) });
    await expect(provider.generate(request)).rejects.toMatchObject({ retryAfterSeconds: 90 });
  });
  it('rejects truncated or safety-blocked output instead of accepting partial JSON', async () => {
    const truncated = new GoogleRecommendationProvider({ apiKey: 'key', model: 'gemma-4-26b-a4b-it', fetcher: async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }) });
    await expect(truncated.generate(request)).rejects.toMatchObject({ code: 'AI_TRUNCATED' });
    const blocked = new GoogleRecommendationProvider({ apiKey: 'key', model: 'gemma-4-26b-a4b-it', fetcher: async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }) });
    await expect(blocked.generate(request)).rejects.toMatchObject({ code: 'AI_BLOCKED' });
  });
  it('reports an aborted request as a timeout without returning raw network details', async () => {
    const provider = new GoogleRecommendationProvider({ apiKey: 'key', model: 'gemma-4-26b-a4b-it', fetcher: async () => { throw new DOMException('Timed out with secret context', 'TimeoutError'); } });
    await expect(provider.generate(request)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
});
