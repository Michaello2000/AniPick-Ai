# AniPick

Your next watch is already on your list. AniPick is a new, localhost-first anime watchlist companion built for Hacktoberfest 2026 Week 2. This repository was implemented from scratch; no previous AniPick code was used.

**Milestones 1–4: real imports, a durable watchlist browser, open-weight AI recommendations, a dedicated interface redesign, and anime previews.** Pick for Me calls the real model when a server-side Google AI Studio key is configured. Real default-settings generation has been verified through the backend, as detailed below. No demo recommendations or fake model fallback are included.

The interface has separate **Library** and **Pick for Me** destinations. **Import list** opens the library manager, where AniList and MyAnimeList are equally accessible and saved collections can be switched. Search and sorting stay visible; **Filters** reveals genre and total-length options. Pick for Me leads with length and mood, keeps explicit cloud consent visible, and places advanced preferences and provider diagnostics in disclosures. Navigating back to Library preserves an in-progress AI request and current preferences.

The visual system is documented in [DESIGN.md](DESIGN.md), with product constraints in [PRODUCT.md](PRODUCT.md). Anime artwork always comes from the real imported library. Manrope is self-hosted under its bundled SIL Open Font License; the browser does not contact a font CDN.

## Screenshots

**Actual application screenshots are still pending.** Browser access in this audit environment reports “Local browser use is disabled in Work settings.” No reference-site image or mockup is presented as AniPick.

Before submission, capture the running app with a real imported library: desktop Library, Pick for Me with a successful real result, anime details/trailer, and a phone-width view. Save the images under `docs/screenshots/` and embed them here. Crop account names if desired and keep keys/configuration files out of captures. Rendered desktop/mobile, keyboard/focus, and playback review also remain outstanding.

## Run locally

Requires **Node.js 24+** (uses built-in `node:sqlite`) and **pnpm 11+**. No database installation, public domain, cloud hosting, or AI key is needed.

The AI key is needed only for new recommendations. If PowerShell says `pnpm` is not recognized, install Node.js 24+ from the [official download page](https://nodejs.org/en/download), reopen PowerShell, and run `npm.cmd install --global pnpm@11.25.0`. Use `pnpm.cmd` in place of `pnpm` if PowerShell script execution is restricted. Tools available inside a coding agent's environment may not be on your terminal's PATH.

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

### MyAnimeList: required API correction

**Hosted Jikan no longer exposes full user anime lists.** Its [published deprecation notice](https://jikan.docs.apiary.io/) records removal of these endpoints in May 2022. Calling the removed endpoint, or using favorites/history instead, cannot import a complete watchlist.

With the developer's approval, AniPick uses the **official MAL v2 public-list API** for list membership, status, ratings, and baseline metadata. **Jikan v4** supplies additional anime synopsis, genres, themes, and demographics on opening a detail view. This is metadata enrichment, not a media integration. It is lazy-loaded and cached in SQLite for seven days. A Jikan failure leaves imported details and browsing available.

To enable MAL:

1. Sign in to your own MAL account and register an application at [MAL API configuration](https://myanimelist.net/apiconfig). Follow MAL's current registration requirements and use localhost application/callback URLs where accepted. AniPick itself does not perform an OAuth callback.
2. Put the application's **client ID** in `.env`:

   ```dotenv
   MAL_CLIENT_ID=your_application_client_id
   ```

3. Restart AniPick. Select **MyAnimeList** and import a public username.

The app sends `X-MAL-CLIENT-ID` from the server. **Viewers do not need OAuth or a login.** A client secret or access token is not used. Never put credentials into `VITE_*` variables, URLs, browser code, or source control. `.env` is ignored. Without a client ID, MAL displays an explicit setup error; AniList and saved libraries still work.

MAL retrieves all statuses with 500-entry offset pagination and follows only validated offsets under the original official API path. Rich metadata is requested alongside list entries, avoiding thousands of Jikan calls during import. IDs, never title similarity, link Jikan enrichment to MAL entries.

## What is implemented

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

Pick for Me adds explicit, consented AI taste analysis and mood-based ranking. Anime details include source-listed YouTube trailers, search fallbacks, TikTok discovery, and saved community video links, as described below. External account writes and an automated dub-data integration are not implemented. Imported dub availability remains **Unknown** unless an attributable server-side record exists; the UI disables the verified-dub filter when there are no such records.

## Persistence and configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Local API/production server port; Vite uses the same configured target. |
| `ANIPICK_DB_PATH` | `./data/anipick.sqlite` | Durable local SQLite database, relative to launch directory. |
| `MAL_CLIENT_ID` | unset | Server-only application client ID for public MAL lists. |
| `GEMINI_API_KEY` | unset | Server-only Google AI Studio key for Gemma inference. |
| `AI_PROVIDER` | `google` | Current adapter; the provider-neutral interface permits future adapters. |
| `AI_MODEL` | `gemma-4-26b-a4b-it` | Configurable Gemma 4 instruction-tuned model ID. Access is checked with the configured key. |

Run commands from the repository root. The ignored `data/` directory contains watchlists, metadata, and SQLite WAL files. Back it up with the app stopped. This is local storage, not encryption or browser-local storage; other users with filesystem access can read it. Removing it intentionally resets the library.

The complete safe example also ships in [.env.example](.env.example). Empty values are intentional; insert your own credentials locally:

```dotenv
PORT=3001
ANIPICK_DB_PATH=./data/anipick.sqlite
MAL_CLIENT_ID=
GEMINI_API_KEY=
AI_PROVIDER=google
AI_MODEL=gemma-4-26b-a4b-it
```

Completed lists and metadata survive process restarts. Active import jobs are held in memory: if the server restarts, retry the import; the last saved snapshot remains. Imports run one at a time. Large lists can take minutes. A 200-chunk/page safety ceiling fails explicitly rather than saving a truncated list. Lists are not automatically refreshed; use **Refresh list**. After seven days, Jikan metadata is refreshed on demand.

There is no analytics. Import requests go to the chosen anime provider; details with a known MAL ID may call Jikan. Cover art loads from third-party image hosts. Only an explicit Pick for Me request with cloud consent sends a bounded watchlist sample to Google. External synopses and model prose are rendered as text. The local API checks Host and Origin and the production app uses a restrictive content security policy.

## Architecture

```text
src/                       React browser and accessible detail view
shared/model.ts            Zod-validated normalized model and API contracts
shared/filter.ts           Deterministic candidate/search/filter boundaries
server/app.ts              Express API, import jobs, localhost request checks
server/importers.ts        AniList GraphQL and official MAL public-list adapter
server/normalize.ts        Provider validation, rating conversion, normalization
server/upstream.ts         Shared rate pacing, timeouts, retries, actionable errors
server/storage.ts          SQLite snapshot persistence and metadata cache
server/metadata.ts         Lazy Jikan metadata enrichment and request deduplication
server/recommendations/    Google adapter, bounded inputs, validation, cache orchestration
shared/recommendations.ts  Runtime schemas for preferences, taste profiles and results
src/PickForMe.tsx          Consent, preferences, taste profile and source-grounded results
tests/                     Deterministic tests; fixtures never enter app data
scripts/live-check.ts      Opt-in live imports using a disposable database
docs/ANIPICK_AI_SYSTEM_PROMPT.md  Future taste-analysis behavior contract
```

The frontend never contacts upstream list or inference APIs and receives neither the MAL client ID nor the Gemini key. A single normalized model supplies stable candidate IDs and taste history. React state is sufficient here; no additional shared-state dependency is needed. SQLite uses Node's built-in driver. Google inference uses native `fetch`, with no additional AI SDK dependency.

### Configure and test real AI

1. Obtain your own key from [Google AI Studio](https://aistudio.google.com/apikey). Do not paste it into chat or the browser UI.
2. Add these server-only settings to your existing `.env` file; do not overwrite your MAL configuration:

   ```dotenv
   GEMINI_API_KEY=your_real_key
   AI_PROVIDER=google
   AI_MODEL=gemma-4-26b-a4b-it
   ```

3. Restart `pnpm dev` (or `pnpm start` after building). The browser never receives the key. Do not use `VITE_` for credentials.
4. Import a real public list. Open **Pick for Me**, select a total anime length and mood, optionally choose genre/airing preferences, and explicitly agree to sending selected data to Google. Choose **Pick for Me**. Changing controls does not call the model.
5. Inspect the taste profile, source-history citations and scores, recommendations, uncertainty, and disclosed sample coverage. Click a title for its imported details. Repeating identical preferences uses the durable local cache; changing only mood can reuse the taste profile.

Optional CLI checks:

```powershell
pnpm test:ai
# Above checks authenticated model access only; no watchlist data is sent.
pnpm test:ai --probe
# Adds a real minimal JSON generation check, still without watchlist data.
pnpm test:ai --recommend --library=anilist:yourusername
# Explicitly authorizes real analysis of this saved library. Omit --library to use the latest.
```

An empty `.env` key produces a visible configuration error, never a fake result. Test fixtures are confined to `tests/`. Connection checks verify the model's `generateContent` capability before any watchlist data is sent.

### Model choice, capabilities, terms, and limits

Verified against Google's documentation on October 18, 2026: the [Gemma-specific Gemini API guide](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) lists **`gemma-4-26b-a4b-it`** and **`gemma-4-31b-it`**, with `generateContent`, system instructions, and `thinkingLevel` control. AniPick defaults to 26B A4B and uses minimal thinking. The [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) identifies these as open-weight models under Apache 2.0. A key-specific model-access check still runs at inference time; documented availability does not establish access for your account or region.

Gemma-specific docs do not establish native JSON Schema decoding support for this endpoint. AniPick therefore supplies the exact JSON schema in the prompt, parses a single JSON document, and validates it with Zod and semantic checks. It deliberately does not assume that Gemini-branded structured-output capabilities automatically apply to Gemma. Thought parts and incomplete responses are never accepted as answers.

Google currently lists Gemma 4 input/output under its [free tier](https://ai.google.dev/gemini-api/docs/pricing#gemma-4); actual access and capacity depend on the account. [Active rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) are project-specific and must be checked in AI Studio. No fixed RPM/TPM quota is promised. Review Google's current [API terms](https://ai.google.dev/gemini-api/terms), regional conditions, and data handling before sending a watchlist. Free service availability and data-use terms can change.

`RecommendationProvider` keeps inference separate from import, filtering, validation, and storage. A future Qwen3.8-27B adapter can implement that interface using an eligible provider's verified API/model ID. The [official Qwen model repository](https://huggingface.co/Qwen/Qwen3.8-27B) is a weight identifier, **not a verified hosted API ID**. Qwen inference is not implemented in this milestone; setting `AI_PROVIDER=qwen` returns a configuration message. No closed model or GPT-OSS fallback is selected.

Open weights matter because inference is replaceable: a future adapter can change hosts or use an actually running local model without replacing the user's library or application rules. A hosted model avoids local hardware requirements but transmits selected watchlist data and depends on provider limits and pricing. This implementation is cloud inference, not offline inference.

### What the AI actually does

1. The server reads the saved library and any fresh, already-cached Jikan enrichment. It does not fetch thousands of metadata records or send the complete list to the model.
2. Hard filters are applied to **Plan to Watch only**, before inference: `≤12`, `≤24`, movie, `≥25`, genre, release status and verified-dub restriction. Numeric length restrictions exclude unknown episode counts; movie format can match even if its episode count is unknown. Completed titles never enter the candidate pool.
3. Taste analysis uses at most **16 history entries / 6,000 JSON bytes**, balancing higher, middle and lower personal ratings with unrated statuses. Descriptions are limited to 300 characters, genres/tags to 12 each, and titles to 160 characters. Original personal scores, scales, and their normalized value are preserved; unrated is null. Community scores, usernames, notes, timestamps, URLs, and posters are omitted.
4. A real Gemma call infers recurring positive patterns, tentative dislikes, and uncertainty from history, genres, themes, and descriptions. Every inferred pattern must cite supplied history IDs. An unrated entry is never sent as a zero rating.
5. A second real call ranks a bounded candidate sample using the validated taste profile, mood, and compact cited-history data. Asking for **one result** caps candidates at **12 titles / 6,000 JSON bytes**; asking for **five results** caps them at **24 titles / 10,000 JSON bytes**. Byte budgets can reduce the actual title count further. Candidate sampling uses stable ID hashing, not a hidden recommendation algorithm or popularity score. Large-list coverage is disclosed explicitly. Narrowing filters changes the eligible sample.
6. The model returns only candidate selections, explanations, history references, caveats, and qualitative confidence. The backend computes exact shared genre/tag intersections from each selected anime and its cited history, then validates the complete UI response. Model-generated metadata fields are rejected. Shape, candidate/history membership, uniqueness, maximum result count, and common numeric rating, length, percentage and availability assertions in prose are checked; factual titles, scores, episodes and dub claims are rendered from source data. Invalid replies trigger at most one repair request per stage with a specific, sanitized correction, then an error identifying taste analysis or recommendation ranking and the validation category. No rejected prose, values, or unknown fields are echoed. Free-form thematic interpretation can still be mistaken; these checks do not prove all natural-language claims or guarantee the absence of spoilers.
7. Sparse histories force lower confidence. Confidence is qualitative and never displayed as a measured match percentage. An empty hard-filtered pool makes no inference request.

### AI persistence and failures

SQLite caches validated taste profiles for **seven days** and recommendation results for **24 hours**, with up to 100 records of each kind. Cache keys include the account, model/provider, prompt instructions, sent history, candidate metadata, preferences, and coverage as appropriate. Meaningful changes invalidate the relevant cache; trivial UI changes do not call inference. Reopening the app retains the caches. Expiry is enforced on reads; expired rows are removed during later cache writes.

Identical simultaneous requests share one analysis. Other simultaneous analyses return a busy message. Each operation has a two-minute total deadline; generation calls have a 40-second deadline. Google 5xx responses get one bounded retry; invalid model output gets at most one repair. HTTP 429 uses the longer of the `Retry-After` header and structured Google `RetryInfo.retryDelay`, starts a local cooldown, and reports a sanitized quota category/limit where supplied. Input-token limits, request limits, daily exhaustion and zero available quota have different recovery messages; a short retry delay is not presented as the reset of a daily quota. The quota reason is preserved during the local cooldown. A successful profile survives a failed ranking call. Errors never substitute a hardcoded shortlist, delete the saved library, or expose raw provider responses.

If even one recommendation is rate limited, remember that the result count is not the number of input tokens: the model still compares candidates and analyzes history in separate calls. AniPick does not send a full 500-title library, but large samples and two close-together requests can consume a per-minute token quota. Use the specific error and [AI Studio usage](https://aistudio.google.com/rate-limit) to distinguish this from a daily quota or project access restriction. Quotas are shared by the Google project; creating another key in the same project does not create a new quota. A successful connection check verifies model access, not inference quota headroom.

Cache contents include generated taste descriptions and sample history references and are stored locally alongside the watchlist. Cloud consent is required by the backend request schema, not just the UI. API keys are sent only in HTTPS headers to the fixed Google endpoint; redirects are refused. No key is stored in SQLite, the browser, logs, URLs, or source control.

## Anime previews and community videos

Open an anime from the Library, its featured artwork, a recommendation, or a history citation. **Before you press play** appears inside the existing detail dialog; closing it returns to the current recommendation workflow.

- AniList imports now retain valid YouTube trailer IDs. Existing libraries can retrieve trailers on demand without reimporting. AniList lookup uses the exact anime ID; MAL entries use Jikan's `trailer.youtube_id`. When an AniList trailer is missing or its lookup fails, Jikan is checked when a MAL ID exists. Source failures are distinguished from a confirmed missing trailer.
- Trailer metadata, including confirmed absence, is cached locally for seven days. Source warnings are shown and partial-failure results are not cached as definitive absence. Metadata cached before trailer support is refreshed lazily. Titles and user scores are never sent to an AI for media discovery.
- **Load trailer** mounts YouTube's official privacy-enhanced iframe. **Search YouTube for a trailer** stays available during loading, errors, and missing-trailer states. IDs come from the source API; AniPick does not verify that the uploader is an official rights holder, and the UI labels the listing's source accordingly.
- **Find on TikTok** opens a title-based search for reviews, recommendations, and edits. Paste a full HTTPS `tiktok.com/@creator/video/VIDEO_ID` link under **Save a TikTok video**. Supported hosts are `www.tiktok.com`, `tiktok.com`, and `m.tiktok.com`; links are canonicalized and tracking parameters removed. Open shortened share URLs first and copy the full video URL. Photo posts and unrelated hosts are rejected.
- Saved TikTok links belong to the anime's stable internal ID and persist across app restarts and list refreshes. Duplicate video IDs are idempotent. **Remove link** deletes only that saved local reference, not the video on TikTok. Association with the anime is user-supplied and unverified.
- **Load TikTok preview** uses TikTok's official embed player. No third-party player is mounted before a viewer requests it, autoplay is off, and **Hide player** unmounts playback. Players may contact their provider and use provider storage once loaded. Community content carries a spoiler warning; even promotional trailers can reveal story details.
- Player load failures, TikTok's supported error messages, and slow loads offer recovery. Original-video links remain available. YouTube's opaque iframe reports some playback restrictions inside its own player, so AniPick cannot programmatically diagnose every removed, region-restricted, age-gated, or embedding-disabled video. Login, tracking protection, regional restrictions, and provider availability can still prevent playback.

No YouTube/TikTok API keys, scraping service, OAuth, download, rehosting, external embed script, or runtime dependency is required. SQLite adds `trailers` and `tiktok_videos` tables automatically; existing library snapshots and AI caches remain intact. Production CSP permits frames only from `www.youtube-nocookie.com` and `www.tiktok.com`; scripts remain self-hosted. The video frames alone use an origin-only referrer policy so YouTube receives the required embedder identity; the app's general no-referrer policy remains in place.

### Media smoke check

```powershell
pnpm test:media
```

This reads real public AniList metadata in an in-memory verification store, checks a live source trailer and cache reuse, and checks a real AniList-null trailer with the YouTube search fallback. It also attempts Jikan. It never modifies your saved library or calls AI. Successful metadata checks do not establish browser playback.

For a manual demo, open an imported anime, inspect its source attribution, select **Load trailer**, then press play in YouTube. Test a missing trailer's search link. Find an actual relevant TikTok video, save its full URL, reopen the detail dialog to confirm persistence, load its preview, and remove the saved link. Check both desktop and phone layouts and return to Pick for Me to confirm its existing state is preserved.

Official integration references: [AniList Media](https://docs.anilist.co/reference/object/media), [Jikan v4](https://docs.api.jikan.moe/), [YouTube embeds](https://developers.google.com/youtube/player_parameters), [YouTube embedder identity](https://developers.google.com/youtube/terms/required-minimum-functionality#embedded-player-api-client-identity), and [TikTok's embed player](https://developers.tiktok.com/docs/en/embed-player).

## Checks

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The automated suite uses test fixtures and injected HTTP transports to cover pagination, custom-list duplicates, statuses, score scales, filtering, retries, import jobs, SQLite reopening, AI eligibility and payload budgets, forged IDs and traits, JSON validation, sparse history, consent enforcement, caching/invalidation, duplicate-request coalescing, sanitized errors, rate limits, and the full recommendation HTTP boundary through the real Google adapter. These tests do not establish current upstream availability or model quality.

Optional live smoke test (public account, disposable database):

```powershell
pnpm test:live
# Or choose public usernames; the second is used only when MAL_CLIENT_ID is set:
pnpm test:live derF Xinil
```

It imports every AniList chunk, validates the result and SQLite persistence, checks Jikan enrichment/cache, and imports MAL if configured. Public example accounts can change visibility or username. No example account is added to the app's real database. A skipped MAL check is reported explicitly.

### Final audit — October 18, 2026

The final audit used a real public account in disposable SQLite storage, never the user's saved library. Real cloud inference used the configured **Google AI Studio / `gemma-4-26b-a4b-it`**. Live results establish that these particular requests succeeded; they do not guarantee future availability or subjective recommendation quality.

| Check | Observed result |
| --- | --- |
| Automated suite | **110 tests across 15 files passed.** Includes pagination, score scales, boundary filters, private/missing lists, failed-refresh preservation, incomplete details, AI errors/validation/caching, media links, and persistence. |
| TypeScript, ESLint, production build | Passed. |
| Real AniList import through HTTP | Public `derF`: **1,216 anime, three pages; 1,052 Completed, 128 Plan to Watch, 1,088 rated.** Every native/normalized personal score and source status matched the live source response. |
| Real AI taste analysis | A fresh, validated profile from eight rated history entries sampled from 1,088 history entries. Generated by Gemma, not a fixture or cache. |
| Real Pick for Me, all five lengths | One validated recommendation per filter; every returned ID belonged to the eligible Plan to Watch pool. See counts below. The other four requests reused the taste profile. |
| Server/database restart | Complete library and all personal scores unchanged. Repeated recommendation returned a valid durable cache hit without new inference. |
| Real trailer metadata | AniList supplied Cowboy Bebop's `OhNwckCLzis`; cache reuse passed. Cowboy Bebop: Tengoku no Tobira supplied a real AniList-null case; the AniList-only branch and search fallback passed. Playback was not established. |
| Jikan | Live requests failed with `NETWORK_ERROR`. `test:live` exited **1** for this failure. `test:media` completed AniList checks and explicitly reported Jikan as not verified. |
| MyAnimeList | Live import **skipped** because `MAL_CLIENT_ID` is not configured. Deterministic pagination, native scores, configuration errors, and destination-validation tests passed. |
| Production launch | `pnpm start` served page, health, and bundled font with HTTP 200 on isolated loopback port 3005. Media CSP allowlist checked. No Google key pattern found in client JavaScript. Owned process/database removed afterward. |
| Browser, screenshots, playback | **Not verified:** local browser use remains disabled in Work settings. No rendered desktop/mobile, focus/keyboard, generated-result UI, or actual video playback review is claimed. |

| Length | Eligible Plan to Watch | Sent to model | Validated results |
| --- | ---: | ---: | ---: |
| No limit | 128 | 9 | 1 |
| Up to 12 episodes | 83 | 10 | 1 |
| Up to 24 episodes | 107 | 9 | 1 |
| Movie | 16 | 9 | 1 |
| 25+ episodes | 20 | 9 | 1 |

Private lists, missing users, provider outages, malformed/truncated AI output, forged IDs, access errors, timeouts, and rate limits were exercised with deterministic injected responses. No successful live private-list access is claimed. The first sandboxed test attempt could not connect to localhost test servers (`EACCES`); rerunning with localhost permission passed. Optional React Doctor and CodeRabbit CLIs are unavailable.

### Repeat the HTTP journey audit

Build first. This check creates and removes a separate temporary database, imports public `derF`, compares source scores/statuses, checks every length pool, and restarts the app/database to verify persistence:

```powershell
pnpm test:audit
# Opt in to sending this PUBLIC audit sample to Google for real inference:
pnpm test:audit --infer
```

`--infer` generates one result per length, checks eligibility and profile reuse, then checks the recommendation cache after restart. It pauses 65 seconds between filters to reduce quota bursts and stops further inference after a failure. Allow several minutes and real provider usage. Diagnostics contain counts/codes, not API keys or generated prose. This script never opens the user's saved watchlist.

## Current limitations and submission work

- **Screenshots and browser review:** capture real Library, recommendation, preview, and phone-width screens. Check keyboard/focus and real YouTube/TikTok playback, including a removed/restricted video and save/reopen/remove of a relevant community link. HTTP and static-markup tests do not replace these checks.
- **Upstream verification:** add a MAL client ID and verify an actual public MAL list; retry live Jikan when reachable. Imported AniList details and saved browsing remain usable without enrichment.
- **AI scope:** bounded samples do not cover every backlog title. Sparse ratings reduce personalization, natural-language interpretations can be mistaken, and quota/access limits can still block generation. One suggestion still requires input tokens.
- **Provider support:** Google-hosted Gemma is the only implemented inference provider. Qwen3.8-27B and local inference are future adapters, not supported configurations today. Hosted inference sends selected data to Google; it is not offline AI.
- **Unknown data:** no automated verified-dub or streaming-availability source exists. Do not interpret unknown metadata as confirmed absence. No account writes, payments, authentication, or public hosting setup is included.
- **Repository/submission:** this checkout has no `.git` directory or root application `LICENSE`. A public repository, owner-chosen project license, project-window provenance, and the submission post still need owner attention. This audit did not initialize Git, commit, publish, or submit anything.

## Demo

1. Start the app and import your real public AniList username (or configure MAL and use that equally visible option).
2. Watch the page/count progress; on completion the Plan to Watch browser opens.
3. Search an alternate title, change genre, choose **Up to 12 episodes**, and inspect a card. User and community scores are labeled separately.
4. Switch to Completed to inspect personal ratings. Return to Plan to Watch.
5. Reload or restart the app: the saved library remains. Disconnect from the network: saved list browsing still works, while uncached covers/enrichment may be unavailable.
6. Use **Refresh list** after one minute. An upstream failure displays a retryable error and keeps the previous complete list.
7. With `GEMINI_API_KEY` configured, select a mood and length in **Pick for Me**, review the cloud disclosure, consent, and generate real suggestions. Inspect history citations and qualitative confidence. Repeat the same preferences to verify a cache hit, then change mood to reuse the taste profile.

## API references

- [AniList GraphQL documentation](https://docs.anilist.co/) and [MediaList scoring fields](https://docs.anilist.co/reference/object/medialist).
- [MAL official API v2 reference](https://myanimelist.net/apiconfig/references/api/v2).
- [Jikan v4 reference](https://docs.api.jikan.moe/) and [user-list removal notice](https://jikan.docs.apiary.io/).

## Credits

Built with React, TypeScript, Vite, Tailwind CSS, Express, Node's built-in SQLite, and Zod. Checks use Vitest, TypeScript, and ESLint; dependency versions are pinned by `pnpm-lock.yaml`.

Google DeepMind supplies the open-weight Gemma model; Google AI Studio hosts inference. AniList and MyAnimeList supply watchlist and anime information, with optional Jikan enrichment. YouTube and TikTok provide their official embedded players; their respective service terms, availability, and restrictions apply. Source-listed trailers do not independently establish rights-holder authenticity.

Manrope is by the Manrope Project Authors and ships with its [SIL Open Font License](public/fonts/OFL-Manrope.txt). Posters, synopses, and videos belong to their respective creators and rights holders; AniPick claims no ownership and is not affiliated with or endorsed by the services above. No copyrighted video is downloaded or rehosted.
