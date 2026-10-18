import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) { super(message); }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleeper = (ms: number) => Promise<void>;

export function upstreamError(status: number): ApiError {
  switch (status) {
    case 404: return new ApiError('USER_NOT_FOUND', 'This username was not found. Check the spelling and selected service.', 404);
    case 401: return new ApiError('PROVIDER_AUTH', 'MyAnimeList rejected the server client ID. Check MAL_CLIENT_ID in .env.', 503);
    case 403: return new ApiError('PRIVATE_LIST', 'The provider refused access. The list may be private, or the provider may be blocking requests. Check its public visibility and retry.', 403);
    case 429: return new ApiError('RATE_LIMITED', 'The provider is rate limiting requests. Your saved list is safe; wait a minute and retry.', 429);
    default: return new ApiError('UPSTREAM_UNAVAILABLE', 'The anime provider is temporarily unavailable. Your saved list is safe; try again shortly.');
  }
}

export class UpstreamClient {
  private readonly nextRequest = new Map<string, number>();
  constructor(private readonly fetcher: Fetcher = fetch, private readonly sleep: Sleeper = async ms => { await delay(ms); }) {}

  async json(url: string, init: RequestInit = {}, interval = 2100): Promise<unknown> {
    const origin = new URL(url).origin;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Reserve a slot before awaiting, so concurrent metadata reads share the same limit.
      const now = Date.now();
      const start = Math.max(now, this.nextRequest.get(origin) ?? now);
      this.nextRequest.set(origin, start + interval);
      if (start > now) await this.sleep(start - now);
      let response: Response;
      try {
        response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(25000) });
      } catch {
        if (attempt < 2) { await this.sleep(1000 * 2 ** attempt); continue; }
        throw new ApiError('NETWORK_ERROR', 'Could not reach the anime provider. Check your connection and retry. Your saved list has not changed.');
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2) throw upstreamError(response.status);
        const retryAfter = response.headers.get('retry-after');
        const retryMs = retryAfter ? (/^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 1000 * 2 ** attempt;
        if (retryMs > 30000) throw upstreamError(response.status);
        const wait = Number.isFinite(retryMs) ? Math.max(1000, retryMs) : 2000;
        this.nextRequest.set(origin, Math.max(this.nextRequest.get(origin) ?? 0, Date.now() + wait));
        await this.sleep(wait);
        continue;
      }
      if (!response.ok) {
        if (response.status === 404 && origin === 'https://graphql.anilist.co') {
          let body: unknown;
          try { body = await response.json(); }
          catch { throw upstreamError(response.status); }
          const errors = z.object({ errors: z.array(z.object({ message: z.string() })) }).safeParse(body);
          if (errors.success && errors.data.errors.some(error => /private/i.test(error.message))) throw upstreamError(403);
        }
        throw upstreamError(response.status);
      }
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        if (Number.isFinite(reset) && reset > Date.now()) this.nextRequest.set(origin, reset);
      }
      try { return await response.json(); }
      catch { throw new ApiError('INVALID_RESPONSE', 'The provider returned an unreadable response. Retry the import.'); }
    }
    throw new ApiError('UPSTREAM_UNAVAILABLE', 'The anime provider is unavailable.');
  }
}
