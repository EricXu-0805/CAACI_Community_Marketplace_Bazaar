# Browser network recovery audit — 2026-09-09

Baseline: `152ec20c14bdcf24100e24b3c4e715505822ba37`, verified against origin/main and the production deployment manifest.

## Chat changes in this release

Browser fault injection reproduced both forms of message loss: fail a send then switch conversations, or switch away before a delayed failure arrives. The unsent bubble vanished on returning because its lifetime was tied to the rendered timeline.

- Keep unconfirmed messages in account-session memory, separated by conversation, until acknowledged or explicitly restored to the composer.
- Update pending/failed/sent state even when the original chat view has unmounted.
- Preserve the original message id for retries; double taps and lost responses do not create a second message.
- Let authoritative history/realtime confirmation supersede local failure, while preserving newer server updates.
- Clear the private outbox synchronously on every account boundary. Stale completions cannot recreate it.

## Publishing recovery — approval resolved on 2026-09-10

A separate browser regression reproduced a committed listing whose response was lost. The existing UI reported failure, leaving a risk of duplicate publication on retry.

The publishing fix persists a listing id with the draft/photos, recovers by id and owner, reuses the id on retries after reload, preserves uncertain uploads, and localizes the recovery notice. The required `GRANT INSERT (id) ON public.items TO authenticated` was applied to staging `hygkwxugskijadgfisji`, verified, then applied to production `lfhvgprfphyfvhidegum` after the user's explicit approval.

The earlier automatic approval rejection is resolved by the user's September 10 approval of the exact grant, targets and staging-first sequence. Both projects now allow authenticated INSERT of `items.id`; ID UPDATE, protected status INSERT and anonymous ID INSERT remain denied. Owner RLS policies and trigger definitions are unchanged. The original candidate patch remains archived in `output/network-recovery-20260909/`; it is incorporated into this release.

| Environment | Hosted migration ledger version | Source migration |
| --- | --- | --- |
| Staging | `20260910202448` | `20260909201600_idempotent_item_create.sql` |
| Production | `20260910202643` | `20260909201600_idempotent_item_create.sql` |

The migration service assigns execution timestamps; these ledger entries have the same grant as the immutable source migration. A staging transaction running as the ordinary authenticated SQL role with simulated JWT claims verified client-ID creation, primary-key duplicate rejection, recovery of one unchanged owned row, foreign-owner rejection, ID-update rejection, protected-status rejection and anonymous rejection. All probe writes were rolled back; the leftover count is zero. This proves database behavior, not real Auth issuance. The protected staging CI check additionally signs in with real Auth, uploads a photo, publishes with a client UUID, rejects a repeated UUID, recovers the original owned listing/photo and removes the fixtures.

Final browser review also reproduced a delayed commit becoming visible between the retry lookup and INSERT. The real duplicate-title trigger can return `P0001 duplicate_item` before UUID uniqueness runs. The client now reconciles every server refusal of an uncertain retry against the original owned ID and keeps the outcome uncertain if recovery cannot establish it. A failing-before/fixed-after browser regression covers this timing; staging CI exercises both the identical-title guard and the edited-title UUID guard.

## Verification

- Browser suites with the complete local candidate: WebKit/light **57 passed**; Chromium/dark **57 passed**.
- Final candidate integrated onto `cbbc9f9`: WebKit/light **58 passed**, Chromium/dark **58 passed**, plus the complete pre-push gates. This includes the tall-Mac fix and both publishing response-loss cases.
- Two baseline chat-loss regressions and the baseline lost-publish-response regression failed before the fixes, then passed.
- New recovery checks cover an iPad-sized remount, rapid Enter, double-click retry, response-lost commits, and publish reload/retry.
- Selected message/account tests: **75 passed**, including executable account-clear/late-completion and snapshot-acknowledgement races.
- Complete candidate passed deterministic contracts, type-check, H5 build and mini-program build through the existing pre-push gate. A local-only PostgreSQL test also verified duplicate ids, owner RLS, anonymous denial and protected columns. Three initially failing inventory/localization checks were corrected and rechecked.
- Manual read-only production browser checks: home, real listing detail/photo navigation, iPad 820×1180 and phone 390×844 layouts. No production message or listing was submitted.
- Exact main commit, CI and deployment receipts for the approved publishing release are recorded in `output/publish-recovery-20260910/`; preceding chat/layout evidence remains in `output/network-recovery-20260909/`.

## Remaining evidence limits

Private chat outbox recovery is within the current tab/session, not across a full browser reload. Device sizes and keyboard changes are simulated; physical iPhone/iPad IME and weak mobile-network behavior remain unverified. Browser fixtures do not establish production concurrency capacity. The canceled backup rehearsal remains out of scope.

## Dependency advisory found during release

The chat commit `71d2f22` deployed successfully and passed both local browser suites (WebKit/light **55**, Chromium/dark **55**). Its first CI run nevertheless failed the dependency audit: [GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9), reviewed September 8, covers adm-zip through the latest published 0.6.0, with no patched release available at verification time.

The installed DCloud code uses this library only for packing/extracting paid encrypted uni_modules through HBuilderX cloud compilation. This repository has no such plugins. The follow-up removes the archive library and resolves that optional dependency to the local `@caaci/disabled-cloud-zip` package, which performs no archive/filesystem operations and throws immediately on use. Encrypted-plugin cloud compilation is deliberately unavailable until a reviewed safe implementation is introduced. Normal H5 and mp-weixin compilation remain release gates.

No advisory is allowlisted, no audit level is lowered, and no unpatched version is relabeled as patched. npm 11 audit reports **0 vulnerabilities**. Executable tests verify DCloud's actual module resolution, lockfile target, constructor refusal, and preservation of an external file behind a destination symlink. A clean lockfile install is also verified before publication. Exact follow-up CI/deployment evidence is in the local release receipt.

## Tall desktop listing layout found by CI

Security follow-up `a0e67bf` passed dependency/boundary, type-check, both builds and public browser CI. The protected staging browser job found the text-only listing information card at y=170.875, beyond the existing y<170 acceptance threshold. Reproduction at 1440×1400 made the defect clearer: y=208.59375 before the fix.

The desktop grid inherited `min-height: 100vh`; its default content alignment distributed unused height between automatic rows. Text-only desktop pages now use `align-content: start` so extra height stays below their content. The original threshold remains unchanged, and the browser suite now includes both 1440×900 and 1440×1400 as well as phone and iPad sizes. Both affected browser suites passed locally: WebKit/light **56**, Chromium/dark **56**. Verification receipts distinguish this corrected release from the earlier failed CI run.

The device checklist also corrects two stale expectations against current code: structured housing/rideshare fields now exist, and two-pane chat starts at 1100px. Physical-device rows remain unverified.
