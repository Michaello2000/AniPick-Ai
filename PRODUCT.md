# AniPick

## Platform

Localhost-first web application. React, TypeScript, Vite, Tailwind CSS, and a local Node.js backend with SQLite persistence.

## Purpose and users

Anime viewers with an AniList or MyAnimeList backlog who want to decide what to watch next from their own Plan to Watch list. Import a real public username, browse the saved collection, then request personalized suggestions using length and mood.

## Confirmed constraints

- Preserve both username import paths, source statuses and ratings, search, filters, durable local data, and API recovery.
- AI requests use a configurable open-weight model through a server-only adapter. Never expose keys or manufacture recommendations. Selected history and candidates reach the cloud only after explicit consent.
- Optional local OpenAI-compatible inference sends the same bounded data only to a validated loopback endpoint. It requires no Google consent and never falls back to cloud. Bonsai 2 is prioritized, while real server-reported model IDs remain selectable. Weights and inference runtimes live outside this repository.
- The library remains useful without AI. Inference may be unavailable or fail validation; a configured key is not evidence of a successful recommendation.
- Verified metadata stays separate from generated interpretations. Unknown dub availability remains unknown.
- The visual system remains the established personal-library design. Media integration extends the detail dialog without replacing navigation or the recommendation workflow.
- Trailers come from AniList/Jikan source IDs. TikTok discovery uses search and user-saved video links with official, click-to-load players. No scraping, video downloads, or rehosting.

## Brand commitments

Premium personal library; prominent real anime artwork; distinctive restrained dark UI; one blue primary accent. Letterboxd, Linear, and modern streaming interfaces are the user's references. Pick for Me is the primary interaction, with a clear separate library destination. No generic SaaS dashboard, giant statistic cards, purple gradients, unnecessary motion, or fake content.
