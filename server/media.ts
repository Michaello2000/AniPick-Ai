import type { Express } from 'express';
import { z } from 'zod';
import type { Anime } from '../shared/model.js';
import { parseTikTokUrl, tiktokIdSchema, youtubeTrailer, type Trailer, type TrailerResponse } from '../shared/media.js';
import type { LibraryStore } from './storage.js';
import type { MetadataService } from './metadata.js';
import { ApiError, type UpstreamClient } from './upstream.js';

const anilistTrailerSchema = z.object({ data: z.object({ Media: z.object({ id: z.number().int(), trailer: z.object({ id: z.string().nullish(), site: z.string().nullish() }).nullable() }).nullable() }).nullish(), errors: z.array(z.unknown()).optional() });
const animeIdSchema = z.string().regex(/^(anilist|mal):[1-9]\d*$/);
type TrailerAnime = Pick<Anime, 'id' | 'sourceIds' | 'trailer'>;

export class TrailerService {
  private readonly pending = new Map<string, Promise<TrailerResponse>>();
  constructor(private readonly store: LibraryStore, private readonly client: UpstreamClient, private readonly metadata: MetadataService) {}
  async get(anime: TrailerAnime): Promise<TrailerResponse> {
    if (anime.trailer) return { trailer: anime.trailer, checkedAt: new Date().toISOString(), warnings: [] };
    const cached = this.store.getTrailer(anime.id);
    if (cached) return cached;
    const pending = this.pending.get(anime.id);
    if (pending) return pending;
    const request = this.fetch(anime);
    this.pending.set(anime.id, request);
    try { return await request; }
    catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('TRAILER_UNAVAILABLE', 'Trailer metadata could not be confirmed for this anime. Use YouTube search or retry the lookup.');
    }
    finally { this.pending.delete(anime.id); }
  }
  private async fetch(anime: TrailerAnime): Promise<TrailerResponse> {
    let trailer: Trailer | null = null;
    const warnings: string[] = [];
    if (anime.sourceIds.anilist) {
      try {
        const result = anilistTrailerSchema.parse(await this.client.json('https://graphql.anilist.co', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: 'query AnimeTrailer($id: Int!) { Media(id: $id, type: ANIME) { id trailer { id site } } }', variables: { id: anime.sourceIds.anilist } }),
        }));
        const media = result.data?.Media;
        if (result.errors?.length || !media || media.id !== anime.sourceIds.anilist) throw new ApiError('TRAILER_UNAVAILABLE', 'AniList could not confirm trailer metadata for this anime. Try again or use YouTube search.');
        trailer = media.trailer?.site?.toLowerCase() === 'youtube' ? youtubeTrailer(media.trailer.id, 'AniList') : null;
      } catch (error) {
        if (!anime.sourceIds.mal) throw error;
        warnings.push('AniList trailer metadata is unavailable. Jikan was checked instead.');
      }
    }
    if (!trailer && anime.sourceIds.mal) {
      try { trailer = (await this.metadata.get(anime.sourceIds.mal)).trailer ?? null; }
      catch (error) {
        if (!anime.sourceIds.anilist || warnings.length) throw error;
        warnings.push('Jikan trailer metadata is unavailable. No YouTube trailer was listed by AniList. Use search or retry.');
      }
    }
    const result = { trailer, checkedAt: new Date().toISOString(), warnings };
    if (warnings.length === 0) this.store.saveTrailer(anime.id, result);
    return result;
  }
}

export function registerMediaRoutes(app: Express, store: LibraryStore, trailers: TrailerService): void {
  function imported(id: string): Anime {
    const anime = store.getAnime(animeIdSchema.parse(id));
    if (!anime) throw new ApiError('ANIME_NOT_IMPORTED', 'Open an anime from your saved library to manage its previews.', 404);
    return anime;
  }
  app.get('/api/anime/:id/trailer', async (req, res) => { res.json(await trailers.get(imported(req.params.id))); });
  app.get('/api/anime/:id/tiktok', (req, res) => { const anime = imported(req.params.id); res.json({ videos: store.getTikToks(anime.id) }); });
  app.post('/api/anime/:id/tiktok', (req, res) => {
    const anime = imported(req.params.id);
    const input = z.strictObject({ url: z.string().max(500) }).parse(req.body);
    const video = parseTikTokUrl(input.url);
    if (!video) throw new ApiError('INVALID_TIKTOK_URL', 'Paste a full HTTPS TikTok video URL, such as https://www.tiktok.com/@creator/video/VIDEO_ID. Open shortened share links in TikTok first, then copy the full video URL.', 400);
    res.status(201).json(store.saveTikTok(anime.id, video));
  });
  app.delete('/api/anime/:id/tiktok/:videoId', (req, res) => {
    const anime = imported(req.params.id);
    res.json({ removed: store.deleteTikTok(anime.id, tiktokIdSchema.parse(req.params.videoId)) });
  });
}
