import { z } from 'zod';
import type { AnimeMetadata } from '../shared/model.js';
import { youtubeTrailer } from '../shared/media.js';
import { plainText } from './normalize.js';
import type { LibraryStore } from './storage.js';
import type { UpstreamClient } from './upstream.js';

const names = z.array(z.object({ name: z.string() })).nullish();
const responseSchema = z.object({ data: z.object({ mal_id: z.number().int().positive(), synopsis: z.string().nullish(), genres: names, themes: names, demographics: names, trailer: z.object({ youtube_id: z.string().nullish() }).nullish() }) });

export class MetadataService {
  private readonly pending = new Map<number, Promise<AnimeMetadata>>();
  constructor(private readonly store: LibraryStore, private readonly client: UpstreamClient) {}

  async get(id: number): Promise<AnimeMetadata> {
    const cached = this.store.getMetadata(id);
    if (cached && cached.trailer !== undefined) return cached;
    const existing = this.pending.get(id);
    if (existing) return existing;
    const request = this.fetch(id);
    this.pending.set(id, request);
    try { return await request; }
    finally { this.pending.delete(id); }
  }
  private async fetch(id: number): Promise<AnimeMetadata> {
    const { data } = responseSchema.parse(await this.client.json(`https://api.jikan.moe/v4/anime/${id}`, {}, 1100));
    if (data.mal_id !== id) throw new Error('Jikan returned metadata for a different anime.');
    const metadata: AnimeMetadata = {
      malId: id, synopsis: plainText(data.synopsis), genres: (data.genres ?? []).map(item => item.name),
      tags: [...(data.themes ?? []), ...(data.demographics ?? [])].map(item => item.name),
      source: 'Jikan / MyAnimeList', fetchedAt: new Date().toISOString(),
      trailer: youtubeTrailer(data.trailer?.youtube_id, 'Jikan / MyAnimeList'),
    };
    this.store.saveMetadata(metadata);
    return metadata;
  }
}
