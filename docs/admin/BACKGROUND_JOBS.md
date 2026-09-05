# Background work and moderation media recovery

Apply `20260905212134_durable_background_jobs.sql` after its PRECHECK, run its
VERIFY, then deploy the matching API. The migration replaces both listing
INSERT fanouts with one transactional outbox event. It also inventories photos
on already-hidden items/posts, so inspect the PRECHECK counts before choosing a
production maintenance window. No migration schedules a hosted database job.

`GET /api/background-jobs` requires the dedicated server `CRON_SECRET` and the
same deployment/database identity gate as other privileged routes. Vercel runs
this route every minute **on production deployments**. Protected Previews need
explicit, bounded authenticated invocations during acceptance. A Preview manual
pass is not evidence that production scheduling works. Verify the account's
cron plan supports this frequency and retain actual scheduler run receipts.

Each invocation processes up to three media objects and 100 listing batches
of at most 200 source recipients, with a 25-second total deadline and bounded
upstream reads. PostgreSQL locks each listing job with SKIP LOCKED; cursor,
notification insert, and saved-search throttle commit together. Users can still
block a seller after enqueueing: every batch checks both block directions and
current listing/seller visibility. The existing restrictive notification read
policy and email privacy checks remain active. Follows/searches created after
publication do not receive the older listing's alert.

A status change to item `deleted` or post `hidden` captures each image in the
same transaction. Storage moves still run immediately during a moderation API
request. If that request dies or a move fails, the independent task retries.
Each object has a two-minute lease. Failed moves back off from 60 seconds to one
hour; ten failures leave a durable `failed` record and cause worker HTTP 503.
Expired or superseded leases cannot acknowledge a later worker's result.
Restored content cancels unclaimed cleanup. A manual restore while a worker is
already moving a photo requires coordinated restoration from the private
`moderation-evidence` bucket; there is no transactional cross-service undo.

The worker accepts only this project's public item-image URLs in the original
author's own upload folder. Foreign origins, another owner's folder and path
traversals are cancelled without touching Storage. A missing source is treated
as already removed, including Storage's actual HTTP 400 / `NoSuchKey` response.
This proves public removal, not that an earlier external deletion preserved a
private copy. A move never becomes a bulk delete. Database job receipts expire
after 30 days; private evidence objects follow the separate content/privacy
retention procedure and are not erased by this worker.

Monitor `listing_pending`, `listing_oldest_seconds`, `media_pending` and
`media_failed` in the authenticated response. A growing oldest age, any failed
media, repeated HTTP 503, or absence of scheduled runs needs operator action.
Sentry receives counts only when configured. Do not treat missing Sentry
configuration as monitoring coverage. For a failed media job, an authorized
database operator reviews the exact object/reference and resolves the Storage
error first, then resets **only that reviewed job ID** to `state='pending'`,
`attempts=0`, `due_at=clock_timestamp()`, with lease fields cleared. Record the
case and retry receipt; never reset all jobs or grant clients private-table
access. Preserve the source/evidence objects while investigating.

The digest now stores its user scan cursor before profile/provider processing.
Opted-out users and mail errors keep their rows unemailed but cannot pin every
run to the first 200 users. Cursor writes use compare-and-set; notification
delivery claims still provide send idempotency. The existing daily schedule,
200-user cap, seven-day lookback and email enablement gates remain in effect.
This is a fairness fix, **not sufficient email capacity for thousands of daily
recipients**. Before expanding that audience, agree on per-user send frequency,
add a per-user frequency gate, and measure a more frequent worker schedule and
provider limits. Do not simply increase parallel email sends or enable live
email in staging.

The isolated PostgreSQL regression is
`scripts/durable-background-jobs.test.mjs`. It covers rollbacks, eight concurrent
workers, late blocks, 10,000 followers, claim expiry, re-hide, storage retry
exhaustion, cross-role access, and bounded receipt retention. API regressions
exercise malformed/hostile provider responses and fixed request bounds.
