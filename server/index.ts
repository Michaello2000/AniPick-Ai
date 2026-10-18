import { resolve } from 'node:path';
import { createApp } from './app.js';
import { LibraryStore } from './storage.js';
import { UpstreamClient } from './upstream.js';
import { configureAi } from './recommendations/config.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const store = new LibraryStore(resolve(process.env.ANIPICK_DB_PATH ?? 'data/anipick.sqlite'));
const app = createApp({ store, client: new UpstreamClient(), malClientId: process.env.MAL_CLIENT_ID?.trim() ?? '', dev: process.env.NODE_ENV !== 'production' && import.meta.url.endsWith('.ts'), ai: configureAi(process.env) });
const server = app.listen(port, '127.0.0.1', () => { console.log(`AniPick API: http://127.0.0.1:${port}`); });
server.on('error', error => { console.error(`Could not start AniPick: ${error.message}`); store.close(); process.exitCode = 1; });
function shutdown() { server.close(() => { store.close(); }); server.closeIdleConnections(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
