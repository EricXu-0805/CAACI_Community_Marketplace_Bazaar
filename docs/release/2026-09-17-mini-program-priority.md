# Mini-program release and account continuity

2026-09-17. User priority: ship the mini program promptly; native iOS/Android can wait. Website and WeChat must preserve the same marketplace identity. Social-channel entry links are a separate task from account ownership and data merging.

## Current release work

- Repair the confirmed link-page lifecycle bugs: return to the originally requested task, ignore old failures after page hide/return, and never redirect a later account using an earlier sign-in result.
- Make the existing-account route prominent before the mini-program email form. Google-only website users should link their existing account instead of creating a second one; email users can use the same credentials directly.
- Distinguish a deliberate disabled capability from a network/configuration failure. The latter gets an explicit retry, rather than silently removing the sign-in method.
- Bound the website session lookup so generating a link code cannot leave the page busy indefinitely.
- Bound the mini-program moderation prerequisites too: a stalled session lookup fails after 10 seconds, and a missing `wx.login` callback settles after 15 seconds. Late results cannot submit another check or cross accounts. Only the server's already trusted identity binding can cover an absent fresh code; unbound accounts still fail closed.
- Build both targets, verify the mini-program artifact and official WXSS compilation, and preserve clear separation between automated tests and a real WeChat-account run.

## Live findings, September 17

- The developer-tool project imported directly from `app/dist/build/mp-weixin` had stale project identity (undefined project name and missing AppID in its window). Importing the repository root with its existing `project.config.json` restored the correct AppID, project name and simulator. The same developer session then reached the upload service without another sign-in. The earlier expired-login observation is superseded by the successful upload below.
- Production database read-only inventory: one legacy WeChat password-map row, one bound profile and one placeholder Auth account. The password-retirement migration is not in the live migration ledger. No password, identity or row was printed or changed. Do not enable login before the corresponding old-account recovery/retirement path is established.
- Production linking foundation is present under remote migration `20260917044349 / reviewed_wechat_link_foundation_disabled`; do not apply the local migration again.
- Production environment-name inventory (values were not exported): `WECHAT_APPID` and `WECHAT_PUSH_TOKEN` exist. `WECHAT_APPSECRET`, `WECHAT_ENCODING_AES_KEY`, `WECHAT_LOGIN_ENABLED`, `WECHAT_ACCOUNT_LINK_ENABLED`, `WECHAT_LINK_RETENTION_ENABLED` and `WECHAT_MEDIA_ASYNC_ENABLED` are absent. An existing variable name is not proof that its value or provider connection is valid. Keep the capability gates closed until the full activation sequence is accepted.

## September 17 validation update

Account continuity and community entry changes were merged by PR #345 into main `b12c9ed6fe09f04fe004d3de0275ee34d4a0140c`; all six main CI jobs succeeded (run 35265369999), including the protected staging account's photo-listing write path. The PR public-page sweep passed 432 tests with one skipped. These are browser/build/database checks, not real WeChat sign-in evidence.

The candidate package is in `output/mini-release-20260917/`. PR #346 merged the optional bilingual email-domain suggestion into main `310ecbc8fdee90a5daafd04f420d442c9fd4c6e3`. The earlier `411d29a` package had 341 emitted files, 1,908,784 raw bytes, 29 pages and official WXSS compilation 52/52 passed, but the actual WeChat upload rejected version 1.0.9171 with error 80051: source size 2137 KB exceeds 2 MB. A locally passing size check was insufficient.

The build now removes an explicit list of seven web/PWA or unused example assets from generated WeChat output only. Source files, runtime logos, empty-state art and onboarding art remain; H5 keeps its resources. The package has 334 files and 1,634,722 raw bytes (274,062 fewer). The verifier now reserves compiler headroom with a 1.6 MiB source budget in addition to the platform's 2 MiB limit.

**Actual upload receipt:** WeChat Devtools RC 2.02.2607161, AppID `wxc3da81aa8852a6ff`, version **1.0.9172**, September 17 around 15:13 Chicago, displayed **代码上传成功**. This was the candidate based on main `310ecbc` plus this build-only size fix. Domain validation remained on. This is a development-version upload, not an experience-version assignment, successful login test, review submission or public release. The tool still recommends reducing the main package below 1.5 MB and enabling lazy loading; those advisory performance items are not marked complete.

## Remaining activation sequence

1. The correct AppID and actual developer upload are verified. Still verify release eligibility, server domains and platform privacy configuration in the real management console. Historical console site restrictions must not be bypassed.
2. Finish legacy credential retirement with the supported Auth administration path, rehearsed with a disposable identity first. Preserve a working replacement login/recovery route for the one existing account.
3. Publish the reviewed optional-WeChat/account-linking privacy disclosure with the corresponding consent version, before opening the feature. Prepare and verify provider credentials, encrypted safety callback and environment flags. Never put secrets into the package.
4. Have an authorized administrator assign uploaded version 1.0.9172 (or a later validated candidate) as the experience version. Test real `wx.login`, existing email and Google-only account linking, the original user ID and content, wrong/expired code, collision, cancellation, replay, retry after a lost confirmation response, and account switch.
5. Test publishing with photos, private conversation and moderation, permission rejection/recovery, and real-device background/input behavior. Private chat media remains unavailable in the mini program until its private WeChat moderation path is implemented and accepted; H5 media tests do not close that gap.
6. Submit review with actual screenshots, accurate capability descriptions and a reviewed test path. Record the platform result; a locally built package is not a published mini program.

Native App signing/store work is deferred per the user's current instruction. Do not merge pre-existing accounts with content based only on email text, nickname or a client-supplied WeChat identifier.

## Sources

[uni-app privacy integration](https://uniapp.dcloud.io/tutorial/mp-weixin-user-privacy.html) describes the native privacy authorization mechanism; a manifest flag alone is not a console-configuration receipt. [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking) applies to supported identities; the custom WeChat flow continues to use its own server-verified mapping and GoTrue-issued session. Current docs checked September 17.
