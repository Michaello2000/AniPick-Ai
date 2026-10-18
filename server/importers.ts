import { z } from 'zod';
import { scoreFormatSchema, type Anime } from '../shared/model.js';
import { anilistEntrySchema, malEntrySchema, normalizeAniList, normalizeMal } from './normalize.js';
import { ApiError, UpstreamClient, upstreamError } from './upstream.js';

export type ProgressCallback = (pages: number, imported: number, message: string) => void;
export interface ImportResult { username: string; entries: Anime[] }

export const ANILIST_QUERY = `query ImportList($username: String!, $chunk: Int!, $scoreFormat: ScoreFormat!) {
  MediaListCollection(userName: $username, type: ANIME, chunk: $chunk, perChunk: 500) {
    hasNextChunk
    user { id name mediaListOptions { scoreFormat } statistics { anime { count } } }
    lists { entries {
      id status score(format: $scoreFormat) normalizedScore: score(format: POINT_100) progress repeat createdAt updatedAt
      startedAt { year month day } completedAt { year month day }
      media {
        id idMal title { romaji english native } synonyms coverImage { large }
        description(asHtml: false) genres tags { name isMediaSpoiler }
        format episodes status averageScore startDate { year } trailer { id site }
      }
    } }
  }
}`;

const graphResponse = z.object({
  errors: z.array(z.object({ message: z.string(), status: z.number().optional() })).optional(),
  data: z.object({ MediaListCollection: z.object({
    hasNextChunk: z.boolean(),
    user: z.object({ id: z.number(), name: z.string(), mediaListOptions: z.object({ scoreFormat: scoreFormatSchema }), statistics: z.object({ anime: z.object({ count: z.number() }) }).nullish() }).nullable(),
    lists: z.array(z.object({ entries: z.array(anilistEntrySchema).nullable() })).nullable(),
  }).nullable() }).nullish(),
});
const profileSchema = z.object({
  errors: z.array(z.object({ message: z.string(), status: z.number().optional() })).optional(),
  data: z.object({ User: z.object({ id: z.number(), name: z.string(), mediaListOptions: z.object({ scoreFormat: scoreFormatSchema }) }).nullable() }).nullish(),
});

function checkGraphErrors(errors: { message: string; status?: number }[] | undefined) {
  const error = errors?.[0];
  if (!error) return;
  if (/private/i.test(error.message)) throw upstreamError(403);
  if (error.status) throw upstreamError(error.status);
  throw new ApiError('UPSTREAM_REJECTED', 'AniList could not read this public list. Check the username and list visibility, then retry.');
}

export async function importAniList(username: string, client: UpstreamClient, progress: ProgressCallback): Promise<ImportResult> {
  const entries = new Map<string, Anime>();
  progress(0, 0, 'Reading AniList profile and rating scale…');
  const profile = profileSchema.parse(await client.json('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: 'query ImportProfile($username: String!) { User(name: $username) { id name mediaListOptions { scoreFormat } } }', variables: { username } }),
  }));
  checkGraphErrors(profile.errors);
  const user = profile.data?.User;
  if (!user) throw upstreamError(404);
  const scoreFormat = user.mediaListOptions.scoreFormat;
  for (let chunk = 1; chunk <= 200; chunk++) {
    progress(chunk - 1, entries.size, `Fetching AniList page ${chunk}…`);
    const response = graphResponse.parse(await client.json('https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: ANILIST_QUERY, variables: { username: user.name, chunk, scoreFormat } }),
    }));
    checkGraphErrors(response.errors);
    const collection = response.data?.MediaListCollection;
    if (!collection?.user) throw upstreamError(404);
    if (collection.user.mediaListOptions.scoreFormat !== scoreFormat) throw new ApiError('PROFILE_CHANGED', 'Your AniList scoring format changed during import. Retry to fetch a consistent list.');
    const before = entries.size;
    for (const list of collection.lists ?? []) for (const entry of list.entries ?? []) {
      const anime = normalizeAniList(entry, scoreFormat);
      entries.set(anime.id, anime);
    }
    progress(chunk, entries.size, `Read ${entries.size} anime across ${chunk} page${chunk === 1 ? '' : 's'}.`);
    if (!collection.hasNextChunk) {
      if (entries.size === 0 && (collection.user.statistics?.anime.count ?? 0) > 0) throw upstreamError(403);
      return { username: collection.user.name, entries: [...entries.values()] };
    }
    if (entries.size === before) throw new ApiError('INVALID_RESPONSE', 'AniList pagination stopped making progress. No partial list was saved.');
  }
  throw new ApiError('LIST_TOO_LARGE', 'This list exceeded the import safety limit. No partial list was saved.');
}

const malPageSchema = z.object({ data: z.array(malEntrySchema), paging: z.object({ next: z.string().optional() }) });
const MAL_FIELDS = 'id,title,main_picture,alternative_titles,synopsis,genres,media_type,num_episodes,status,mean,start_date,list_status{status,score,num_episodes_watched,is_rewatching,num_times_rewatched,updated_at,start_date,finish_date}';

export async function importMal(username: string, clientId: string, client: UpstreamClient, progress: ProgressCallback): Promise<ImportResult> {
  if (!clientId.trim()) throw new ApiError('MAL_NOT_CONFIGURED', 'MyAnimeList needs a server-side client ID. Add MAL_CLIENT_ID to .env and restart the server. No viewer login is required.', 503);
  const url = new URL(`https://api.myanimelist.net/v2/users/${encodeURIComponent(username)}/animelist`);
  url.searchParams.set('fields', MAL_FIELDS);
  url.searchParams.set('limit', '500');
  url.searchParams.set('nsfw', 'true');
  url.searchParams.set('offset', '0');
  const entries = new Map<string, Anime>();
  for (let page = 1; page <= 200; page++) {
    progress(page - 1, entries.size, `Fetching MyAnimeList page ${page}…`);
    const response = malPageSchema.parse(await client.json(url.href, { headers: { 'X-MAL-CLIENT-ID': clientId, Accept: 'application/json' } }, 1100));
    const before = entries.size;
    for (const entry of response.data) { const anime = normalizeMal(entry); entries.set(anime.id, anime); }
    progress(page, entries.size, `Read ${entries.size} anime across ${page} page${page === 1 ? '' : 's'}.`);
    if (!response.paging.next) return { username, entries: [...entries.values()] };
    let next: URL;
    try { next = new URL(response.paging.next); }
    catch { throw new ApiError('INVALID_RESPONSE', 'MyAnimeList returned an invalid pagination link. No partial list was saved.'); }
    const offset = next.searchParams.get('offset');
    if (next.origin !== url.origin || next.pathname !== url.pathname || !offset || !/^\d+$/.test(offset) || Number(offset) <= Number(url.searchParams.get('offset')) || entries.size === before) {
      throw new ApiError('INVALID_RESPONSE', 'MyAnimeList returned inconsistent pagination. No partial list was saved.');
    }
    // Reconstruct from our own URL: never forward the client ID to a provider-supplied destination.
    url.searchParams.set('offset', offset);
  }
  throw new ApiError('LIST_TOO_LARGE', 'This list exceeded the import safety limit. No partial list was saved.');
}
