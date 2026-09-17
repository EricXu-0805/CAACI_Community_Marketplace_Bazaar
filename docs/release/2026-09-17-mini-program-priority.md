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

- WeChat Devtools RC 2.02.2607161 is open on this project's `app/dist/build/mp-weixin`, but its login has expired and the simulator reports that it needs login again. The owner has been asked to scan its login QR. No upload, experience version, review or publication is claimed.
- Production database read-only inventory: one legacy WeChat password-map row, one bound profile and one placeholder Auth account. The password-retirement migration is not in the live migration ledger. No password, identity or row was printed or changed. Do not enable login before the corresponding old-account recovery/retirement path is established.
- Production linking foundation is present under remote migration `20260917044349 / reviewed_wechat_link_foundation_disabled`; do not apply the local migration again.
- The existing local environment snapshot does not provide an AppSecret or usable message-push token. This snapshot is not proof of the current hosted environment's complete configuration; verify in the account's approved backend before enabling anything.

## Remaining activation sequence

1. Restore developer login; verify the selected AppID `wxc3da81aa8852a6ff`, the account's release eligibility, server domains and platform privacy configuration in the real console. Historical console site restrictions must not be bypassed.
2. Finish legacy credential retirement with the supported Auth administration path, rehearsed with a disposable identity first. Preserve a working replacement login/recovery route for the one existing account.
3. Publish the reviewed optional-WeChat/account-linking privacy disclosure with the corresponding consent version, before opening the feature. Prepare and verify provider credentials, encrypted safety callback and environment flags. Never put secrets into the package.
4. Upload a versioned experience package. Test real `wx.login`, existing email and Google-only account linking, the original user ID and content, wrong/expired code, collision, cancellation, replay, retry after a lost confirmation response, and account switch.
5. Test publishing with photos, private conversation and moderation, permission rejection/recovery, and real-device background/input behavior. Private chat media remains unavailable in the mini program until its private WeChat moderation path is implemented and accepted; H5 media tests do not close that gap.
6. Submit review with actual screenshots, accurate capability descriptions and a reviewed test path. Record the platform result; a locally built package is not a published mini program.

Native App signing/store work is deferred per the user's current instruction. Do not merge pre-existing accounts with content based only on email text, nickname or a client-supplied WeChat identifier.

## Sources

[uni-app privacy integration](https://uniapp.dcloud.io/tutorial/mp-weixin-user-privacy.html) describes the native privacy authorization mechanism; a manifest flag alone is not a console-configuration receipt. [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking) applies to supported identities; the custom WeChat flow continues to use its own server-verified mapping and GoTrue-issued session. Current docs checked September 17.
