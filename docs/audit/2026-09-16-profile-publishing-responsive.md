# Seller messaging, contextual publishing and responsive navigation

Baseline: `8b930d3`, branch `codex/main-release-followup-20260906`. User supplied nine screenshots on 2026-09-15. This is implementation work, not a claim that all platform release gates are complete.

## Plan and acceptance

- [x] Seller profile: follow and message actions side by side; a conversation can start without a listing; self/blocked/suspended/unauthenticated paths handled; concurrent attempts reuse the same direct conversation. Existing listing conversations remain intact.
- [x] Marketplace: persistent publish action beside sale/wanted modes in every category; carry type and category into the composer, including cached-tab and login transitions; preserve unrelated drafts deliberately.
- [x] Plaza composer: visible photo action label, aligned toolbar, usable desktop dialog and phone sheet.
- [x] Responsive shell: consistent navigation and available-width content on secondary/deeper routes; seller, listing detail, settings, notifications, profile edit, saved lists and posts; desktop/tablet layouts with bounded reading widths rather than a phone-width outer canvas.
- [x] Verify real rendered local browser journeys with synthetic data at phone, iPad and Mac widths; security/DB regression for new direct messaging; type check and both platform builds; inspect affected existing tests.
- [x] Review final diff, publish only a verified compatible change within current authorization, and record exact deployment/migration evidence or remaining external gates.

## Evidence and decisions

- Existing repository has an untracked `.claude/` directory; leave it untouched.
- An older release Goal remains blocked on unrelated release gates; this plan tracks the current concrete request without marking those gates complete.
- No real users will receive test messages and no production listing will be created during UI testing.

## Results

The four requested changes are implemented. The former 480px secondary-page
outer shells now keep the shared sidebar and a bounded, centred content area.
The seller profile uses two columns on wide screens; tablets stack it. Photos
and calls to action on listing details use matching symmetric gutters.

Completed verification:
- 73 browser cases: new profile/publishing/deep-route coverage in Chromium,
  plus existing publishing/photo/draft and Plaza suites in WebKit. All passed.
- 32 WebKit cases: the new flows plus listing galleries, detail actions and
  inbox/chat at six viewport sizes. All passed.
- 2 additional WebKit cases: explicitly retaining an existing draft and
  anonymous category publishing redirecting to login. Both passed.
- New suite renders 13 secondary routes at 390x844, 820x1180, 1180x820 and
  1920x1080 in light and dark themes; also shrinks the visual viewport to
  check the composer toolbar above a simulated software keyboard.
- Real local PostgreSQL migration/regression covers RLS, self/forged/third-party
  writes, bilateral blocks, active/expired suspensions, private column ACL,
  immutability, ten-start-per-minute limiting, concurrent reverse-pair inserts
  and old listing/deleted-listing threads remaining distinct.
- OAuth return contract preserves public sale/wanted/category enums across a
  fresh module/session-storage round trip; invalid/unowned returns fail closed.

Database rollout (before frontend):
- Source: `20260916050227_direct_profile_conversations.sql`; manifest verified.
- Staging `hygkwxugskijadgfisji`: ledger `20260916052318`.
- Hosted staging rollback-only probe passed the full schema's message triggers,
  participant RLS, reverse-pair uniqueness and bilateral blocking. Afterward:
  zero synthetic users, zero direct conversations; original three threads remain.
- Production `lfhvgprfphyfvhidegum`: ledger `20260916052701`.
- Both guard bodies have MD5 `8feb985943e203fb4a9b1f6f5bf6a506`.
- Production read-only verification: RLS true, three existing policies, both
  new indexes, authenticated SELECT/INSERT on is_direct only, no anonymous
  SELECT and no authenticated trigger execution. No production test chat sent.
- Migration is additive. A frontend rollback can leave the added column/indexes
  in place; never delete direct conversations to roll back the UI.

Security advisors after DDL retained the existing private/server-only RLS
notices and intentionally exposed authenticated definer RPC notices. The new
chat trigger is not callable. The report is not a claim that every historical
advisor finding or platform release gate is resolved. Remediation references:
[private-table RLS notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
and [authenticated definer RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Local screenshots and test logs are in `output/ui-followup-20260916/` (ignored
artifacts). Phone/tablet tests simulate viewport/keyboard geometry; they do not
certify physical-device keyboards, native album pickers or app-store review.
The full pre-push gate passed: boundary tests, TypeScript, H5 build and artifact
validation, and mp-weixin build and artifact validation. Frontend rollout is
tracked by the matching Git commit and Vercel deployment receipt in the dated
state log; a READY deployment is not physical-device acceptance.


## Frontend receipt and CI follow-up

- Implementation commit `59e452b86eeb9ffe0063c00b7bad8687e6cabfab` was pushed
  to main after the complete local pre-push gate passed.
- Vercel production `dpl_FqR6PDB1ZP2rd7SZppvD9a7NJTQc` is READY and aliases
  include `illinimarket.com` and `www.illinimarket.com`, with the exact same SHA.
- GitHub run `35060011322` passed Type-check, H5/compiled acceptance and
  mp-weixin. Its boundary job caught an older search-test timing race: a
  200ms active suspension expired before the pre-expiry assertion on a busy
  runner. The failure was in the libc search regression, not the new direct
  conversation test. This follow-up keeps fixture setup and the active read in
  one outer statement with a fixed statement_timestamp, then reads the same
  prepared plan after natural expiry without an intervening fixture write.
  libc and ICU database tests both pass locally; the six expected permission
  outcomes are unchanged. No production search function or migration changed.
- Subsequent CI/deployment receipts are saved in `output/ui-followup-20260916/`
  and the September 16 state log. Do not reinterpret an older failed run as green.
