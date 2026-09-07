# September 6 candidate: ordered release preparation

This candidate fixes listing/chat presentation, category-specific publication,
notification privacy, background recovery, compiled admin unlock and chat poll
access. September 6 acceptance also found slow bilingual search at 10,001
synthetic items and public CI using the old production schema. The follow-up
keeps the existing RLS and response shapes while removing repeated search
calculations, bounds both search RPCs to 12 nonempty terms of at most 200
characters, and runs PR public smoke against a prepared staging schema.

The review entry is [merged PR 331](https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/331).
PR 331 was merged to main as `878fc4f` on September 7 at 02:46 UTC
(September 6 Chicago). Its production deployment is READY. The migration and
worker receipts below supersede the initial read-only audit. This does not
certify physical devices, delivery, backup restoration or large-scale capacity.

## Order before frontend promotion

Verify `supabase/migrations/manifest.sha256`; record the actual target project's
ledger and schema. Management API migration versions can differ from source
filenames, so reconcile by verified function/schema definitions as well.

| Order | Source migration | Check before applying | Check immediately after |
|---|---|---|---|
| 1 | `20260905081748_block_safe_listing_notifications.sql` | `PRECHECK_20260905_block_safe_listing_notifications.sql` | `VERIFY_20260905_block_safe_listing_notifications.sql` |
| 2 | `20260905184951_campus_location_search_alignment.sql` | 11-argument legacy search exists, remains invoker, and `items` RLS is enabled; embedded prerequisite also enforces signature | `VERIFY_20260905_campus_location_search_alignment.sql` |
| 3 | `20260905194646_structured_housing_rideshare_details.sql` | `PRECHECK_20260905_structured_listing_details.sql` | `VERIFY_20260905_structured_listing_details.sql` |
| 4 | `20260905212134_durable_background_jobs.sql` | `PRECHECK_20260905_durable_background_jobs.sql`, including previously hidden image counts | `VERIFY_20260905_durable_background_jobs.sql` |
| 5 | `20260906091453_bounded_listing_search.sql` | `PRECHECK_20260906_bounded_listing_search.sql` | `VERIFY_20260906_bounded_listing_search.sql` |

All named checks live in `supabase/_ops`. Do not replay applied files or use a
blanket database push. The background prerequisite deliberately refuses to run
before the restrictive listing-notification read policy exists; the search
optimization refuses to precede structured details. Stop on schema drift.

Production applied and verified all five migrations, in order, at 02:37–02:40
UTC on September 7. Actual ledger versions are `20260907023711`,
`20260907023742`, `20260907023822`, `20260907023935` and `20260907024048`.
All 154 source migration hashes passed. Existing item content remained
unchanged: 14 rows with digest `432cc3dabc2536fc2dde72fc3de22785`; 16 profiles
and Auth accounts. Production public schema probes both returned 200.

The latest inspected daily physical backup was completed September 6 at
07:16:17 UTC. An isolated restore has not run: creating a potentially billable
restoration project requires separate approval (requested with a US$5 limit).
[Supabase database backups](https://supabase.com/docs/guides/platform/backups)
contain Storage metadata but not object bytes. Database and file recovery
remain separate operational acceptance requirements.

Production deployment `dpl_DBHAD9XQ39W8483zQcFSqWfFkiCh` serves main `878fc4f`.
The scheduler completed all 13 backfilled moderation-media jobs; pending and
failed counts are zero. Storage retains all 22 objects: 9 public item images
and 13 in private moderation evidence. Rollback reference:
`dpl_8zqbr3qLhFpjVifxJJdzM7yDh4KT` at `c0dfb8b`. Follow the worker-preserving
rollback instructions below; do not reverse the additive database changes.

Post-merge CI exposed a first-visit hint covering a short feed and an absent
translation endpoint in Vite's authenticated test harness. The follow-up moves
the hint into normal feed flow and adds single-listing/rotation/dismissal
coverage. The account sweep explicitly models the translation no-provider
response while checking the real synthetic session identity and request; all
other HTTP errors remain failures. This does not claim paid-provider delivery.

After database VERIFY, run `scripts/verify-public-read-schema.mjs` using only
the target's public client key; its two zero-row reads catch missing listing
fields and the plaza item join. Build/deploy the reviewed candidate with the
matching database identity and server-only secrets. Validate the actual
deployment, permissions and core flows before promoting its public alias.

## Rollback and recovery

Preserve the last working deployment ID and its environment before promotion.
An application rollback retains additive database columns, queues and recorded
deals. It must not drop private job tables, remove privacy policies, recreate
old broad grants or erase post-release user activity. Do not restore the whole
database just to roll back the frontend.

If rolling back to an app version without `/api/background-jobs`, keep a
reviewed worker deployment serving the same database and invoke its protected
route through an approved scheduler until a forward fix lands. Otherwise the
new outbox will accumulate notifications and hidden photos. Verify both the
write path and worker processing after an application rollback.

For a function-only search regression, use a new reviewed forward migration
and compare result IDs, ranks and RLS again. Applied migration files remain
immutable. Do not remove input bounds as an emergency performance fix.

Moderation moves and CDN invalidations are not part of the database transaction.
Coordinate restoration of an in-flight photo from the private evidence bucket;
do not claim an SQL rollback can restore bytes or revoke browser caches.
See [background jobs](../admin/BACKGROUND_JOBS.md) for exact retry and recovery.

## Runtime acceptance and limits

- Record actual production cron receipts for `/api/background-jobs`, with the
  deployment ID, database identity, completion counts, oldest pending age and
  failures. Protected Preview invocations do not prove production scheduling.
  Any failed media job, repeated 503 or a continually growing backlog requires
  operator action. Sentry/alerts must be verified with a controlled event.
- Local 10,001-item search improved from about 1.4 seconds to 0.29 seconds for
  selective terms, and 6.7 seconds to 0.96 seconds for three terms. Ordered IDs
  and ranks matched. No extra index was retained without measured benefit.
  This uses synthetic content and a simplified RLS fixture, not production
  hardware or a thousand concurrent users. Broad/short searches and many
  synonyms still need a realistic hosted capacity test before large rollout.
- PR public smoke uses only `PR_SMOKE_SUPABASE_URL` and matching public-key
  repository variables for the prepared candidate. Main retains its production
  public config. Account smoke remains protected-environment, main-only; a PR
  never receives its password or service credentials. Missing schema fails
  before browser startup; HTTP errors are not ignored to make CI pass.
  The boundary job installs PostgreSQL 17 from the official signed package
  repository; database tests resolve Linux and Mac binaries. A previous green
  run skipped several SQL suites because only another major was installed.
- Real two-account API flows cover transaction attribution, meetup decisions,
  duplicate submission, rating retries and report boundaries. Browser emulation
  covers desktop, iPad and phone layouts; it cannot certify physical keyboard,
  IME, camera picker, touch, orientation and weak-network behavior on real devices.
- Complete Hosted Realtime canary still requires the repository's independent
  Gate 0 and fresh provider proof. SMTP/OAuth/hooks/JWT control-plane settings
  were not readable without a dashboard login. Do not self-sign a reviewer,
  reuse the consumed August activation or alter the original nonparticipant.
- Real Google/email delivery, alert receipt, backup restoration, moderation
  staffing and initial active inventory must be validated for a public launch.
  Daily email digest's 200-recipient ceiling is not large-audience capacity.
