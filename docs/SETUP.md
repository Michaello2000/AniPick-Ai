# Installation and configuration

[README](../README.md) · [Setup](SETUP.md) · [Local AI](LOCAL_AI.md) · [Recommendations](RECOMMENDATIONS.md) · [Media](MEDIA.md) · [Testing](TESTING.md)

AniPick runs on your own machine. Imports, uncached artwork and metadata, cloud inference, and loaded video embeds use external services. Saved-list browsing remains available without AI or an upstream request.

## Run locally

Requires **Node.js 24+** (uses built-in `node:sqlite`) and **pnpm 11+**. No database installation, public domain, cloud hosting, or AI key is needed.

The Google key is needed only for new cloud recommendations; local inference needs a running compatible server instead. If PowerShell says `pnpm` is not recognized, install Node.js 24+ from the [official download page](https://nodejs.org/en/download), reopen PowerShell, and run `npm.cmd install --global pnpm@11.25.0`. Use `pnpm.cmd` in place of `pnpm` if PowerShell script execution is restricted. Tools available inside a coding agent's environment may not be on your terminal's PATH.

```powershell
pnpm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API runs at `127.0.0.1:3001`; Vite proxies `/api` to it. Both bind to loopback. Stop both with Ctrl+C.

Production mode, entirely on your own machine:

```powershell
pnpm build
pnpm start
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). Express serves the built React app and API together. `.env` is read by both launch commands. An empty database is created automatically on first run.

## Importing real lists

### AniList

Select **AniList**, enter a public username, and choose **Import list**. No key or OAuth is needed. The importer reads the user's scoring format, then retrieves every `MediaListCollection` chunk, including every list status. Custom-list duplicates are deduplicated by provider ID. Scores explicitly request the user's native scale and a separate AniList conversion to 100 points; an unspecified score format is unreliable in collection responses.

### MyAnimeList

**Hosted Jikan no longer exposes full user anime lists.** Its [published deprecation notice](https://jikan.docs.apiary.io/) records removal of these endpoints in May 2022. Calling the removed endpoint, or using favorites/history instead, cannot import a complete watchlist.

AniPick uses the **official MAL v2 public-list API** for list membership, status, ratings, and baseline metadata. **Jikan v4** supplies additional anime synopsis, genres, themes, and demographics on opening a detail view. This is metadata enrichment, not a media integration. It is lazy-loaded and cached in SQLite for seven days. A Jikan failure leaves imported details and browsing available.

To enable MAL:

1. Sign in to your own MAL account and register an application at [MAL API configuration](https://myanimelist.net/apiconfig). Follow MAL's current registration requirements and use localhost application/callback URLs where accepted. AniPick itself does not perform an OAuth callback.
2. Put the application's **client ID** in `.env`:

   ```dotenv
   MAL_CLIENT_ID=your_application_client_id
   ```

3. Restart AniPick. Select **MyAnimeList** and import a public username.

The app sends `X-MAL-CLIENT-ID` from the server. **Viewers do not need OAuth or a login.** A client secret or access token is not used. Never put credentials into `VITE_*` variables, URLs, browser code, or source control. `.env` is ignored. Without a client ID, MAL displays an explicit setup error; AniList and saved libraries still work.

On a freshly cloned copy, `.env.example` contains empty credentials on purpose. Your Google AI Studio key enables cloud recommendations; it cannot authenticate MAL imports. **You can now configure MAL on the import page:** select MyAnimeList, follow the registration link, paste your application's **Client ID**, and choose **Save and enable MAL**. AniPick validates it with the official API before saving it in the local, ignored SQLite database; imports become available immediately without a restart. Invalid credentials are not saved, and the stored ID is never returned to the browser. A saved ID takes precedence over `MAL_CLIENT_ID` in `.env`; the environment-variable setup remains supported. AniList imports need neither credential. If the UI reports an unreadable API response, launch `pnpm dev` (both frontend and backend), rather than Vite alone.

MAL retrieves all statuses with 500-entry offset pagination and follows only validated offsets under the original official API path. Rich metadata is requested alongside list entries, avoiding thousands of Jikan calls during import. IDs, never title similarity, link Jikan enrichment to MAL entries.

## Imported data and library behavior

The interface has separate **Library** and **Pick for Me** destinations. **Import list** opens the library manager with both provider choices and saved-account switching. Search and sorting stay visible; **Filters** reveals genre and total-length controls. Pick for Me keeps length, mood, cloud consent, and the primary action visible, with advanced preferences and provider diagnostics in disclosures. Returning to Library preserves an in-progress AI request and current preferences. The visual system is documented in [Design](../DESIGN.md); Manrope is self-hosted, so no font CDN request is needed.

- Equally visible username import choices; no demo data in the application.
- All relevant statuses, including AniList rewatching; progress and rewatch metadata where provided.
- Stable provider-prefixed IDs and explicit AniList/MAL cross-reference IDs when supplied by the source. Separate accounts and providers remain separate libraries.
- Personal scores retain source values and scale; zero/unscored becomes **Unrated**, not a negative taste signal. Community scores remain separate and preserve their source scale. Cover badges display community scores converted to `/10`.
- Title variants, poster, plain-text synopsis, genres/tags, format, total episodes, airing status, release year, source timestamps, and list metadata where supplied. Missing metadata stays unknown. MAL does not supply a meaningful list-entry creation date, so AniPick does not invent one.
- Dark responsive UI, keyboard-accessible controls and native detail dialog, lazy cover images, saved-account switching, status browsing, title search, genre filter, and sorting.
- **Plan to Watch** is the default. Total anime length filters are unrestricted, **≤12**, **≤24**, **movie**, and **≥25** episodes. Unknown episode counts appear only under unrestricted length, or movie when the format is known to be a movie. Movies can also match numeric episode boundaries.
- Atomic SQLite snapshots. Only a fully successful import replaces the saved library. Refreshes never erase a previous list on a page or network failure. A successful empty import is saved as empty.
- Visible page/count progress, manual retry and refresh controls, active-import recovery after browser reload, transient retry with bounded exponential backoff, `Retry-After` support, conservative provider pacing, and a one-minute refresh cooldown.
- Search/sort/filter and saved-list browsing need no upstream call. Poster loading and uncached detail enrichment do require a network connection.

Pick for Me adds explicit, consented AI taste analysis and mood-based ranking. Anime details include source-listed YouTube trailers, search fallbacks, TikTok discovery, and saved community video links, as described in [Media](MEDIA.md). External account writes and an automated dub-data integration are not implemented. Imported dub availability remains **Unknown** unless an attributable server-side record exists; the UI disables the verified-dub filter when there are no such records.

The application includes no user authentication, payments, or public-hosting setup.

## Persistence and configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Local API/production server port; Vite uses the same configured target. |
| `ANIPICK_DB_PATH` | `./data/anipick.sqlite` | Durable local SQLite database, relative to launch directory. |
| `MAL_CLIENT_ID` | unset | Server-only application client ID for public MAL lists. |
| `GEMINI_API_KEY` | unset | Server-only Google AI Studio key for Gemma inference. |
| `AI_PROVIDER` | `google` | Startup default: `google` or `local`; the UI can switch without changing Google configuration. |
| `AI_MODEL` | `gemma-4-26b-a4b-it` | Configurable Gemma 4 instruction-tuned model ID. Access is checked with the configured key. |

Run commands from the repository root. The ignored `data/` directory contains watchlists, metadata, and SQLite WAL files. Back it up with the app stopped. This is local storage, not encryption or browser-local storage; other users with filesystem access can read it. Removing it intentionally resets the library.

The complete safe example also ships in [.env.example](../.env.example). Empty values are intentional; insert your own credentials locally:

```dotenv
PORT=3001
ANIPICK_DB_PATH=./data/anipick.sqlite
MAL_CLIENT_ID=
GEMINI_API_KEY=
AI_PROVIDER=google
AI_MODEL=gemma-4-26b-a4b-it
```

Completed lists and metadata survive process restarts. Active import jobs are held in memory: if the server restarts, retry the import; the last saved snapshot remains. Imports run one at a time. Large lists can take minutes. A 200-chunk/page safety ceiling fails explicitly rather than saving a truncated list. Lists are not automatically refreshed; use **Refresh list**. After seven days, Jikan metadata is refreshed on demand.

To remove an imported library, open **Manage libraries**, choose **Remove** beside its saved account, and confirm. This deletes that local library snapshot, never the external AniList/MAL list. Other saved libraries remain; removing the active one opens another, or returns to the import screen when none remain. All derived AI caches are cleared because existing hashed cache entries have no per-account index. Shared anime metadata and saved video links remain. Removal waits until current imports/AI analyses finish so an in-flight operation cannot restore deleted data. Refresh/restart does not bring the removed list back unless you import it again.

There is no analytics. Import requests go to the chosen anime provider; details with a known MAL ID may call Jikan. Cover art loads from third-party image hosts. Only an explicit Pick for Me request with cloud consent sends a bounded watchlist sample to Google. External synopses and model prose are rendered as text. The local API checks Host and Origin and the production app uses a restrictive content security policy.

### Local AI environment variables

The complete example includes the following server-only local settings. See [Local AI](LOCAL_AI.md) for runtime compatibility, sampling and Windows setup.

- `LOCAL_AI_BASE_URL`: `http://127.0.0.1:8080/v1`; HTTP loopback only.
- `LOCAL_AI_MODEL`: empty; choose the exact discovered model ID.
- `LOCAL_AI_RUNTIME`: `llamacpp`; alternatives are `ollama` and `lmstudio`.
- `LOCAL_AI_TIMEOUT_MS`: `600000`; whole-operation deadline, from 30,000 to 1,800,000 ms.
- `LOCAL_AI_MAX_TOKENS`: `16384`; output budget, from 1,024 to 65,536 tokens.
- `LOCAL_AI_SAMPLING`: `auto`; alternatives are `generic`, `bonsai2-small` and `bonsai2-27b`.
- `LOCAL_AI_API_KEY`: empty; optional authentication for the local server, never sent to Google.

## Troubleshooting

- **MAL setup unavailable:** a Google key cannot authenticate MAL. Supply the application's Client ID, not a secret or access token. UI-saved credentials override the environment value.
- **Unreadable API response:** use `pnpm dev` to launch both services. Vite alone does not start the API.
- **Port already in use:** stop the conflicting process; the frontend uses port 5173, and `PORT` configures the API and Vite proxy target.
- **AI unavailable:** saved-list browsing still works. See [cloud configuration](RECOMMENDATIONS.md#configure-and-test-real-ai), [local setup](LOCAL_AI.md), and [verification limits](TESTING.md).

## API references

- [AniList GraphQL documentation](https://docs.anilist.co/) and [MediaList scoring fields](https://docs.anilist.co/reference/object/medialist).
- [MAL official API v2 reference](https://myanimelist.net/apiconfig/references/api/v2).
- [Jikan v4 reference](https://docs.api.jikan.moe/) and [user-list removal notice](https://jikan.docs.apiary.io/).
