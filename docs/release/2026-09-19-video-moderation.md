# Private chat video review candidate

This implementation is disabled by default. A successful build or database test
does not establish Tencent provider acceptance, WeChat privacy approval, an
experience release, or permission to release the mini-program publicly.

## Contract

- Files stay in the existing private `chat-media` bucket. The service derives the
  object from a leased database job, never a client-provided fetch URL.
- A job is bound to the uploader, object ID, version and unique provider DataId.
  An approval cannot be reused after deleting/replacing bytes at the same path.
- Tencent VM `2021-09-22` uses TC3 signed server requests. The account's reviewed
  `BizType`, TaskId, DataId, Type and final verdict must match. Only `Pass` allows
  inserting a video message. Pending, failed and ambiguous results fail closed.
- A lost submission response goes to manual review; it is never automatically
  submitted again. Read-only polling can retry until the 30-minute job deadline.
- A private signed download link expires after 30 minutes and is sent only to
  the configured Tencent service. No link, credentials or user content enters
  Sentry. The privacy disclosure must identify this processor before activation.
- The mini-program accepts at most 60 seconds / 20 MiB and waits up to three
  minutes for approval. Failure preserves text and removes that unsent upload.
  The provider may still finish a task already accepted before client timeout.
- The initial worker handles one task step per minute. This is deliberately a
  limited rollout, not a high-throughput video pipeline. Measure queue time and
  increase bounded processing capacity before a larger launch.

## Deployment and activation

1. Apply `20260919064706_private_video_moderation_jobs.sql` to staging first.
   It defaults `private.video_moderation_config.enabled` to false and leaves
   existing delivery behavior unchanged. Run the accompanying SQL regression in
   an isolated database; it rolls back its synthetic fixtures.
2. Configure server-only `TENCENT_VIDEO_SECRET_ID`, `TENCENT_VIDEO_SECRET_KEY`,
   `TENCENT_VIDEO_REGION` and reviewed `TENCENT_VIDEO_BIZ_TYPE`. Restrict the
   Tencent service account to create and inspect video-moderation tasks.
   Provider account, pricing/budget and data-processing terms require owner
   completion; they have not been provisioned by this change.
3. Accept consent text and test a benign video, reject/review verdicts, provider
   timeout, expired lease, account switch, no sender/recipient access before
   approval, blocked conversation, and actual WeChat delivery. Do not submit
   another person's private footage as a test fixture.
4. Deploy H5 with `VITE_CHAT_VIDEO_REVIEW_ENABLED=true` before opening the shared
   database gate, and verify update/reload behavior of old clients. Set server
   `CHAT_VIDEO_MODERATION_ENABLED=true`, then set the DB gate to true. This gate
   applies to all new video messages, including old H5 clients; stale clients
   will fail closed and need a reload. Existing messages are unaffected.
5. Only after staging + real-account acceptance, enable
   `VITE_WECHAT_CHAT_VIDEOS_ENABLED=true` for the accepted experience build.
   Enabling this flag alone is not safe or sufficient. Photos have an independent
   WeChat moderation/callback acceptance gate.
6. Monitor queue age, unsuccessful reviews, moderation cost and orphan cleanup.
   Terminal decisions retain the object binding; long-term retention must be
   bounded before a high-volume rollout. Never delete a still-used passed verdict.

## Rollback

Disable mini-program video entry and return to the previously reviewed build.
Keep the database gate enabled while review-dependent clients remain in use;
stopping the provider worker will prevent new videos from being sent. For a full
rollback to the previous H5-only behavior, explicitly disable the DB gate and
worker flag after reverting client flags. Never call that state “moderated.”
Do not drop queued decisions or delivered media as part of a routine rollback.
The migration is additive; existing messages and account identities are untouched.

## Evidence

API tests cover independent TC3 signing, exact private URL validation, task identity,
verdicts and ambiguous submission. PostgreSQL regression covers authoritative
delivery gating, leases, account isolation and object replacement. Mini upload
tests cover successful approval, rejected review cleanup and duration limits.
Real provider and real WeChat acceptance remain separate, currently open gates.

Provider contract: https://cloud.tencent.com/document/product/1265/101000
