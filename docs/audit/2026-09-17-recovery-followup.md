# Recovery follow-up — 2026-09-17

Baseline: main `dac145e`. User reports remaining friction after the first mobile recovery release and authorizes continued technical iteration. Social publication is separately pending; the weekend reminder does not imply publication.

## Plan and acceptance

1. Reproduce delayed browser permission, cancellation/manual selection and stalled location authentication. Keep native permission requests in the original user gesture; no fabricated verification and no coordinates sent after cancellation.
2. Reproduce remaining draft exit/recovery problems, including returning to an unchanged saved draft and interruption while a dialog is open. Preserve account boundaries and explicitly describe non-durable fallback.
3. Independently audit media refresh and preview, retaining private storage and short-lived participant-bound URLs.
4. Run targeted failures before fixes, then related browser checks across phone/tablet/desktop, deterministic contracts, types and both builds. Release through protected CI and verify the deployed revision.

## Status

- Weekend reminder created for September 19 at 10:00 America/Chicago, once. It checks actual publishing status before prompting social-channel consolidation.
- Fixed and locally verified: the application's 15-second device watchdog included time spent in a native permission prompt. The browser's own timeout excludes permission waiting ([W3C](https://www.w3.org/TR/geolocation/#timeout-member)). Native acquisition still has a 15-second timeout; the application's separate safety deadline allows 60 seconds for the combined permission/device phase. Cancellation and manual edits release the loading state immediately, abort address requests and suppress late coordinates. Session acquisition is bounded at three seconds, after which ordinary unverified address autofill can still work.
- Two new location regressions failed before the fix; the focused deterministic suite now passes 20 tests. Fourteen related browser cases passed, including cancellation in new/edit forms and phone/tablet/desktop widths. Native permission outcomes in these tests are synthetic.
- Fixed photo preview renewal: known network/5xx failures retain the existing thumbnail and show retry feedback. Preview opens only with a newly validated URL; denial, invalid responses and account transition still clear access. Successful renewal also avoids replacing the thumbnail's source. Baseline 503 reproduction failed; the media suite passed 14 WebKit and eight targeted Chromium cases with synthetic responses.
- Independent review found no actionable race in the location diff and separately checked cancellation/account transition during session wait, a late session after fallback, and an old owner's cancellation after a newer request.
- Draft fix verified: a pending Save callback was invalidated by same-page background/resume. A separate decision identity now retains that decision during backgrounding and invalidates it on departure, account change or form replacement. Destinations are captured per decision so a stale callback cannot consume a newer dialog's navigation. Three baseline failures became passing checks; six draft browser journeys and 62 associated boundary checks passed. Existing Save/Drop behavior, including unchanged restored drafts, is preserved.
- Physical iPhone OS prompts and keyboard acceptance remain distinct from simulated browser coverage.
