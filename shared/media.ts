import { z } from 'zod';

export const youtubeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const tiktokIdSchema = z.string().regex(/^[1-9]\d{14,21}$/);
export const trailerSchema = z.object({ videoId: youtubeIdSchema, source: z.enum(['AniList', 'Jikan / MyAnimeList']) });
export type Trailer = z.infer<typeof trailerSchema>;
export const tiktokVideoSchema = z.object({ videoId: tiktokIdSchema, creator: z.string().regex(/^[A-Za-z0-9_.]{1,24}$/), url: z.string().regex(/^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9_.]{1,24}\/video\/[1-9]\d{14,21}$/) });
export const savedTikTokSchema = tiktokVideoSchema.extend({ savedAt: z.iso.datetime() });
export type TikTokVideo = z.infer<typeof tiktokVideoSchema>;
export type SavedTikTok = z.infer<typeof savedTikTokSchema>;
export const trailerResponseSchema = z.object({ trailer: trailerSchema.nullable(), checkedAt: z.iso.datetime(), warnings: z.array(z.string()) });
export type TrailerResponse = z.infer<typeof trailerResponseSchema>;

export function youtubeTrailer(id: unknown, source: Trailer['source']): Trailer | null {
  const parsed = youtubeIdSchema.safeParse(id);
  return parsed.success ? { videoId: parsed.data, source } : null;
}

export function parseTikTokUrl(value: string): TikTokVideo | null {
  if (value.length > 500) return null;
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { return null; } // Invalid input is reported by the form/API, never fetched.
  if (url.protocol !== 'https:' || !['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
  const path = /^\/@([A-Za-z0-9_.]{1,24})\/video\/([1-9]\d{14,21})\/?$/.exec(url.pathname);
  if (!path?.[1] || !path[2]) return null;
  return { creator: path[1], videoId: path[2], url: `https://www.tiktok.com/@${path[1]}/video/${path[2]}` };
}

export function youtubeSearch(title: string): string { return `https://www.youtube.com/results?${new URLSearchParams({ search_query: `${title} official anime trailer` })}`; }
export function tiktokSearch(title: string): string { return `https://www.tiktok.com/search?${new URLSearchParams({ q: `${title} anime reviews recommendations edits` })}`; }
export function playerUrl(kind: 'youtube' | 'tiktok', id: string): string {
  return kind === 'youtube'
    ? `https://www.youtube-nocookie.com/embed/${youtubeIdSchema.parse(id)}?autoplay=0&playsinline=1&rel=0`
    : `https://www.tiktok.com/player/v1/${tiktokIdSchema.parse(id)}?autoplay=0&loop=0&rel=0`;
}
