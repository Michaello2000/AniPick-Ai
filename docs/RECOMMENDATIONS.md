# AI recommendations

[README](../README.md) · [Setup](SETUP.md) · [Local AI](LOCAL_AI.md) · [Recommendations](RECOMMENDATIONS.md) · [Media](MEDIA.md) · [Testing](TESTING.md)

Pick for Me uses an open-weight model to infer taste from watch history, then rank eligible Plan to Watch candidates. Cloud mode requires a Google AI Studio key and explicit consent. Local mode requires a separately running compatible server; see [Local AI](LOCAL_AI.md). Browsing remains available when either provider fails.

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
server/recommendations/    Cloud/local adapters, bounded inputs, validation, cache orchestration
shared/recommendations.ts  Runtime schemas for preferences, taste profiles and results
src/PickForMe.tsx          Consent, preferences, taste profile and source-grounded results
tests/                     Deterministic tests; fixtures never enter app data
scripts/live-check.ts      Opt-in live imports using a disposable database
docs/ANIPICK_AI_SYSTEM_PROMPT.md  Future taste-analysis behavior contract
```

Upstream list and inference API calls run on the backend. API responses expose neither the stored MAL client ID nor inference API keys. A user may enter a MAL client ID in the setup UI; the backend validates and stores it locally. A single normalized model supplies stable candidate IDs and taste history. React state is sufficient here; no additional shared-state dependency is needed. SQLite uses Node's built-in driver. Google inference uses native `fetch`, with no additional AI SDK dependency. The local adapter uses the same provider interface and native HTTP requests.

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

The previous README recorded this documentation review on October 18, 2026 (not reverified during the documentation refactor): the [Gemma-specific Gemini API guide](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) lists **`gemma-4-26b-a4b-it`** and **`gemma-4-31b-it`**, with `generateContent`, system instructions, and `thinkingLevel` control. AniPick defaults to 26B A4B and uses minimal thinking. The [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4) identifies these as open-weight models under Apache 2.0. A key-specific model-access check still runs at inference time; documented availability does not establish access for your account or region.

Gemma-specific docs do not establish native JSON Schema decoding support for this endpoint. AniPick therefore supplies the exact JSON schema in the prompt, parses a single JSON document, and validates it with Zod and semantic checks. It deliberately does not assume that Gemini-branded structured-output capabilities automatically apply to Gemma. Thought parts and incomplete responses are never accepted as answers.

At that review, Google listed Gemma 4 input/output under its [free tier](https://ai.google.dev/gemini-api/docs/pricing#gemma-4); actual access and capacity depend on the account. [Active rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) are project-specific and must be checked in AI Studio. No fixed RPM/TPM quota is promised. Review Google's current [API terms](https://ai.google.dev/gemini-api/terms), regional conditions, and data handling before sending a watchlist. Free service availability and data-use terms can change.

`RecommendationProvider` keeps inference separate from import, filtering, validation, and storage. The loopback adapter can use other models under their real served IDs, provided the engine supports them. There is no dedicated Qwen hosted adapter; `AI_PROVIDER=qwen` is not supported. A weight repository name is not automatically a hosted API ID. No closed model or GPT-OSS fallback is selected.

Open weights matter because inference is replaceable: the optional loopback adapter uses a separately running local model without replacing the user's library or application rules. Hosted Gemma avoids local hardware requirements but transmits selected data and depends on provider limits/pricing. Local inference instead depends on your hardware and runtime; import and media features still use external services.

### What the AI actually does

1. The server reads the saved library and any fresh, already-cached Jikan enrichment. It does not fetch thousands of metadata records or send the complete list to the model.
2. Hard filters are applied to **Plan to Watch only**, before inference: `≤12`, `≤24`, movie, `≥25`, genre, release status and verified-dub restriction. Numeric length restrictions exclude unknown episode counts; movie format can match even if its episode count is unknown. Completed titles never enter the candidate pool.
3. Taste analysis uses at most **16 history entries / 6,000 JSON bytes**, balancing higher, middle and lower personal ratings with unrated statuses. Descriptions are limited to 300 characters, genres/tags to 12 each, and titles to 160 characters. Original personal scores, scales, and their normalized value are preserved; unrated is null. Community scores, usernames, notes, timestamps, URLs, and posters are omitted.
4. The configured model (Gemma in cloud mode) infers recurring positive patterns, tentative dislikes, and uncertainty from history, genres, themes, and descriptions. Every inferred pattern must cite supplied history IDs. An unrated entry is never sent as a zero rating.
5. A second real call ranks a bounded candidate sample using the validated taste profile, mood, and compact cited-history data. Asking for **one result** caps candidates at **12 titles / 6,000 JSON bytes**; asking for **five results** caps them at **24 titles / 10,000 JSON bytes**. Byte budgets can reduce the actual title count further. Candidate sampling uses stable ID hashing, not a hidden recommendation algorithm or popularity score. Large-list coverage is disclosed explicitly. Narrowing filters changes the eligible sample.
6. The model returns only candidate selections, explanations, history references, caveats, and qualitative confidence. The backend computes exact shared genre/tag intersections from each selected anime and its cited history, then validates the complete UI response. Model-generated metadata fields are rejected. Shape, candidate/history membership, uniqueness, maximum result count, and common numeric rating, length, percentage and availability assertions in prose are checked; factual titles, scores, episodes and dub claims are rendered from source data. Invalid replies trigger at most one repair request per stage with a specific, sanitized correction, then an error identifying taste analysis or recommendation ranking and the validation category. No rejected prose, values, or unknown fields are echoed. Free-form thematic interpretation can still be mistaken; these checks do not prove all natural-language claims or guarantee the absence of spoilers.
7. Sparse histories force lower confidence. Confidence is qualitative and never displayed as a measured match percentage. An empty hard-filtered pool makes no inference request.

### AI persistence and failures

SQLite caches validated taste profiles for **seven days** and recommendation results for **24 hours**, with up to 100 records of each kind. Cache keys include the account, model/provider, prompt instructions, sent history, candidate metadata, preferences, and coverage as appropriate. Meaningful changes invalidate the relevant cache; trivial UI changes do not call inference. Reopening the app retains the caches. Expiry is enforced on reads; expired rows are removed during later cache writes.

Identical simultaneous requests share one analysis. Other simultaneous analyses return a busy message. For Google, each operation has a two-minute total deadline; generation calls have a 40-second deadline. Google 5xx responses get one bounded retry; invalid model output gets at most one repair. HTTP 429 uses the longer of the `Retry-After` header and structured Google `RetryInfo.retryDelay`, starts a local cooldown, and reports a sanitized quota category/limit where supplied. Input-token limits, request limits, daily exhaustion and zero available quota have different recovery messages; a short retry delay is not presented as the reset of a daily quota. The quota reason is preserved during the local cooldown. A successful profile survives a failed ranking call. Errors never substitute a hardcoded shortlist, delete the saved library, or expose raw provider responses.

If even one recommendation is rate limited, remember that the result count is not the number of input tokens: the model still compares candidates and analyzes history in separate calls. AniPick does not send a full 500-title library, but large samples and two close-together requests can consume a per-minute token quota. Use the specific error and [AI Studio usage](https://aistudio.google.com/rate-limit) to distinguish this from a daily quota or project access restriction. Quotas are shared by the Google project; creating another key in the same project does not create a new quota. A successful connection check verifies model access, not inference quota headroom.

Cache contents include generated taste descriptions and sample history references and are stored locally alongside the watchlist. The backend enforces consent for cloud requests, including cache reads; local requests do not require Google consent. Google's key goes only in HTTPS headers to its fixed endpoint, and an optional local key goes only to the validated loopback server. Redirects are refused. No inference API key is stored in SQLite, the browser, logs, URLs, or source control. The optional UI-saved MAL client ID is stored in SQLite; see [Setup](SETUP.md).
