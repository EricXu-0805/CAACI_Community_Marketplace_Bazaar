# September 16 real-device feedback: repair and acceptance plan

Baseline: main `281799c`. This is a new audit, not a restatement of earlier green checks. User-provided iPhone screenshots are current defect evidence. Status starts **open** until independently verified.

## Execution order

1. Reproduce and fix publishing/drafts, search navigation, inbox actions and location feedback. Inspect current Sentry errors and correlate them with these paths.
2. Improve mobile spacing, input focus/composer layout, badge, image viewing, dialogs, transitions and media affordances. Keep keyboard access and reduced-motion support.
3. Deliver English counterparts for listing content, individual history deletion, not-interested controls, seller search, researched recommendation rules and share metadata.
4. Verify admin reports/bans/pinning and Plaza interactions in isolated fixtures/test accounts. Publish the explicitly requested bilingual admin introduction using only verified feature claims.
5. Run affected tests, cross-device browser checks and release checks; merge/deploy through normal protection and verify exact deployed revision. Document external-device/platform limits separately.

## Acceptance ledger

| ID | User outcome | Status | Required evidence |
|---|---|---|---|
| 01 | On sale/Wanted row has comfortable spacing at narrow widths | Implemented; light/dark cross-device WebKit evidence passed; release pending | 375/390/430 px screenshots, 768/1024/1440 px no overflow |
| 02 | Shared listing identifies its item, price, image and brand | Metadata tests passed; real external-app preview pending release | server metadata plus real supported share preview; OS-owned layout limitation |
| 03 | Illini verification badge fits profile palette | Implemented; light/dark cross-device WebKit evidence passed; release pending | light/dark visual checks, accurate accessible label |
| 04 | Hide uninteresting items; useful nearby/interest feed and fuzzy search | Local/hosted preference checks passed; 10k discovery capacity passed; release pending | primary-source design, reversible control, privacy, deterministic ranking/pagination tests |
| 05 | Search stays on search; seller names find their listings | Navigation + seller matching/RLS/rename/rollback verified locally; deployment pending | actual navigation and seller matching tests |
| 06 | Remove one viewed item via gesture or visible action | Local gesture, visible deletion and failed-storage preservation passed; release pending | removal survives revisit; other history stays |
| 07 | Focused search/chat fields align without harsh inner box | Implemented; light/dark cross-device WebKit evidence passed; release pending | keyboard focus visible, touch focus and composer geometry |
| 08 | Chat supports discoverable photos and video | Private SQL, H5 browser and hosted image/video/access checks passed; mini-program media remains gated | authorized media upload/view/error tests, access and size limits |
| 09 | English mode offers English listing titles/descriptions | SQL/browser retry and caching passed; real provider receipt and opt-in pending | original preserved, translation displayed/cached, failure/retry handling |
| 10 | Pin/archive/read-unread actually change conversation state | Local SQL + phone/desktop WebKit verified; deploy pending | persistence, two participants, account transition safety |
| 11 | Locate shows result/error; manual and detected labels distinguished | Local WebKit denied/detected/manual verified; device permission UX remains a real-device check | permission/timeout/unsupported/edit flows; no false identity verification |
| 12 | Draft failure does not trap a valid publication or lose edits | Local unavailable-storage + idempotent retry verified; deploy pending | reproduced failure, recoverable/idempotent publish, draft restore |
| 13 | Admin reports/bans/Plaza pins and media work | Synthetic admin/browser checks passed; owner portal unlock pending | isolated authorized/unauthorized tests and read-only production inspection |
| 14 | Images open at useful size with clear viewer controls | Phone/tablet/desktop cover and fullscreen sizing/focus verified locally; release pending | landscape/portrait/phone/tablet/desktop visual evidence |
| 15 | Current Sentry issues investigated and confirmed bugs fixed | Live triage recorded; modal refs and native network listener fixed locally; post-release observation pending | current issue/event evidence with sensitive fields excluded |
| 16 | Admin welcome/rules/how-to post is published and Plaza tested | Open | published post receipt and factual bilingual content |
| 17 | Clicks/icons/modal/composer transitions feel coherent | Cross-device light/dark and dialog/motion tests passed; user acceptance pending | representative flows, reduced motion, no blocked interactions |

## Scope and safeguards

- User explicitly approved reasonable fixes, main release, and the Plaza admin announcement. Avoid test messages or content sent to real users; test account fixtures first.
- Existing signup and recovery templates were already applied and genuinely received in the preceding round. Google-authored authorization notification remains a separate pending receipt; do not resend unrelated emails as substitute evidence.
- Earlier broad Goal remains blocked by independent hardware/platform gates; it must not be marked complete to replace it. This ledger persists the present work without erasing those gates.
- Recommendations should support successful local trades rather than maximize time spent. Exact GPS is not proof of identity/address, and campus pickup labels are not location verification.
- English user-content support is a new explicit requirement; preserving Chinese-only originals on English screens is no longer an acceptable final experience.

## September 16 working evidence (not yet released)

- Branch `codex/user-feedback-20260916`; no production migrations or deploy from this round yet.
- WebKit: 8 targeted scenarios passed (draft unavailable + same-id retry, location denied modal/focus, detected-to-manual location, history right-swipe + visible delete, profile-to-search navigation, phone/desktop pin/manual-unread/archive, failed pin).
- Isolated PostgreSQL: per-participant manual unread works for an empty direct conversation and never reverses read receipts. Cross-party/stranger/blocked writes rejected.
- Private chat media: separate nonpublic bucket; keys bound to sender/conversation/message id; immutable uploads; participant/block/suspension/tombstone checks; 5 MiB image / 20 MiB video / 30-per-hour / 500-object / 500 MiB owner limits. Isolated SQL access/attachment/GC tests passed, including final lookup indexes.
- Media orphan cleanup: 24-hour grace, database claim locks out later attachment, Storage API deletion followed by database verification. Account deletion also sweeps chat-media. API tests: 41 deletion + 15 background-worker passed. 72 relevant frontend boundary tests passed.
- H5 media picker/render/retry: 2 WebKit scenarios passed with actual synthetic image/video files and one upload/message across retry. Mini-program upload intentionally still closed until private-media moderation handoff is implemented; never fall back to public item-images. Historical public chat attachments remain unavailable.
- Migration rollback/runbook, staging/production Storage API evidence, expired link/account change checks, real browser visuals and full release checks remain required.

## Sentry live triage

Sentry login completed by the user; live issue access restored. 37 unresolved groups in the 14-day view. Counts are a snapshot, not proof of current release regression.

| Issue | Evidence | Interpretation / action |
|---|---|---|
| JAVASCRIPT-VUE-25 / 7736111166 | 6 events, e03e910, PermissionDeniedModal `querySelector` on component ref | Confirmed; resolve `$el`, native keydown binding; WebKit focus/Tab/Escape passed |
| JAVASCRIPT-VUE-1Z / 7734906548 | saved-searches `querySelector`, 8b930d3 | Same confirmed bug; fixed alongside admin/Plaza dialog ref normalization; saved-search sheet focus, Tab and Escape passed |
| JAVASCRIPT-VUE-28 / 7736131972 | 24 publish.create events, e03e910 | Matches failed-draft publication path; synthetic reproduction fixed; raw provider cause not recoverable from scrubbed event |
| JAVASCRIPT-VUE-24 / 7736102465 | 27 realtime.fallback.notifications warnings, e03e910 | Distinguish expected recovery from actual degradation; investigation pending |
| JAVASCRIPT-VUE-27 / 7736117817 | loadMyFavorites provider error, e03e910, no code | Not enough evidence to assign cause yet |
| JAVASCRIPT-VUE-26 / 7736117700 | fetchProfile-authchange-signed_in, e03e910, no code | Not enough evidence to assign cause yet |
| JAVASCRIPT-VUE-21 / 7735329271 | auth-record-fingerprint, code 42501, 5a89415 | Historical-version access error; check current policies/runtime before changing authority |
| JAVASCRIPT-VUE-22 / 7735329301 | fetchProfile-authchange-signed_in, code 42501, 5a89415 | Historical-version access error; current production grants verified |
| JAVASCRIPT-VUE-20 / 7735218794 | minified TypeError; 2866988 / 5697c76 | Unresolved source mapping; do not guess |

No issue was resolved/ignored in Sentry merely because a local test passed. Current production verification still pending.

- Cover aspect no longer depends on later wide images; native fullscreen images now fill the available stage with contain sizing. 6 WebKit cover/viewer/focus scenarios passed across phone/tablet/desktop.
- Seller nickname search and discovery preference migrations passed isolated PostgreSQL tests, including hidden ownership, symmetric blocks, candidate diversity, feedback quota and rollback/reinstall. Research and explicit ranking rules: `2026-09-16-discovery-design.md`.

## Latest integrated evidence — September 16 (still not deployed)

- Combined WebKit: **93/93** passed (publishing/discovery, inbox state, private photo/video/retry, admin moderation/pins/banner, Plaza picker, translation states). H5 and mp-weixin builds plus type check passed before the final profile-embed/search integration; final build/check repeat underway.
- Hosted staging: **21 core checks**, **7 additional video/consent/photo checks**, and **6 Plaza checks** passed. Actual GoTrue synthetic accounts, actual private/public Storage APIs, ordinary participant/outsider JWTs. The initial Plaza fixture supplied a forbidden client id; corrected to the actual server-generated-id app flow. No messages to real users.
- Private Storage upload preflight uses `version=1` and may omit measured size. Forward fix admits only this provider preflight; finalized attachment still requires positive measured bytes/MIME. Actual upload, signed participant read, unsent/outsider/public denial, overwrite denial and video byte integrity passed.
- Admin reason dialog previously prefilled the action explanation into the reason. Replaced with target/impact text, blank labeled reason input, explicit validation, keyboard trap, Escape/cancel and focus restoration. Synthetic WebKit ban/report/pin/banner and cancellation checks passed.
- Expanded bilingual privacy version `2026-09-16` describes private attachments, public-listing English translation, private hide preferences and coarse-area discovery. **Consent DB acceptance must ship atomically before the frontend.** Old accepted versions stay valid; no old profile consent is rewritten.
- **Old-client compatibility caught by hosted HTTP:** adding `hidden_items` with an FK-pair primary key made PostgREST infer a second item→profile relationship, causing PGRST201. Forward fix uses a surrogate key and keeps unique `(user_id,item_id)`; app joins also name `items_user_id_fkey`. Original implicit browse now succeeds in actual hosted load. Apply base + forward fix in one production transaction.
- **Write performance:** a 500-item synthetic seed timed out in the moderation keyword loop. Stored generated patterns plus set-based matching preserve the full moderation corpus/live edits and pass rollback/reinstall. The same 500-item batch then succeeded; 10,001 capacity fixtures were inserted with all triggers/constraints intact. 100 moderation checks measured 135 ms on staging; this is not a peak writer-capacity claim.
- **Critical integration regression detected before production:** seller/discovery migrations restored an old full-scan search body, overwriting the indexed revision-3 algorithm already deployed as remote `20260916151259`. A simple bounded candidate experiment was rejected after slow results and removed from staging. Final forward integration retains the exact existing indexed query and extends its maintained title index to public seller nicknames; nickname edits update cached fields. Do not reapply the old production INSTALL package.
- **10,001-item hosted read screening:** 1/5/10 simultaneous requests, 15 s per stage, six browse/search workloads. Final integrated indexed search passed all correctness/privacy/latency checks, zero HTTP failures. At concurrency 10: browse p95 229 ms, single-term 727 ms, synonym 894 ms, broad 888 ms, 12-term 1,517 ms, absent 1,477 ms; achieved 11.21 requests/s. Closed-loop short synthetic screening is not a user-count guarantee or soak test.
- **Discovery screening:** 1/5/10 simultaneous requests, 12 s per stage, includes candidate retrieval plus product/profile hydration. Anonymous latest/For You/nearby/price all passed; at 10, p95 249–276 ms, 28.82 completed journeys/s. Authenticated scope and mixed-write run tracked separately.
- Final full regression: 1,458 passed, one corpus-definition tripwire failed after the intentional moderation optimization, one skipped. The corpus had already been rerun against the new function; its stale definition pin was corrected and the affected suite passed. H5, mp-weixin and type checks passed after final profile joins. The 60-second mixed workload then passed: 688 read/write requests, 6/6 Realtime messages, complete polling recovery, 202 durable notifications, private media relocation and empty final queue. Initial failed run is retained with its seed backlog/auth-harness causes. No production deployment, migration, commit or announcement from this round yet.

### Outstanding external actions

1. Automatic translation now has a default-off server opt-in (`LISTING_ENGLISH_AUTOTRANSLATE=1`), so an existing provider key does not activate it. Real public-listing translation call is pending explicit approval for sending only the named synthetic listing to OpenAI; automatic review rejected the earlier attempt. No OpenAI call was made for that fixture.
2. Owner admin portal is logged out of its personal-token session. User was asked to unlock in the existing browser; token should not be shared in chat. Announcement is prepared in `2026-09-16-plaza-welcome.md`, not yet posted or marked official/pinned.
3. Google-authored authorization notification remains separate from completed website signup/recovery branding receipt. Existing bounded follow-up remains responsible.
4. Mini-program private media remains H5-only until private WeChat moderation/provider acceptance is implemented. Experience-version real account/config/review and physical-device input/photo/background acceptance remain distinct gates.

### Sentry additional triage

- 1Y / 7731779582: old 8b930d3 H5 native network listener assumed `navigator.connection.addEventListener`; fixed using browser online/offline events with cleanup, tested partial connection capability.
- 1W / 7727697657 and 1T / 7727696769: historical `items.failed_upload_candidate_cleanup`, Storage 500, orphan-risk warnings; 1T includes avatar edit in 6a7c355. 1S / 7727696766 is the paired `storage_remove_failed` warning. Current hosted upload success does not prove these historical provider failures are resolved.
- 21/22/23 historical 42501 events: current production RPC grants were checked (authenticated allowed, anonymous denied). Do not weaken permissions to suppress the old errors.
- Sentry issues remain open until fresh deployed evidence supports closure. Synthetic runs and old releases are not counted as current end-user incidents automatically.

- Authenticated 10k discovery screening also passed: ordinary GoTrue buyer, 1/5/10 concurrency; at 10, 358 journeys in 12.24 seconds, p95 252–285 ms, no errors. Ordered search rollback now compares the complete restored definition to the actual prior indexed algorithm. Final focused worker/search/rollback/corpus checks: 20 passed.

## Release handoff — candidate 92528e8 / PR 337

- Full pre-push boundaries, types, H5/mp-weixin builds and artifact checks passed. PR: https://github.com/EricXu-0805/CAACI_Community_Marketplace_Bazaar/pull/337. No direct main push or protection bypass.
- Production atomic bundle attempt was rejected **before execution** by automatic review: the current permission was judged insufficient for this specific ten-part production change (storage, permissions, triggers, search and brief locking). A concrete approval card was sent. Production remains at the prior migration/release; do not merge before the DB step is approved, applied and verified.
- The generated bundle and prior production function snapshot are in ignored `output/feedback-release-20260916/`; `scripts/build-feedback-release-bundle.mjs` rebuilds the checksum-verified bundle. See `2026-09-16-feedback-release.md` for order and rollback.
- Mixed-run fixtures and 10,001 capacity listings / 101 synthetic SQL users were removed with ownership guards and normal cascade rules. Staging returned to the pre-capacity **3 items / 9 profiles**, its item cache also has 3 rows, and notification/media queues are empty. Three GoTrue feedback fixtures remain for the pending translation/feature follow-up; private credential files remain local, ignored and mode 0600.
- Final staging security advisor has no ERROR finding. Service-owned RLS tables deliberately have no client policies; authenticated SECURITY DEFINER RPCs require their account/participant checks. The existing Han-fold warning is an intentional immutable invoker SQL expression calling `pg_catalog.translate`, with hostile search-path tests already passing; adding a configuration clause would disable its reviewed inlining optimization. Leaked-password protection is still reported disabled; no paid plan or account setting was changed.
- Sentry issues were triaged but not marked resolved on the strength of local tests. Post-deploy observation, genuine Google-authored authorization mail, device OS flows and platform review remain open.

## Approved production follow-up — September 16 22:55 UTC

- User explicitly approved continuing the previously presented production bundle and synthetic OpenAI test. Atomic production migration `20260916225211_reviewed_marketplace_feedback_atomic_20260916` succeeded. This one remote version maps to all ten checksum-pinned source migrations in the release bundle; install SHA256 `1e16901ef7fe37cdb675453cbf28c17846b55913a5aa46ec087c5330fd760e64`. Counts remain 14 items / 18 profiles / 14 cached items. The chat bucket is private; hidden choices and translation jobs have RLS.
- Ordinary anonymous HTTP checks passed after migration: old implicit item/profile embedding 200, indexed search 200, public seller nickname finds their listing 200, hidden choices return no rows, and claiming translation jobs is denied 401/42501. No real user row was changed by these probes.
- Real OpenAI response at 22:51:38 UTC passed through the application translator using only the expressly approved fictional desk title/description. English preserved the scratch, width 120 cm and price 25 dollars. Earlier locally saved environment files had empty values; this was not evidence that the online configuration was absent. Receipt: ignored `output/feedback-20260916/approved-provider-receipt.json`.
- Enabled production `LISTING_ENGLISH_AUTOTRANSLATE=1` after the successful canary, for the next deployment. Current production code has not yet switched to the candidate. One public listing is queued. Worker and visible English completion remain to verify after deploy.
- PR first full public sweep: 397 passed / 1 skipped / 1 failed. The failed focus screenshot cropped the inner native editor and excluded its new rounded outer focus surface. Expanded to the actual painted surface; all three field-paint cases passed. No focus accessibility requirement was removed.
- Fresh Sentry issue 11 event 1a506c44, release 281799c, explicitly originates in `onVisibilityChange` → deliberate recovery takeover. Split expected resume/offline recovery into sanitized diagnostic breadcrumbs; actual primary subscription failure retains the warning and surface attribution. Runtime tests verify both recovery and real-failure paths.
- Admin portal remains locked; user handoff requested in the already-open page. No token was minted and no announcement has been posted.
