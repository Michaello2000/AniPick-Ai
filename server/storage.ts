import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { librarySchema, metadataSchema, type Anime, type AnimeMetadata, type Library, type LibrarySummary, type Provider } from '../shared/model.js';
import { savedTikTokSchema, tiktokVideoSchema, trailerResponseSchema, type TikTokVideo, type SavedTikTok, type TrailerResponse } from '../shared/media.js';

export function libraryId(provider: Provider, username: string): string { return `${provider}:${username.toLowerCase()}`; }
const rowSchema = z.object({ payload: z.string() });

export class LibraryStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS libraries (id TEXT PRIMARY KEY, imported_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (mal_id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_cache (cache_key TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trailers (anime_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tiktok_videos (anime_id TEXT NOT NULL, video_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (anime_id, video_id));`);
  }
  save(provider: Provider, username: string, entries: Anime[]): Library {
    const library = librarySchema.parse({ id: libraryId(provider, username), provider, username, importedAt: new Date().toISOString(), entries });
    // A single SQLite statement atomically replaces the complete snapshot, never a partial import.
    this.db.prepare('INSERT INTO libraries (id, imported_at, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET imported_at=excluded.imported_at, payload=excluded.payload')
      .run(library.id, library.importedAt, JSON.stringify(library));
    return library;
  }
  getMalClientId(): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE name = ?').get('mal_client_id');
    return row ? z.object({ value: z.string() }).parse(row).value : null;
  }
  saveMalClientId(clientId: string): void {
    this.db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run('mal_client_id', clientId);
  }
  get(id: string): Library | null {
    const row = this.db.prepare('SELECT payload FROM libraries WHERE id = ?').get(id);
    return row ? librarySchema.parse(JSON.parse(rowSchema.parse(row).payload)) : null;
  }
  remove(id: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const removed = this.db.prepare('DELETE FROM libraries WHERE id = ?').run(id).changes > 0;
      // Existing cache keys are hashes without an account index. Clear derived AI
      // caches so a removed library's taste analysis cannot remain cached.
      if (removed) this.db.exec('DELETE FROM ai_cache');
      this.db.exec('COMMIT');
      return removed;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(): LibrarySummary[] {
    return this.db.prepare('SELECT payload FROM libraries ORDER BY imported_at DESC, id').all().map(row => {
      const { entries, ...summary } = librarySchema.parse(JSON.parse(rowSchema.parse(row).payload));
      return { ...summary, count: entries.length, planning: entries.filter(entry => entry.status === 'planning').length };
    });
  }
  hasMalId(id: number): boolean {
    return this.list().some(library => this.get(library.id)?.entries.some(entry => entry.sourceIds.mal === id));
  }
  getAnime(id: string): Anime | null {
    for (const library of this.list()) {
      const anime = this.get(library.id)?.entries.find(entry => entry.id === id);
      if (anime) return anime;
    }
    return null;
  }
  getTrailer(id: string): TrailerResponse | null {
    const row = this.db.prepare('SELECT payload FROM trailers WHERE anime_id = ?').get(id);
    if (!row) return null;
    const result = trailerResponseSchema.parse(JSON.parse(rowSchema.parse(row).payload));
    return Date.now() - Date.parse(result.checkedAt) < 7 * 24 * 60 * 60 * 1000 ? result : null;
  }
  saveTrailer(id: string, trailer: TrailerResponse): void {
    const result = trailerResponseSchema.parse(trailer);
    this.db.prepare('INSERT INTO trailers (anime_id, payload) VALUES (?, ?) ON CONFLICT(anime_id) DO UPDATE SET payload=excluded.payload').run(id, JSON.stringify(result));
  }
  getTikToks(id: string): SavedTikTok[] {
    return this.db.prepare('SELECT payload FROM tiktok_videos WHERE anime_id = ? ORDER BY rowid DESC').all(id).map(row => savedTikTokSchema.parse(JSON.parse(rowSchema.parse(row).payload)));
  }
  saveTikTok(id: string, input: TikTokVideo): SavedTikTok {
    const parsed = tiktokVideoSchema.parse(input);
    const existing = this.getTikToks(id).find(video => video.videoId === parsed.videoId);
    if (existing) return existing;
    const saved = savedTikTokSchema.parse({ ...parsed, savedAt: new Date().toISOString() });
    this.db.prepare('INSERT INTO tiktok_videos (anime_id, video_id, payload) VALUES (?, ?, ?)').run(id, saved.videoId, JSON.stringify(saved));
    return saved;
  }
  deleteTikTok(id: string, videoId: string): boolean {
    return this.db.prepare('DELETE FROM tiktok_videos WHERE anime_id = ? AND video_id = ?').run(id, videoId).changes > 0;
  }
  getMetadata(id: number): AnimeMetadata | null {
    const row = this.db.prepare('SELECT payload FROM metadata WHERE mal_id = ?').get(id);
    if (!row) return null;
    const metadata = metadataSchema.parse(JSON.parse(rowSchema.parse(row).payload));
    return Date.now() - Date.parse(metadata.fetchedAt) < 7 * 24 * 60 * 60 * 1000 ? metadata : null;
  }
  saveMetadata(metadata: AnimeMetadata): void {
    const parsed = metadataSchema.parse(metadata);
    this.db.prepare('INSERT INTO metadata (mal_id, payload) VALUES (?, ?) ON CONFLICT(mal_id) DO UPDATE SET payload=excluded.payload').run(parsed.malId, JSON.stringify(parsed));
  }
  getAiCache(key: string, kind: 'profile' | 'recommendation'): unknown {
    const row = this.db.prepare('SELECT payload FROM ai_cache WHERE cache_key = ? AND kind = ? AND expires_at > ?').get(key, kind, new Date().toISOString());
    return row ? JSON.parse(rowSchema.parse(row).payload) : null;
  }
  saveAiCache(key: string, kind: 'profile' | 'recommendation', payload: object, lifetimeMs: number): void {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO ai_cache (cache_key, kind, created_at, expires_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET created_at=excluded.created_at, expires_at=excluded.expires_at, payload=excluded.payload')
      .run(key, kind, now, new Date(Date.now() + lifetimeMs).toISOString(), JSON.stringify(payload));
    this.db.prepare('DELETE FROM ai_cache WHERE expires_at <= ?').run(now);
    this.db.prepare('DELETE FROM ai_cache WHERE cache_key IN (SELECT cache_key FROM ai_cache WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 100)').run(kind);
  }
  close(): void { this.db.close(); }
}
