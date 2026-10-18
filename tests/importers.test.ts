import { describe, expect, it } from 'vitest';
import { importAniList, importMal } from '../server/importers.js';
import { UpstreamClient, ApiError } from '../server/upstream.js';
import { anilistEntry, malEntry } from './fixtures.js';

function sequence(responses: unknown[]) {
  const requests: { url: string; body?: string }[] = [];
  const client = new UpstreamClient(async (input, init) => {
    requests.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : undefined });
    const response = responses.shift();
    if (response instanceof Response) return response;
    if (response === undefined) throw new Error('Unexpected upstream call');
    return Response.json(response);
  }, async () => {});
  return { client, requests };
}
const chunk = (entries: unknown[], next: boolean) => ({ data: { MediaListCollection: {
  user: { id: 1, name: 'Viewer', mediaListOptions: { scoreFormat: 'POINT_10' }, statistics: { anime: { count: 3 } } },
  lists: [{ entries }], hasNextChunk: next,
} } });
const profile = { data: { User: { id: 1, name: 'Viewer', mediaListOptions: { scoreFormat: 'POINT_10' } } } };

describe('AniList import', () => {
  it('retrieves every chunk, deduplicates custom lists, and preserves all statuses', async () => {
    const { client, requests } = sequence([profile, chunk([anilistEntry(1, 8, 'COMPLETED'), anilistEntry(2)], true), chunk([anilistEntry(2), anilistEntry(3, 0, 'DROPPED')], false)]);
    const result = await importAniList('Viewer', client, () => {});
    expect(result.entries.map(x => x.status)).toEqual(['completed', 'planning', 'dropped']);
    expect(requests.slice(1).map(x => JSON.parse(x.body ?? '{}').variables.chunk)).toEqual([1, 2]);
    expect(JSON.parse(requests[1]?.body ?? '{}').variables.scoreFormat).toBe('POINT_10');
    expect(result.entries[0]?.personalScore).toMatchObject({ value: 8, scale: 10 });
  });
  it('fails the complete import when a later page fails', async () => {
    const { client } = sequence([profile, chunk([anilistEntry(1)], true), new Response('', { status: 403 })]);
    await expect(importAniList('Viewer', client, () => {})).rejects.toMatchObject({ code: 'PRIVATE_LIST' });
  });
  it('distinguishes an empty list from a missing user', async () => {
    const empty = chunk([], false);
    empty.data.MediaListCollection.user.statistics.anime.count = 0;
    expect((await importAniList('Viewer', sequence([profile, empty]).client, () => {})).entries).toEqual([]);
    await expect(importAniList('Missing', sequence([{ data: { User: null } }]).client, () => {})).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
  it('does not silently save a hidden list as empty', async () => {
    await expect(importAniList('Viewer', sequence([profile, chunk([], false)]).client, () => {})).rejects.toMatchObject({ code: 'PRIVATE_LIST' });
  });
  it('rejects stalled pagination and GraphQL errors even with HTTP 200', async () => {
    await expect(importAniList('Viewer', sequence([profile, chunk([anilistEntry(1)], true), chunk([anilistEntry(1)], true)]).client, () => {})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(importAniList('Viewer', sequence([{ errors: [{ message: 'Private list', status: 403 }] }]).client, () => {})).rejects.toMatchObject({ code: 'PRIVATE_LIST' });
  });
  it('classifies AniList private-user HTTP 404 responses as private', async () => {
    const { client } = sequence([Response.json({ errors: [{ message: 'Private User', status: 404 }] }, { status: 404 })]);
    await expect(importAniList('Viewer', client, () => {})).rejects.toMatchObject({ code: 'PRIVATE_LIST' });
  });
});

describe('MAL public-list import', () => {
  it('requires server configuration without sending a request', async () => {
    const { client, requests } = sequence([]);
    await expect(importMal('Viewer', '', client, () => {})).rejects.toMatchObject({ code: 'MAL_NOT_CONFIGURED' });
    expect(requests).toHaveLength(0);
  });
  it('retrieves every offset and preserves native ratings', async () => {
    const { client, requests } = sequence([
      { data: [malEntry(1, 9, 'completed')], paging: { next: 'https://api.myanimelist.net/v2/users/Viewer/animelist?offset=500&limit=500' } },
      { data: [malEntry(2)], paging: {} },
    ]);
    const result = await importMal('Viewer', 'test-client-id', client, () => {});
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.personalScore?.value).toBe(9);
    expect(new URL(requests[1]?.url ?? '').searchParams.get('offset')).toBe('500');
  });
  it('rejects redirects to arbitrary pagination destinations', async () => {
    const { client, requests } = sequence([{ data: [malEntry(1)], paging: { next: 'https://evil.invalid/steal?offset=500' } }]);
    await expect(importMal('Viewer', 'test-client-id', client, () => {})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(requests).toHaveLength(1);
  });
});

describe('upstream resilience', () => {
  it('honors Retry-After then recovers from rate limiting', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new UpstreamClient(async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : Response.json({ ok: true }), async ms => { sleeps.push(ms); });
    expect(await client.json('https://api.jikan.moe/v4/anime/1', {}, 0)).toEqual({ ok: true });
    expect(sleeps).toContain(2000);
  });
  it('bounds transient retries and keeps provider errors actionable', async () => {
    let calls = 0;
    const client = new UpstreamClient(async () => { calls++; return new Response('', { status: 503 }); }, async () => {});
    await expect(client.json('https://graphql.anilist.co', {}, 0)).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(3);
    await expect(sequence([new Response('', { status: 404 })]).client.json('https://graphql.anilist.co', {}, 0)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });
});
