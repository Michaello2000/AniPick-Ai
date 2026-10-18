import assert from 'node:assert/strict';
import { z } from 'zod';
import { TrailerService } from '../server/media.js';
import { MetadataService } from '../server/metadata.js';
import { LibraryStore } from '../server/storage.js';
import { UpstreamClient } from '../server/upstream.js';
import { youtubeTrailer, youtubeSearch } from '../shared/media.js';

// Public anime metadata only. Never opens or modifies the user's saved library,
// calls inference, fabricates trailer IDs, or writes example titles into the app.
const mediaSchema = z.object({ id: z.number().int().positive(), idMal: z.number().int().positive().nullable(), title: z.object({ romaji: z.string() }), trailer: z.object({ id: z.string().nullable(), site: z.string().nullable() }).nullable() });
const pageSchema = z.object({ data: z.object({ Page: z.object({ media: z.array(mediaSchema) }) }) });
const client = new UpstreamClient((url, init) => fetch(url, { ...init, signal: AbortSignal.any([init?.signal ?? AbortSignal.timeout(10000), AbortSignal.timeout(10000)]) }));
const store = new LibraryStore(':memory:');
try {
  const { data } = pageSchema.parse(await client.json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{ Page(perPage: 25) { media(type: ANIME, sort: ID) { id idMal title { romaji } trailer { id site } } } }' }) }));
  const withTrailer = data.Page.media.find(anime => anime.trailer?.site === 'youtube' && youtubeTrailer(anime.trailer.id, 'AniList'));
  const withoutTrailer = data.Page.media.find(anime => anime.trailer === null);
  assert(withTrailer && withoutTrailer, 'Live sample needs both a YouTube trailer and a missing trailer; no fallback data is substituted.');
  const metadata = new MetadataService(store, client);
  const service = new TrailerService(store, client, metadata);
  const source = (anime: z.infer<typeof mediaSchema>) => ({ id: `anilist:${anime.id}`, sourceIds: { anilist: anime.id, mal: anime.idMal } });
  const found = await service.get(source(withTrailer));
  assert.equal(found.trailer?.videoId, withTrailer.trailer?.id);
  assert.equal((await service.get(source(withTrailer))).trailer?.videoId, found.trailer?.videoId);
  console.log('AniList live trailer + cache reuse: PASS', JSON.stringify({ anime: withTrailer.title.romaji, videoId: found.trailer?.videoId }));
  // Isolate the actual AniList-null branch; the MAL/Jikan path is checked below.
  const absent = await service.get({ id: `anilist:${withoutTrailer.id}`, sourceIds: { anilist: withoutTrailer.id, mal: null } });
  assert.equal(absent.trailer, null);
  assert(new URL(youtubeSearch(withoutTrailer.title.romaji)).searchParams.get('search_query')?.includes(withoutTrailer.title.romaji));
  console.log('Live no-trailer + search fallback: PASS', JSON.stringify({ anime: withoutTrailer.title.romaji }));
  if (withTrailer.idMal) {
    try {
      const jikan = await metadata.get(withTrailer.idMal);
      console.log('Jikan live metadata: PASS', JSON.stringify({ malId: jikan.malId, trailerAvailable: Boolean(jikan.trailer) }));
    } catch {
      console.log('Jikan live metadata: NOT VERIFIED (upstream unavailable). AniList checks above remain valid.');
    }
  }
  console.log('Playback in a browser: NOT VERIFIED by this metadata-only check.');
} finally { store.close(); }
