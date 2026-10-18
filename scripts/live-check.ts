import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { importAniList, importMal } from '../server/importers.js';
import { MetadataService } from '../server/metadata.js';
import { LibraryStore } from '../server/storage.js';
import { ApiError, UpstreamClient } from '../server/upstream.js';
import type { ListStatus } from '../shared/model.js';

// Opt-in smoke test against public accounts. Never adds them to the app's database.
const username = process.argv[2] ?? 'derF';
const client = new UpstreamClient();
const directory = mkdtempSync(join(tmpdir(), 'anipick-live-'));
const target = resolve(directory);
if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error('Refusing temporary storage outside the temporary directory.');
const store = new LibraryStore(join(directory, 'live.sqlite'));
function failed(check: string, error: unknown) {
  console.error(`${check}: FAIL`, error instanceof ApiError ? `${error.code}: ${error.message}` : 'Unexpected response or persistence failure.');
  process.exitCode = 1;
}
try {
  let malId: number | null | undefined;
  try {
    const result = await importAniList(username, client, (pages, count, message) => { console.log(`[AniList] ${pages} pages / ${count} anime: ${message}`); });
    const saved = store.save('anilist', result.username, result.entries);
    if (store.get(saved.id)?.entries.length !== result.entries.length) throw new Error('Persistence check failed.');
    const counts: Record<ListStatus, number> = { planning: 0, watching: 0, completed: 0, paused: 0, dropped: 0 };
    for (const anime of result.entries) counts[anime.status]++;
    console.log('AniList + normalized schema + SQLite: PASS', JSON.stringify({ username: result.username, count: result.entries.length, statuses: counts }));
    malId = result.entries.find(entry => entry.sourceIds.mal)?.sourceIds.mal;
  } catch (error) { failed('AniList live import', error); }
  if (malId) {
    try {
      const service = new MetadataService(store, client);
      const metadata = await service.get(malId);
      if (metadata.malId !== malId || !store.getMetadata(malId)) throw new Error('Jikan metadata cache check failed.');
      console.log('Jikan metadata + cache: PASS', JSON.stringify({ malId, genreCount: metadata.genres.length, tagCount: metadata.tags.length }));
    } catch (error) { failed('Jikan live metadata', error); }
  } else { console.log('Jikan metadata: SKIPPED (no mapped MAL ID in this account)'); }
  const malClientId = process.env.MAL_CLIENT_ID?.trim();
  if (malClientId) {
    try {
      const mal = await importMal(process.argv[3] ?? 'Xinil', malClientId, client, (pages, count) => { console.log(`[MAL] ${pages} pages / ${count} anime`); });
      const savedMal = store.save('mal', mal.username, mal.entries);
      console.log('MAL public list + schema + SQLite: PASS', JSON.stringify({ username: mal.username, count: savedMal.entries.length }));
    } catch (error) { failed('MAL live import', error); }
  } else { console.log('MAL live import: SKIPPED (MAL_CLIENT_ID is not configured).'); }
} finally {
  store.close();
  rmSync(target, { recursive: true, force: true });
}
