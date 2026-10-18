# AniPick — Coding Agent Instructions

## Project and goal
Build **a brand-new repository**, created during the Hacktoberfest 2026 Week 2 challenge window. Do not copy code from the previous AniPick repository. AniPick is a **localhost-first anime watchlist companion** that helps someone decide what to watch next from their own **Plan to Watch** list. The open-weight AI must perform substantive taste analysis and candidate recommendation, not merely decorate an otherwise non-AI product.

The main success path is: **enter an AniList or MyAnimeList username → import the real public watchlist → browse the backlog → pick a length/mood → get personalized, explainable suggestions**.

## Workflow for the coding agent
- Work incrementally. Before a milestone, inspect the codebase, state a concise plan, and identify dependencies. Do not attempt the entire product in one edit.
- Make changes only in this new repository. Prefer small, coherent commits and report files changed, checks run, and limitations.
- Never describe a feature as working unless it is genuinely implemented. Do not silently replace live API calls with demo data.
- Prioritize a reliably working import-to-recommendation flow over extra features.
- Document setup, required API keys, model/provider configuration, and demo instructions in `README.md`.

## Preferred stack
- Frontend: React, TypeScript, Vite, Tailwind CSS; Zustand if shared state warrants it.
- Backend: local Node.js + TypeScript API server (Express or Hono). Keep upstream API calls and AI keys on the server.
- Storage: local SQLite or another clearly documented durable local cache; persist the imported watchlist and metadata so refreshes do not erase them.
- AI: a provider-neutral inference adapter with an **open-weight** model. Preferred starting candidate: **Gemma 4 26B A4B** via Google AI Studio, if currently accessible for the account. Optional alternative: **Qwen3.8-27B** via an eligible provider. Verify current model IDs, access, terms, and free-tier limits instead of guessing. Never default to GPT-OSS for this project.
- Do not require a public domain, cloud hosting, accounts, or paid infrastructure.

## P0: real username imports
- Make **AniList username import** and **MyAnimeList username import** first-class, equally accessible options on the first screen. Neither should demand an OAuth login for public lists.
- AniList: use its GraphQL API. MAL: use Jikan or another permitted public-read path. Support pagination/full-list retrieval and honor rate limits.
- Import all relevant statuses (completed, watching, plan to watch, on hold, dropped) and personal ratings; preserve unscored entries as **unrated**, not a zero-quality rating.
- Normalize to a typed internal data model with stable IDs, provider name, source IDs, list status, personal score and its scale, title variants, poster, synopsis, tags/genres, format, episode count, release/airing status, community score, and source timestamps when available.
- Never conflate user scores with community scores. Preserve original source values and avoid matching different anime on titles alone.
- Handle nonexistent users, private lists, empty lists, pagination, transient failures, rate limits, and incomplete metadata with clear UI states. Provide progress and retry controls.
- Cache responsibly and provide a **Refresh list** action. Keep browsing possible if the AI provider is unavailable.
- XML/GZ import for MAL may be added after both username paths work; do not prioritize it ahead of them.

## P1: product and UX
- Style: clean, restrained, modern dark mode with excellent spacing, legibility, responsive layout, and prominent anime cover art. Avoid clutter, excessive animation, or a generic admin-dashboard look.
- Primary actions: **Import list**, **Browse backlog**, **Pick for Me**. Default recommendation pool is **Plan to Watch**; do not recommend completed shows unless the user explicitly opts into rewatching.
- Simple visible controls: length **No limit / Up to 12 episodes / Up to 24 episodes / Movie / 25+ episodes**, plus mood. Treat these as anime total-length filters, **not minutes available today**. Make category boundaries explicit: `<=12`, `<=24`, `movie`, `>=25` episodes; `No limit` is unrestricted.
- Put power-user controls in an **Advanced filters** disclosure: genres/tags, format, release status, score, year, sorting, and optionally English dub availability. Make unknown data visible as unknown rather than false.
- Provide a straightforward search and sorting experience. Handle missing scores/dates predictably. “Date added” only applies if the provider supplies a meaningful list-entry creation date.
- A detail view should show synopsis, genres/tags, format, episode count, community score, airing status, personal list metadata, and a preview section.
- Make an embedded YouTube trailer available where the API supplies a valid official trailer. Optionally link or embed authorized scene clips. For TikTok, offer search links and optional user-pasted embeds of known public videos; do not make automated scraping a dependency.
- Never download or rehost copyrighted anime scenes; respect third-party embed limitations. Lazy-load media, and avoid autoplay and spoilers.
- English dub availability must use a reliable, attributable source or be marked **Unknown**. Do not infer confirmed dubs from popularity, licensors, or streaming platform alone.

## P2: genuine open-weight AI recommendations
- The **AI's core job** is to infer a user taste profile from completed/dropped/rated anime and select/rank eligible candidates from the Plan to Watch list using supplied metadata. Consider positive and negative patterns without treating one low rating as a hard rule.
- The application applies hard filters (length, format, etc.) **before** sending candidates to the model. Never allow the model to override them.
- Use stable internal candidate IDs, not free-form title generation. Require a structured JSON response and validate it against a schema; discard invented IDs and retry or show a clear error on invalid responses.
- Give spoiler-free, evidence-based explanations and note uncertainty when ratings or metadata are sparse. Do not present uncalibrated match percentages as measurements.
- Cache taste profiles and results; avoid repeated expensive inference on trivial UI changes.
- Keep the AI provider configurable and support bring-your-own API keys. Keys must not appear in browser bundles, URLs, analytics, logs, or Git history. Use backend environment variables or local server-only key handling by default.
- Clearly inform users that cloud AI sends selected watchlist data to the configured provider. Never claim offline inference unless a local model is actually running.
- The non-AI watchlist browser must remain useful when no key is configured, rate limits are reached, or a model fails.

## Implementation quality
- Use TypeScript types, API response validation where practical, semantic accessible controls, keyboard navigation, and meaningful empty/loading/error states.
- Write automated tests for normalization, pagination logic, rating conversion, filtering boundary cases, and AI response validation.
- Run typecheck, lint, tests, and production build at each completed milestone. Fix failures; record any checks that could not run.
- Add concise documentation explaining **why open-weight AI matters**: provider/model choice, replaceability, inference costs/privacy tradeoffs, and the exact tasks performed by the model.
- Keep optional features from blocking the core demo. Prioritize real functionality over mockups.

## Delivery milestones
1. **Foundation:** new app, two real username importers, cache, browse/search/filter, tests.
2. **Recommendation MVP:** provider configuration, open-weight AI taste profile and eligible-candidate ranking, validated explanations, failure handling, tests.
3. **Preview and polish:** official YouTube trailer, TikTok search/manual links, advanced filters, responsive refinement, documentation and demo script.


## UI/UX Design Guidelines

AniPick is an anime discovery and recommendation experience,
not a generic analytics dashboard.

- Follow DESIGN.md for visual decisions.
- Prioritize anime artwork and clear content hierarchy.
- Keep primary workflows simple and discoverable.
- Advanced functionality must not overwhelm casual users.
- Use Impeccable for UI review and refinement.
- Prefer cohesive design over combining unrelated styles.
- Apply animation selectively, with reduced-motion support.
- Preserve functional behavior during visual redesign.
- Verify significant UI changes at desktop and mobile sizes.


Stop at each milestone with a short summary and let the developer choose the next task. Do not silently implement stretch features in place of a finished core.
