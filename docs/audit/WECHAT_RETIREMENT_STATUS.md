# WeChat Password Retirement — Completion Status

> Status: **INCOMPLETE, parked.** Deferred to the December WeChat-activation
> window (Eric, 2026-07-24). All work lives on branch
> `wip/wechat-password-retirement`. The `api/auth/delete-account.js` legacy
> fallback was split out and shipped to `main` separately.

## Why this is parked, not urgent

WeChat login is disabled in production (`WECHAT_APPSECRET` absent), and only
~1 legacy `wechat_password_map` row remains. Rotating that user's synthetic
password while WeChat login is off doesn't worsen their access (they already
can't log in until WeChat is re-enabled), and the attack surface is dormant.
So this is best done alongside the Dec WeChat activation, when the passwordless
route is live and that user can sign back in.

## What is verified safe (independent review, 2026-07-24)

`scripts/retire-wechat-passwords.mjs` (the armed rotate+delete script) is
correct: three-set identity reconciliation (map rows ∪ WeChat-bound profiles ∪
`wx_<openid>@wechat.placeholder` Auth users), orphan-stop **before any
mutation**, rotate-before-delete, re-inventory churn fail-closed after both
rotation and delete, `--expected-inventory-sha256` guard, keyset pagination
with exact `Content-Range`/`x-total-count` (no silent truncation), no secret
logging, and `assertSafePrivilegedNetworkEnvironment` (rejects TLS-bypass env).

## What is DISARMED and must be completed (all fail-closed)

1. **Stale manifest** — `supabase/migrations/manifest.sha256` has 132 entries;
   the directory has 133 files. Missing entry:
   `20260722194923_converge_wechat_retirement_rpc_only.sql`. Regenerate to 133.
   (This mismatch is why the 9 migration-boundary tests fail on the WIP branch.)
2. **Converger receipt pins** —
   `20260722194923_converge_wechat_retirement_rpc_only.sql:627-629` requires the
   real retirement-receipt `(count,digest)` tuples; the placeholders
   `(0,'PENDING_CANONICAL_RETIREMENT_RECEIPT')` /
   `(0,'PENDING_HARDENED_RETIREMENT_RECEIPT')` can never match (a real applied
   receipt has 19 statements, count≠0).
3. **Executor pins** — `scripts/wechat-retirement-migration-executor.mjs`:
   `EXPECTED_GUARDED_EXECUTION_DIGEST` (:51),
   `EXPECTED_CONVERGENCE_MIGRATION_DIGEST` (:53),
   `EXPECTED_MANIFEST_DIGEST` (:55),
   `EXPECTED_EXECUTION_SET_DIGEST` (:140),
   `PINNED_PRODUCTION_CA_FINGERPRINT256` (:157, empty).
4. **Rehearsal pins** — `scripts/wechat-retirement-postgres-rehearsal.mjs`:
   `REVIEWED_PG17_DIGESTS` (:44-49, all empty).

## Operator inputs required (Dec)

- Passwordless WeChat route live + verified on prod; old fleet drained; freeze
  account create/delete + WeChat binding for the window.
- Short-lived named `sb_secret_...` key in `SUPABASE_SECRET_KEY` (NOT the Vercel
  runtime key, NOT the DB password); `SUPABASE_URL=https://lfhvgprfphyfvhidegum.supabase.co`.
- `SUPABASE_DB_PASSWORD` (operator shell only) + `SUPABASE_DB_SSLROOTCERT`
  (absolute path, single cert, non-group/world-writable) from the CA downloaded
  via the authenticated Supabase dashboard.
- Pinned Supabase CLI 2.95.4 (`/opt/homebrew/Cellar/supabase/2.95.4/bin/supabase`,
  sha256 `6d0f911f…5020c8`).

## Order of execution (from RUNBOOK "2026-07 candidate release sequence" step 6)

- **A. Rotate + delete map rows** (script is ready now):
  `node scripts/retire-wechat-passwords.mjs --project-ref lfhvgprfphyfvhidegum`
  (dry run, record `Inventory SHA-256`), then `--apply --confirm
  RETIRE_WECHAT_PASSWORDS --expected-inventory-sha256 <sha>`.
- **B. Arm the migration tooling** — fill the pins above (regenerate manifest;
  paste real receipt tuples; recompute the digests; set the CA fingerprint;
  set the PG17 rehearsal digests).
- **C. Rehearse → executor dry-run → apply**:
  `node scripts/wechat-retirement-postgres-rehearsal.mjs --confirm
  LOCAL_DISPOSABLE_POSTGRES_ONLY`; then executor dry-run (baseline must list
  BOTH `20260718140000` and `20260722194923`); then apply with the **current
  code phrases** — `--apply --confirm
  APPLY_WECHAT_RETIREMENT_CONVERGENCE_20260722194923 --confirm-privileged-freeze
  PRIVILEGED_DDL_ACL_FREEZE_ACTIVE`.
- **D. VERIFY**, revoke the operation-specific `sb_secret` key, then ship
  removal of the temporary direct-table fallback in `api/auth/delete-account.js`
  (post-migration the SECURITY DEFINER RPC is the only path).
