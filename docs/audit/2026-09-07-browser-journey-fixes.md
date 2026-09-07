# Browser-led marketplace and chat fixes — 2026-09-07

Baseline: `da5cf9743512d44402069f8c251a7aaa13b6476e`. The user canceled the backup restore exercise and requested testing the existing product through browser operations, tracing problems into code, and fixing them. The earlier authorization to push verified fixes to main remains in effect.

## Reproductions and changes

| User operation / evidence | Problem | Change |
| --- | --- | --- |
| Existing synthetic staging chat: type a draft in the desktop inbox, narrow to phone width, reopen the same conversation | Composer remount discarded unsent text | Keep conversation drafts and reply context in tab memory. Restore only after conversation access and block checks. Clear on all account transitions; no persistent chat-text storage. |
| Browser physical keyboard: type a line, press Shift+Enter | The framework's confirm handler sent the message, while normalized keyboard events lost modifier/IME flags | H5 uses return mode and a native keyboard listener; ordinary Enter sends once, modified Enter and IME confirmation retain editing behavior. Mini-program keeps its native send confirmation. |
| Controlled browser regression: newline, rapid last edit, Enter | Throttled input events could refill the composer with sent text | Read live input changes, clear native and component state together, and ignore stale event payloads. |
| Controlled browser regression: hold moderation response, begin next draft, return a rejection | Rejected text recovery could replace newer writing or remove the only copy of rejected text | Preserve the next draft and retain the failed bubble for copying. An empty composer still receives the rejected text for editing. |
| Existing staging publish form: save a draft, change title/price, navigate away or refresh, restore | Latest edits were lost; old title and price returned | Save current authorized draft on page hide, backgrounding and teardown. Explicit discard and successful publication still clear the draft. Failed manual saves keep the form open. |
| Browser fixture: attach a photo, reload, restore | Document-scoped photo blob URLs expired and produced broken thumbnails | Restore current-document blobs only; explain when photos must be reattached after reopening. Text and structured listing details survive. |

Production public browsing also checked filter validation/cancellation and detail photo navigation. These checks did not establish a production incident. All signed-in manual work used the existing synthetic staging account; browser regression writes were intercepted and used synthetic data.

## Verification

- WebKit/light: **52 passed** across marketplace responsiveness and publishing/discovery suites.
- Chromium/dark: **52 passed** across the same suites.
- Coverage includes Mac 1440/1280 widths, iPad 820/1180 orientations, phone 390/360 widths, photo navigation, reachable chat/actions, publishing preview, housing/rideshare fields, and draft regressions.
- Selected account/lifecycle tests: **24 passed**, including two new executable tests for draft privacy and blob lifetime.
- Manual browser replay restored the latest title and `$650` price after immediate reload. Staging layout and screenshot evidence is local in `output/user-journey-20260907/`.
- Full pre-push checks, exact main SHA, CI and deployment results are recorded separately in the local release receipt when they finish.

## Evidence limits

Viewport and keyboard simulations do not establish physical iPhone/iPad soft-keyboard or IME behavior. Local staging's frontend-only server has no moderation API, so successful network sends were verified in the isolated browser fixtures rather than claimed from that server. Chat drafts intentionally survive navigation/layout changes only within the current tab lifetime; refreshed publishing photo attachments require reattachment. This patch does not constitute a new capacity, backup or complete public-launch certification.
