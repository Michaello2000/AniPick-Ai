# AniPick design system

## Direction

AniPick is a personal anime collection, viewed like a private cinema programme. Real poster art supplies the visual variety; the interface supplies calm, precise structure. The references are Letterboxd's cover-first browsing, Linear's careful typography and controls, and streaming services' clear distinction between browsing and choosing. This is a working library, not a marketing page or an analytics dashboard.

Use neutral charcoal, warm white, and one clear blue accent. Avoid purple gradients, decorative glass, nested cards, large statistic tiles, and scroll choreography. GPT Taste informs composition and typographic confidence; Impeccable's task-first principles and the user's restraint take priority over that skill's marketing layouts and mandatory GSAP effects.

## Existing UX audit

- A permanent import sidebar uses valuable poster space and precedes the library on phones.
- Importing, model configuration, consent, recommendation controls, and browsing compete in one long page.
- Repeated explanatory paragraphs and technical settings obscure the main action.
- Small type, many similar bordered controls, and olive-tinted surfaces flatten the hierarchy.
- Recommendation results lead with configuration and lengthy analysis instead of the selected anime.
- The navigation visually promises separate destinations but only jumps down the same page.

## Information architecture

- **Library:** restrained navigation, an artwork-led introduction using only real saved Plan to Watch titles, then status navigation, search, and a full-width poster grid.
- **Pick for Me:** its own destination. Length and mood lead; the explicit cloud consent and primary action stay visible. Genre, airing, suggestion count, and verified-dub controls remain in Advanced preferences. Connection settings and technical disclosures belong in a separate details element.
- **AI settings:** retain that disclosure for Cloud/Local selection, with a native server-discovered model select and refresh/recovery controls. Local mode replaces Google consent with concise loopback processing information. No model cards, install wizard, or new palette; reuse existing segmented controls, selects, focus rings, and spacing. Unavailable local inference disables generation without switching providers.
- **Import:** a visible header action opens an inline library manager. The manager starts open before the first import. Both username providers have equal prominence; saved-library switching, refresh, progress, and recovery remain functional.
- Keep Pick for Me mounted when navigating so an in-flight request, consent selection, or generated result is not discarded.
- Anime details remain a native modal dialog with protected focus, Escape support, and a clearly labeled close button.

## Tokens

The implementation in `src/styles.css` is the source of truth.

| Role | Value |
| --- | --- |
| Canvas | `#101113` |
| Surface | `#181a1d` |
| Raised surface / input | `#202226` |
| Text | `#f3f0ea` |
| Secondary text | `#b3b4ba` |
| Quiet text | `#9799a1` |
| Divider | `#303238` |
| Primary action | `#70b5ff`, dark text `#0b1a2c` |
| Focus | `#add4ff` |
| Error | `#f0b2a1` on `#2c201e` |
| Success | `#b7d7b4` on `#1d281f` |

- **Typeface:** locally hosted Manrope variable, weights 400–800; system sans fallback. Font license ships in `public/fonts`.
- **Type:** display 38–64px, page heading 30–44px, section heading 22–28px, poster title 14px, body/control 14px, metadata 12px. Display tracking no tighter than -0.04em; body line-height 1.6–1.8. Long prose measures at most 72ch.
- **Spacing:** 4px base; 8/12px inside controls, 16/24px inside groups, 40/64px between major regions. Main content max-width 1440px, desktop side padding 48px, mobile 20px.
- **Shape:** posters 8px radius; large surfaces 12px; controls 6–8px. Pills are reserved for short metadata. Dividers separate regions instead of wrapping every region in a card.
- **Icons:** existing authored 24px SVG system, consistent rounded 1.7px strokes. No emoji or Unicode substitutes for UI icons.

## Components and states

- Poster cards keep their original 2:3 ratio, reserve dimensions during loading, and expose title/format/length. Community scores remain labeled separately from personal scores. Missing art uses a quiet, intentional fallback; no stock or fabricated anime imagery.
- A dark poster scrim can support legible score/action overlays; backgrounds and text never use decorative gradients.
- Search and native selects have visible labels or accessible names. Status controls expose pressed state, and result counts use a polite live region.
- Length boundaries stay explicit: <=12, <=24, movie, >=25; unknown lengths remain unknown. No change to source data or filtering semantics.
- Loading keeps the layout stable. Import and inference display honest activity text, errors show existing recovery actions, and empty searches offer Clear filters.
- Recommendations appear before the longer taste analysis. Show real covers, grounded reasons, history citations, caveats, and qualitative confidence. Keep analysis and detailed provenance available in disclosures, never remove them or fabricate successful AI output.
- A configured API key does not imply working generation. Preserve quota, timeout, validation, and setup errors without claiming success.
- Media previews live inside the existing detail dialog, after the poster and facts. Keep source attribution, YouTube search, and TikTok discovery easy to find. Mount official players only after a deliberate Load action, with autoplay disabled. Community content carries a visible spoiler warning and is never presented as verified official footage.
- Save community links through an inline disclosure. Keep errors, saved-state feedback, removal, and original-provider links next to the relevant video. Use the existing palette, dividers, typography, and 44px controls; no new visual system, external embed script, or decorative animation.

## Responsive and accessible behavior

- Desktop: five or six poster columns when room permits; a wider introduction with a compact row of real saved covers.
- Tablet: three or four poster columns; flexible controls and two-column forms.
- Phone: two poster columns, compact navigation, full-width primary actions, vertically stacked forms. Only intentional shelves/status navigation scroll horizontally; the page must not overflow.
- Keep action targets at least 44px, clear focus-visible rings, a skip link, native details keyboard behavior, meaningful heading order, and sufficient text contrast. No information depends on hover alone.
- Hover effects run only with a fine pointer and hover support. Use 150–200ms transitions for colors and a small poster scale; button press feedback is immediate. No entrance delays, continuous decorative animation, or scroll hijacking. Respect prefers-reduced-motion.

## Verification

Run existing tests, TypeScript, ESLint, and the production build. Review the real app at desktop and phone widths when browser access is available: saved and empty libraries, import controls, search, filters, detail focus, Pick for Me consent, advanced settings, loading, and error states. Do not trigger imports, refreshes, or paid/cloud inference merely for a visual screenshot. Browser access unavailable at the start of this pass; record the final verification honestly in the delivery.

The subsequent local-AI settings pass was reviewed in Brave at 1440×1000 and 390×844. Cloud/Local keyboard selection, consent reset, unavailable-server recovery, disabled generation, and page overflow were checked; screenshots live in `docs/screenshots/`. No inference or watchlist refresh was triggered during that UI review. Successful local model output and broader playback review remain unverified.
