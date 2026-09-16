# September 16 feedback release

Candidate branch: `codex/user-feedback-20260916`, baseline `281799c`.
This document describes the reviewed sequence; a checklist is not a deployment receipt.

## Scope

Fix mobile publishing when local draft storage fails, input focus, image sizing,
dialog keyboard behavior, inbox pin/archive/unread, browse/search navigation,
seller-name search, private photo/video chat, individual history removal and
private not-interested preferences. Improve listing shares, badge palette,
location feedback and reduced-motion-compatible transitions. Add bounded,
explainable interest recommendations and queued English listing translations.

The evidence ledger is [user-feedback-plan](2026-09-16-user-feedback-plan.md).
The announcement is [plaza-welcome](2026-09-16-plaza-welcome.md).

## Deployment order

1. Pass the affected browser, SQL, API, type, H5 and mp-weixin gates on the exact
   candidate. Keep the existing production deployment available for rollback.
2. Read current production migration and object state. The verified September 16
   baseline has indexed search remote migration `20260916151259`, 14 items and
   18 profiles. Counts can change; do not rewrite or delete these records.
3. Run `node scripts/build-feedback-release-bundle.mjs`. It verifies the ten
   new source checksums and emits install/rollback SQL plus a checksum receipt
   under ignored `output/feedback-release-20260916/`. Inspect the complete bundle.
4. Apply **INSTALL.sql as one transaction** to the verified production project
   `lfhvgprfphyfvhidegum`. The guard requires the exact previously read indexed
   search definition and refuses an already installed feedback release. Never
   run a blind CLI database push or reapply the old indexed-search INSTALL.
   The tools' remote migration version will differ from source timestamps;
   record that mapping with the source receipt.
5. Verify ordinary anonymous item/profile embedding, public search and its
   privacy boundaries; verify consent accepts `2026-09-16` without rewriting
   existing consent. Old clients must keep working. All new private tables and
   storage remain protected. Record definitions, grants and visible row counts.
6. Merge through protected main and let the normal Vercel release complete.
   Verify the deployed SHA, browser journeys and fresh Sentry/worker evidence.

The consent migration must precede frontend activation. The hidden-items base
and surrogate-key repair must commit together: an intermediate composite-key
state would make old PostgREST profile joins ambiguous. Seller-name search must
ship with the final indexed integration: its intermediate full-scan function
would undo the already deployed capacity improvement.

## Translation activation

`LISTING_ENGLISH_AUTOTRANSLATE=1` is a separate server-side opt-in, default off.
An existing OpenAI key does not activate the new data flow. Keep it off until
the approved synthetic listing has a real provider receipt. Existing translations
remain readable; pending jobs remain durable. This release alone must not be
reported as completion of English-content acceptance.

The worker handles at most one listing per scheduled invocation; cron currently
runs each minute. Retry/lease/revision guards prevent stale translations replacing
new edits. Queue age, failure and throughput need monitoring before increasing
publication volume; this is not a bulk-translation capacity guarantee.

## Rollback

Disable automatic translation first, then restore the prior web deployment.
Apply the generated **ROLLBACK.sql in one transaction**. It stops new attachment
uploads and manual-unread writes, retains protected media and user preference
data, stops translation claims, removes seller-name integration, and finally
restores the exact indexed query that production had before this release.

Do not drop `search_private.knn_fields` or `union_rank`; they predate this release.
Do not restore the legacy full-scan query as the final search state. Do not remove
the new consent allowlist or rewrite consent: already accepted legal versions
remain valid. Storage paths, attachment validation and orphan cleanup protection
remain in force even when new uploads are disabled.

The local PostgreSQL test compares the entire restored function definition with
the pre-release indexed function and verifies search results, retained indexes
and retained private choices. Individual feature rollback tests cover other
objects. This does not replace a complete production Auth/Storage recovery drill.

## Capacity evidence and limits

The hosted staging fixture contains 10,001 synthetic listings; all constraints,
triggers and RLS remained enabled. Anonymous and authenticated discovery passed
1/5/10 concurrency, including separate profile hydration. At concurrency 10,
authenticated p95 was 252–285 ms across the four browse modes.

The corrected 60-second mixed run completed 682 browse/search reads and six
message writes without failure. All six messages arrived by Realtime and polling,
outsiders received none, 202 follower/search notifications persisted, one public
image moved into private moderation evidence, and the final worker queue was empty.
Search p95 was 313–384 ms; message writes p95 155 ms. The first run is retained as
failed evidence: seed-time jobs blocked notification processing and the harness
had not explicitly finished Realtime authentication before joining. Correcting
fixture preparation and awaiting `realtime.setAuth` made the repeat pass.

The bulk-seed backlog also demonstrates a real operational limit: 100 notification
batches per invocation do not instantly drain a 9,500-listing import. Imports must
be staged and queue age monitored. Short closed-loop screening is not a concurrent
user-count promise or a sustained production soak test.

## External acceptance still open

- Real approved OpenAI translation receipt and subsequent opt-in activation.
- Owner-unlocked admin session, one duplicate-checked bilingual announcement and
  an official/pinned post receipt. No substitute administrator token is minted.
- Google-authored authorization notification (separate from the completed site
  signup/recovery email receipts).
- Device keyboard/photo/background recovery, actual external-app share previews,
  mini-program private-media moderation, experience-version real accounts and
  platform review. These cannot be inferred from H5/mp builds.
