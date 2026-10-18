import { describe, expect, it } from 'vitest';
import { LocalRecommendationProvider, localBaseUrl, localSettingsSchema } from '../server/recommendations/local.js';
import type { InferenceRequest } from '../server/recommendations/contracts.js';

const request: InferenceRequest = { system: 'Return JSON.', data: { task: 'probe' }, schema: { type: 'object' }, signal: AbortSignal.timeout(5000) };
const models = { data: [{ id: 'Ternary-Bonsai-2-27B-PQ2_0.gguf' }, { id: 'other-model' }, { id: 'Bonsai-2-9B' }] };
const completion = (content: string | null, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content, reasoning_content: 'Never expose this reasoning.' } }] });

describe('loopback local inference', () => {
  it.each(['https://evil.test/v1', 'http://192.168.1.2:8080/v1', 'http://0.0.0.0:8080/v1', 'http://127.0.0.1.evil.test/v1', 'http://user:password@127.0.0.1/v1', 'http://127.0.0.1/v1?x=y', 'http://127.0.0.1/other', 'http://2130706433/v1'])('rejects unsafe base URL %s', value => {
    expect(() => localBaseUrl(value)).toThrow();
  });
  it.each(['http://127.0.0.1:8080/v1', 'http://localhost:11434/v1/', 'http://[::1]:1234/v1'])('accepts literal loopback %s', value => {
    expect(localBaseUrl(value)).toMatch(/^http:/);
  });
  it('discovers actual model IDs, prioritizes Bonsai, and refuses an invented ID before generation', async () => {
    const calls: string[] = [];
    const provider = new LocalRecommendationProvider(localSettingsSchema.parse({}), 'invented', async url => { calls.push(String(url)); return Response.json(models); });
    expect(await provider.models(request.signal)).toEqual(['Bonsai-2-9B', 'Ternary-Bonsai-2-27B-PQ2_0.gguf', 'other-model']);
    await expect(provider.generate(request)).rejects.toMatchObject({ code: 'LOCAL_MODEL_UNAVAILABLE' });
    expect(calls.every(url => url.endsWith('/v1/models'))).toBe(true);
  });
  it.each([
    ['Bonsai-2-9B', 0, 1, 64], ['Ternary-Bonsai-2-27B-PQ2_0.gguf', 0.05, 0, undefined],
  ])('uses the verified thinking sampling profile for %s and strips only complete reasoning', async (model, minP, penalty, window) => {
    const bodies: unknown[] = [];
    const provider = new LocalRecommendationProvider(localSettingsSchema.parse({ apiKey: 'server-only-secret' }), model, async (url, init) => {
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-only-secret');
      if (String(url).endsWith('/models')) return Response.json(models);
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(completion('<think>Private analysis</think>\n{"ready":true}'));
    });
    expect(await provider.generate(request)).toEqual({ ready: true });
    expect(bodies[0]).toMatchObject({ model, temperature: 1, top_p: 0.95, top_k: 20, min_p: minP, presence_penalty: penalty, max_tokens: 16384, reasoning_effort: 'medium', chat_template_kwargs: { enable_thinking: true } });
    if (window) expect(bodies[0]).toMatchObject({ repeat_last_n: window });
    expect(JSON.stringify(bodies)).not.toContain('server-only-secret');
  });
  it('keeps generic compatibility requests free of llama.cpp-specific extensions', async () => {
    let body: unknown;
    const provider = new LocalRecommendationProvider(localSettingsSchema.parse({ runtime: 'ollama' }), 'other-model', async (url, init) => {
      if (String(url).endsWith('/models')) return Response.json(models);
      body = JSON.parse(String(init?.body));
      return Response.json(completion('{"ready":true}'));
    });
    expect(await provider.generate(request)).toEqual({ ready: true });
    expect(body).toMatchObject({ model: 'other-model', response_format: { type: 'json_object' }, stream: false });
    expect(body).not.toHaveProperty('top_k');
    expect(body).not.toHaveProperty('reasoning_effort');
  });
  it.each([
    [completion('<think>unterminated {"ready":true}'), 'AI_INVALID_RESPONSE'],
    [completion('{"ready":true}', 'length'), 'AI_TRUNCATED'],
    [completion(null), 'AI_INVALID_RESPONSE'],
    [{ choices: [] }, 'AI_INVALID_RESPONSE'],
  ])('rejects incomplete/reasoning-only output', async (reply, code) => {
    const provider = new LocalRecommendationProvider(localSettingsSchema.parse({}), 'other-model', async url => Response.json(String(url).endsWith('/models') ? models : reply));
    await expect(provider.generate(request)).rejects.toMatchObject({ code });
  });
  it.each([401, 429, 503, 302])('sanitizes HTTP %s without cloud fallback or automatic generation retries', async status => {
    const provider = new LocalRecommendationProvider(localSettingsSchema.parse({}), 'other-model', async url => String(url).endsWith('/models') ? Response.json(models) : new Response('secret upstream text', { status }));
    await expect(provider.generate(request)).rejects.toThrow(/local|Local/);
    await expect(provider.generate(request)).rejects.not.toThrow('secret upstream text');
  });
  it('reports timeouts without exposing raw transport details', async () => {
    const provider = new LocalRecommendationProvider(localSettingsSchema.parse({}), 'other-model', async () => { throw new DOMException('sensitive', 'TimeoutError'); });
    await expect(provider.models(request.signal)).rejects.toMatchObject({ code: 'LOCAL_AI_TIMEOUT' });
  });
});
