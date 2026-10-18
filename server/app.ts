import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { z } from 'zod';
import { providerSchema, type ImportProgress } from '../shared/model.js';
import { importAniList, importMal } from './importers.js';
import { MetadataService } from './metadata.js';
import { LibraryStore, libraryId } from './storage.js';
import { ApiError, UpstreamClient } from './upstream.js';
import { configureAi, type AiConfiguration } from './recommendations/config.js';
import { RecommendationService } from './recommendations/service.js';
import { registerRecommendationRoutes } from './recommendations/routes.js';
import { AiRateLimitError } from './recommendations/google.js';
import { registerMediaRoutes, TrailerService } from './media.js';

interface AppOptions { store: LibraryStore; client: UpstreamClient; malClientId: string; dev?: boolean; ai?: AiConfiguration }
const importSchema = z.object({ provider: providerSchema, username: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, 'Use a username of up to 32 letters, numbers, hyphens or underscores.'), refresh: z.boolean().default(false) });
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createApp({ store, client, malClientId, dev = false, ai = configureAi({}) }: AppOptions): Express {
  const app = express();
  const jobs = new Map<string, ImportProgress>();
  let activeJob: string | null = null;
  const metadata = new MetadataService(store, client);
  const recommendations = new RecommendationService(store, ai);
  const currentMalClientId = () => store.getMalClientId() || malClientId;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    const host = req.headers.host;
    let hostname: string;
    try { hostname = new URL(`http://${host ?? ''}`).hostname; }
    catch { return res.status(403).json({ error: { code: 'LOCAL_ONLY', message: 'Use the localhost address to open AniPick.' } }); }
    if (!localHosts.has(hostname)) return res.status(403).json({ error: { code: 'LOCAL_ONLY', message: 'AniPick only accepts localhost requests.' } });
    const origin = req.headers.origin;
    if (origin) {
      let allowed: boolean;
      try {
        const parsed = new URL(origin);
        allowed = parsed.protocol === 'http:' && localHosts.has(parsed.hostname) && (parsed.host === host || (dev && parsed.port === '5173'));
      } catch { allowed = false; }
      if (!allowed) return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Open AniPick directly on localhost.' } });
    }
    next();
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '2kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, malConfigured: Boolean(currentMalClientId()) }));
  app.post('/api/settings/mal', async (req, res) => {
    if (activeJob) throw new ApiError('IMPORT_BUSY', 'Wait for the current import to finish before updating MAL setup.', 409);
    const input = z.strictObject({ clientId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,256}$/) }).safeParse(req.body);
    if (!input.success) throw new ApiError('MAL_CLIENT_ID_INVALID', 'Paste the Client ID from your MAL application, not a URL, client secret, or Google AI Studio key.', 400);
    const { clientId } = input.data;
    if (/^AIza/.test(clientId)) throw new ApiError('WRONG_PROVIDER_KEY', 'That looks like a Google AI Studio key. MAL needs the Client ID from your MyAnimeList application.', 400);
    const verified = z.object({ id: z.literal(1) }).safeParse(await client.json('https://api.myanimelist.net/v2/anime/1?fields=id', { headers: { 'X-MAL-CLIENT-ID': clientId, Accept: 'application/json' } }, 1100));
    if (!verified.success) throw new ApiError('MAL_SETUP_FAILED', 'MAL did not confirm access. Check the Client ID and retry.', 502);
    store.saveMalClientId(clientId);
    res.json({ malConfigured: true });
  });
  app.get('/api/libraries', (_req, res) => res.json({ libraries: store.list() }));
  app.get('/api/imports', (_req, res) => res.json({ job: activeJob ? jobs.get(activeJob) : null }));
  app.get('/api/libraries/:id', (req, res) => {
    const library = store.get(req.params.id);
    if (!library) throw new ApiError('LIBRARY_NOT_FOUND', 'This saved library was not found. Import the username again.', 404);
    res.json(library);
  });
  app.delete('/api/libraries/:id', (req, res) => {
    if (activeJob || recommendations.isBusy()) throw new ApiError('LIBRARY_BUSY', 'Wait for the current import or AI analysis to finish before removing a saved list.', 409);
    if (!store.remove(req.params.id)) throw new ApiError('LIBRARY_NOT_FOUND', 'This saved list was already removed or does not exist.', 404);
    for (const [id, job] of jobs) if (job.libraryId === req.params.id) jobs.delete(id);
    res.json({ removed: true });
  });
  app.post('/api/imports', (req, res) => {
    const input = importSchema.parse(req.body);
    const importClientId = currentMalClientId();
    if (input.provider === 'mal' && !importClientId) throw new ApiError('MAL_NOT_CONFIGURED', 'Enable MyAnimeList in the import panel with your MAL application Client ID, or add MAL_CLIENT_ID to .env and restart. Your Google key is only for AI recommendations.', 503);
    const id = libraryId(input.provider, input.username);
    const cached = store.get(id);
    if (activeJob) throw new ApiError('IMPORT_BUSY', 'An import is already running. Wait for it to finish, then retry.', 409);
    if (cached && input.refresh && Date.now() - Date.parse(cached.importedAt) < 60000) throw new ApiError('REFRESH_TOO_SOON', 'This list was just imported. Wait one minute before refreshing; your saved list is available now.', 429);
    if (jobs.size >= 20) jobs.delete(jobs.keys().next().value ?? '');
    const job: ImportProgress = { id: randomUUID(), state: 'running', pages: 0, imported: 0, message: 'Connecting to your anime list…' };
    jobs.set(job.id, job);
    if (cached && !input.refresh) {
      Object.assign(job, { state: 'complete', libraryId: cached.id, imported: cached.entries.length, message: 'Opened your saved list. Use Refresh list to fetch changes.' });
      return res.status(200).json(job);
    }
    activeJob = job.id;
    const progress = (pages: number, imported: number, message: string) => { Object.assign(job, { pages, imported, message }); };
    const run = async () => {
      try {
        const result = input.provider === 'anilist' ? await importAniList(input.username, client, progress) : await importMal(input.username, importClientId, client, progress);
        const saved = store.save(input.provider, result.username, result.entries);
        Object.assign(job, { state: 'complete', libraryId: saved.id, imported: saved.entries.length, message: `Saved ${saved.entries.length} anime locally.` });
      } catch (error) {
        const failure = publicError(error);
        Object.assign(job, { state: 'failed', message: failure.message, error: { code: failure.code, message: failure.message } });
      } finally { activeJob = null; }
    };
    void run();
    res.status(202).json(job);
  });
  app.get('/api/imports/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) throw new ApiError('IMPORT_NOT_FOUND', 'This import is no longer tracked, possibly because the server restarted. Open the saved list or retry the import.', 404);
    res.json(job);
  });
  app.get('/api/metadata/:malId', async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.malId);
    if (!store.hasMalId(id)) throw new ApiError('ANIME_NOT_IMPORTED', 'Import this anime in a watchlist before fetching extra metadata.', 404);
    res.json(await metadata.get(id));
  });
  registerRecommendationRoutes(app, recommendations);
  registerMediaRoutes(app, store, new TrailerService(store, client, metadata));
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This API route does not exist.' } }));
  const clientPath = resolve('dist/client');
  if (!dev && existsSync(resolve(clientPath, 'index.html'))) {
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.tiktok.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      next();
    });
    app.use(express.static(clientPath));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(clientPath, 'index.html')));
  }
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) { _next(error); return; }
    const failure = publicError(error);
    if (error instanceof AiRateLimitError) res.setHeader('Retry-After', String(error.retryAfterSeconds));
    res.status(failure.status).json({ error: { code: failure.code, message: failure.message } });
  };
  app.use(onError);
  return app;
}

function publicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) return new ApiError('INVALID_DATA', 'The request or provider data did not match the expected format. Check your username and retry. Your saved list is unchanged.', 400);
  if (error instanceof SyntaxError) return new ApiError('INVALID_JSON', 'The request contains invalid JSON.', 400);
  // Never return raw upstream exceptions: request details may contain server configuration.
  return new ApiError('INTERNAL_ERROR', 'AniPick could not complete this operation. Check that local storage is writable, then retry.');
}
