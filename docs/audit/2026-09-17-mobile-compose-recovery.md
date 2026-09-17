# Mobile composer, draft and location recovery — 2026-09-17

Baseline: main `1ac85fe`. This round follows the user's two iPhone screenshots and clarification: the empty chat input must match More/Send height with **no red frame**; images flash; Save can trap navigation; location should request the browser's native permission and visibly resolve.

## Changes and evidence

- Chat composer: uni-textarea's inner wrapper inherited the outer 44px minimum, then outer padding added 22px. Override the inner content minimum to one 22px line; More, the empty input and Send are all 44px. Multiline input still grows within a cap. Remove input focus outlines and compound-field inset red rings. Button/link keyboard focus remains, text fields retain their caret.
- Chat media: a watch getter returned a fresh array whenever polling replaced a message object. It cleared the signed URL and remounted the media on unchanged snapshots. Watch individual media identity values instead. Three successive authoritative refreshes/read-state changes preserve the same image DOM node and do not request new signatures. Photo upload/retry and video playback remain covered. The private bucket, participant-bound path checks, account invalidation and 60-second signed URL lifetime are unchanged.
- Drafts: Save now retains a copied account-bound draft in the mounted page when durable storage rejects writes, leaves once, and accurately says the fallback lasts only for this visit. Normal durable save/reload restores latest edits. Account transitions and unmount clear the fallback. Drop suppresses the saved snapshot within the visit. Duplicate leave prompts are prevented, discard resets the current form, and an untouched category/sell/wanted prefill no longer counts as an edit.
- Location: call native browser geolocation in the original click task, without awaiting optional Permissions API introspection. Show separate waiting-for-location and street-lookup states. New and edit listing share one labelled picker with manual entry, campus spots, OSM attribution and clear manual/device/street-checked status. A late result cannot overwrite manual edits. Keep the authenticated page token stable across an unchanged-account resume. Denied access explains the current browser; the help dialog restores focus to the location control, including Chrome's focus-loss path.
- Publishing: solid responsive header, bounded desktop form, softer grouped surface, persistent field labels, concise example placeholders and a restrained entrance transition respecting reduced motion. No changes to listing validation, payments or moderation policy.

## Validation

Three targeted regressions **failed on the original code**: extra composer height, photo node replaced after refresh, and Save stuck with rejected draft writes. They pass with the fixes.

The WebKit-focused related browser run passed 112 cases spanning publishing/media, lost network responses, drafts, categories, location, history, seller routes and responsive layouts. Chrome passed the seven initial core checks; its permission-help focus regression was then fixed and independently passed. Three text-field caret/no-outline checks passed for Search/Login/Plaza. Final header/location screenshot pass: 3/3.

The full deterministic suite initially hit local sandbox port/shared-memory limitations. Only 11 unused IPC segments created by that failed run were reclaimed after checking ownership, zero attachments and exited creator PIDs; old resources were untouched. With the isolated environment restored, SQL/security tests passed; four source-location assertions needed updating for the extracted component and one unsupported mini-program selector was corrected. All 38 affected component/accessibility/attribution contracts then passed. The final pre-push hook reruns the complete suite, type-check and both H5/mp-weixin builds; its outcome is recorded with the release receipt.

A live anonymous GET to the canonical production `/api/geocode` endpoint returned HTTP 200 and `East Green Street, Champaign` for the public test coordinates 40.110/-88.230. This confirms address lookup availability, not a physical device fix or authenticated street receipt.

## Boundaries

Browser tests use isolated synthetic accounts and intercepted data; no test message was sent to MMT or any real user. Screenshots under `output/feedback-20260917/` are browser fixtures, not physical-device evidence. Browser permission UI and OS-level denial cannot be simulated as physical iPhone acceptance; the site cannot force a new Allow prompt after a previous denial. A storage-restricted visit-only draft is not durable across reload/close. The street check remains an approximate device-assisted area check, not residence, identity or presence certification. Mini-program publication and its platform permissions retain their existing separate gates.

Reference: [Supabase signed URLs](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl). API duration and private access semantics were checked against current documentation; no storage policy changes were made.
