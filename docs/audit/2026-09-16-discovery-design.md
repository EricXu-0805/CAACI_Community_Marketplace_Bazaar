# Marketplace discovery: launch design and verification

This is a transparent first version for local trading, not a claim of a trained recommendation model. The existing latest-first feed remains the default. Explicit search remains relevance-ranked.

## Evidence and product choices

Meta's published [diversified recommendation design](https://engineering.fb.com/2020/12/17/ml-applications/diversified-recommendations/) describes explicit feedback, multiple relevance signals and diversity beyond a single engagement measure. Its [Marketplace engineering overview](https://engineering.fb.com/2018/10/02/ml-applications/under-the-hood-facebook-marketplace-powered-by-artificial-intelligence/) describes product retrieval, similarity and language support. These are architectural references, not a copy of proprietary production weights or a claim that their 2018/2020 systems represent today's platforms.

For Illini Market, the inferred priorities are finding an available item, understanding it across languages, arranging a useful local handoff and keeping the user in control. We do not optimize dwell time, infer sensitive interests, treat views as endorsement or call a manually selected area verified.

## Implemented rules (local candidate, not yet released)

- **Latest:** current chronological browsing remains default. Price and popularity sorts remain explicit choices.
- **For you:** the last 30 device-local viewed items contribute recency-decayed category weights; a saved item among those views has weight 3 instead of 1. Hidden items contribute nothing. Only the top three category names are sent to the database, not the item-level browsing history or timestamps. Favorites that have never been viewed are not a signal in this version.
- **Retrieval:** up to 200 newest eligible items plus up to 100 for each of at most three preferred categories. All selected category/condition/type/price/date/location filters, item RLS, hidden choices and symmetric block pairs apply before candidate limits. This bounds ranking to at most 500 unique rows; indexed retrieval and concurrent capacity still require measurement.
- **Ranking:** matching an interest category adds 2; freshness adds `3 / (1 + age_in_weeks)`, with future timestamps clamped to age zero. Sellers are interleaved by their first, second, third ranked item so one prolific seller cannot occupy the entire first screen. This intentionally trades some score precision for seller diversity.
- **Pagination:** return at most 200 ordered ids/reasons once per refresh. The client keeps that small id snapshot while paging, and fetches each page again under current RLS and active status. Detail navigation does not reorder the snapshot. An explicit “Browse all latest listings” action leads out of the bounded suggestion set.
- **Nearby:** choose UIUC, Champaign or Urbana, or derive a supported coarse area from a one-time location request. Filtering matches the seller's published pickup area, including known bilingual campus labels. No distance in meters, precise address verification, continuous tracking or fraud-proof physical-presence claim is made. A denied or unsupported fix keeps the previous choice.
- **Not interested:** explicit card menu and long-press action; account-private server table, maximum 1,000 hidden items; immediate undo and restore-all in filters. No public impact on the seller. Direct item links remain accessible. Other users cannot read or edit the feedback. Account and item deletion cascade it away. Search excludes hidden items except when explicitly scoped to a seller.
- **Seller search:** public nickname joins existing product fuzzy search with the description weight. A profile cache rebuilds one row on nickname change; no mass rewrite of that seller's listings. Profile and item RLS remain authoritative; private names/email are never indexed.

## Operational boundaries and next iterations

No notification/push blast is enabled by these changes. Existing opt-in saved-search/follow notifications stay separate. No paid service or opaque tracking SDK is introduced. Area selection is not a verification badge.

Measure empty searches, successful result-to-detail transitions, meaningful contact actions, hiding/undo rates, latency and seller coverage using aggregated instrumentation before changing weights. Do not collect chat text or raw GPS for ranking. As the catalog grows, replace bounded recency retrieval with indexed category/area retrieval or a server snapshot service after measured capacity warrants it. Preserve opt-out, stable pages and explicit explanations.

Verification so far: isolated PostgreSQL seller nickname changes/fuzzy matching/profile visibility/rollback passed; private feedback, pagination, block direction, area, diversity, 1,000-item bound and data-preserving rollback/reinstall passed. Browser and hosted capacity evidence will be recorded in the main acceptance ledger. This document does not assert production deployment or measured recommendation quality.
