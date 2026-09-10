# Browser network recovery audit — 2026-09-09

Baseline: `152ec20c14bdcf24100e24b3c4e715505822ba37`, verified against origin/main and the production deployment manifest.

## Chat changes in this release

Browser fault injection reproduced both forms of message loss: fail a send then switch conversations, or switch away before a delayed failure arrives. The unsent bubble vanished on returning because its lifetime was tied to the rendered timeline.

- Keep unconfirmed messages in account-session memory, separated by conversation, until acknowledged or explicitly restored to the composer.
- Update pending/failed/sent state even when the original chat view has unmounted.
- Preserve the original message id for retries; double taps and lost responses do not create a second message.
- Let authoritative history/realtime confirmation supersede local failure, while preserving newer server updates.
- Clear the private outbox synchronously on every account boundary. Stale completions cannot recreate it.

## Publishing candidate — not deployed

A separate browser regression reproduced a committed listing whose response was lost. The existing UI reported failure, leaving a risk of duplicate publication on retry.

The completed local candidate persists a listing id with the draft/photos, recovers by id and owner, reuses the id on retries after reload, preserves uncertain uploads, and localizes the recovery notice. It requires `GRANT INSERT (id) ON public.items TO authenticated` in staging `hygkwxugskijadgfisji`, then production `lfhvgprfphyfvhidegum`.

Automatic approval rejected the staging migration because this specific permission and target scope were not explicitly approved. No hosted migration was applied. The dependent client changes are excluded from this release and preserved in the local patch `output/network-recovery-20260909/publish-recovery-awaiting-approval.patch`. The review document is `output/network-recovery-20260909/PUBLISH_APPROVAL.md`. Do not deploy that candidate before the database change is approved and verified.

## Verification

- Browser suites with the complete local candidate: WebKit/light **57 passed**; Chromium/dark **57 passed**.
- Two baseline chat-loss regressions and the baseline lost-publish-response regression failed before the fixes, then passed.
- New recovery checks cover an iPad-sized remount, rapid Enter, double-click retry, response-lost commits, and publish reload/retry.
- Selected message/account tests: **75 passed**, including executable account-clear/late-completion and snapshot-acknowledgement races.
- Complete candidate passed deterministic contracts, type-check, H5 build and mini-program build through the existing pre-push gate. A local-only PostgreSQL test also verified duplicate ids, owner RLS, anonymous denial and protected columns. Three initially failing inventory/localization checks were corrected and rechecked.
- Manual read-only production browser checks: home, real listing detail/photo navigation, iPad 820×1180 and phone 390×844 layouts. No production message or listing was submitted.
- Exact main commit, CI and deployment receipts are recorded after release in `output/network-recovery-20260909/`.

## Remaining evidence limits

Private chat outbox recovery is within the current tab/session, not across a full browser reload. Device sizes and keyboard changes are simulated; physical iPhone/iPad IME and weak mobile-network behavior remain unverified. Browser fixtures do not establish production concurrency capacity. The canceled backup rehearsal remains out of scope.
