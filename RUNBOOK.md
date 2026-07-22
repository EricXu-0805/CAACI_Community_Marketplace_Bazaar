# RUNBOOK

Operational procedures for production. Each section is a self-contained
recipe that should work on a 3 a.m. wake-up with no context except this
file. If you're adding a new procedure, optimize for the
"phone-screen-while-half-asleep" reader: copy-paste-able commands,
explicit pre-conditions, an "if it goes wrong" exit.

> **Start here:** [TL;DR](#tldr) → [Common emergencies](#common-emergencies)
>
> Detailed procedures below are alphabetical by topic, not by frequency.

## TL;DR

| When this happens | Jump to |
|---|---|
| Sentry fired an error alert | [Sentry alert response](#sentry-alert-response) |
| Admin left / token might be leaked | [Admin token revocation](#admin-token-revoke) |
| Production is down | [Deploy rollback](#deploy-rollback) |
| Suspect DB corruption | [Backup & restore](#backup--restore) |
| `/api/data-retention` cron returns 503 | [Ephemeral data retention](#ephemeral-data-retention) |
| Privileged Supabase key leaked | [Privileged key incident / rotation](#privileged-supabase-key-incident--rotation) |
| New admin needs access | [Admin token mint](#admin-token-mint) |
| Need to ship a hotfix to prod fast | [Hotfix deploy](#hotfix-deploy) |

## Common emergencies

### Production is down (5xx everywhere)

1. **Vercel** → Deployments → check status of latest production deploy.
   - If "Failed" → see [Deploy rollback](#deploy-rollback).
   - If "Ready" but site dead → check [Sentry](https://sentry.io) for a flood of errors,
     and **Supabase Dashboard → Health** for DB outage / connection pool exhaustion.
2. **Vercel** → Functions → look for spikes in 5xx on `/api/admin`, `/api/share`, `/api/translate`.
3. **Supabase** → SQL Editor → `SELECT now() - pg_postmaster_start_time();` (sanity check
   the DB responds at all).
4. If still unclear, redeploy known-good: Vercel → pick a green deploy from 24h ago →
   "Promote to Production".

### A specific user reports their account is broken

1. Get their email or `profiles.id`.
2. SQL Editor:
   ```sql
   SELECT
     u.id,
     u.email,
     p.nickname,
     p.suspension_level,
     p.suspended_until,
     p.shadow_banned,
     p.warning_count,
     u.created_at
   FROM auth.users AS u
   JOIN public.profiles AS p ON p.id = u.id
   WHERE lower(u.email) = lower('their@email');
   ```
3. Check `admin_audit_log` for any recent admin actions on this user.
4. If suspended in error → Admin dashboard → Suspensions → "Lift suspension" with reason.

## Admin token mint

> When: a new admin needs dashboard access, or an existing admin lost their token.
> Who can run: an approved operator who already holds an **owner** token for
> the exact target deployment. The regular CLI never accepts a Supabase secret
> or service-role key and cannot bootstrap the first owner.

```bash
export ADMIN_API_ORIGIN=https://staging.example.edu
export ADMIN_TOKEN="<existing-owner-token-from-approved-vault>"
ADMIN_PROFILE_ID="<independently-verified-public.profiles-id-uuid>"

# Dry-run: validates caller + local inputs; it does not generate a credential.
# Use an approved staging case first.
node scripts/admin-token-mint.mjs \
  --admin-id "$ADMIN_PROFILE_ID" \
  --role operator \
  --expires-days 90 \
  --case-id "SEC-2026-001" \
  --approval-ref "change-1234"

# Apply only after reviewing the dry-run and approval. The absolute output
# path must be on an encrypted, access-controlled operator device.
node scripts/admin-token-mint.mjs \
  --admin-id "$ADMIN_PROFILE_ID" \
  --role operator \
  --expires-days 90 \
  --case-id "SEC-2026-001" \
  --approval-ref "change-1234" \
  --output-file /absolute/private/path/admin-token-recovery.json \
  --apply
```

The default role is the least-privileged moderation `operator`; expiry defaults
to 90 days. Operator/security-admin accept 1–365 whole days; owner accepts
2–365, and the database independently requires more than 24 hours of remaining
recovery life. The API, not the CLI,
derives the immutable name/email snapshot from the authoritative
`public.profiles` row selected by `--admin-id`. `--name` and `--email` are
rejected. A privileged role must be repeated explicitly:

```bash
node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role security_admin --confirm-privileged-role security_admin --expires-days 90 --case-id "SEC-2026-002" --approval-ref "change-1235" --output-file /absolute/private/path/security-admin-recovery.json --apply
node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role owner --confirm-privileged-role owner --expires-days 90 --case-id "SEC-2026-003" --approval-ref "change-1236" --output-file /absolute/private/path/owner-recovery.json --apply
```

Maintain two verified owner tokens with overlapping validity. Recovery health
counts only tokens whose attached profile remains active, which have completed
at least one successful authorization (`last_used_at` is set), and which have no
expiry or at least 24 hours remaining. The admin Tokens tab separates
unverified and near-expiry owners; neither counts as recovery-capable. Verify
the replacement in a separate session against the exact deployment before
revoking or allowing the previous owner token to expire.

`--admin-id` is required: the tool rejects a malformed UUID and verifies the
exact `public.profiles` row server-side before writing. Confirm the operator
identity and profile ID over an independent trusted channel; never infer them
from a mutable display name or email alone. Every apply requires a case ID,
approval reference, and one idempotency key. The lifecycle write, actor
attribution, identity snapshot, case metadata, result, and required audit row
commit atomically through `/api/admin`.

The CLI never writes plaintext to stdout. `--output-file` must be an absolute,
non-existing path; it is created as a mode-`0600` JSON recovery manifest that
contains the credential **and** immutable request/idempotency fields, so treat
the whole file as a secret. It is file- and directory-synced before dispatch.
A definitive non-conflict rejection removes it; a 409, transport/5xx, or
otherwise unknown outcome retains it after one automatic identical retry.
Do not generate another token or key; resume the exact operation with:

```bash
node scripts/admin-token-mint.mjs \
  --resume-file /absolute/private/path/admin-token-recovery.json \
  --apply
```

Do not add identity/role/case/expiry flags on resume: the manifest owns the
immutable request. Resume also requires the exact original owner `ADMIN_TOKEN`
because the database idempotency ledger is scoped to that actor token; a
replacement owner token fails closed and leaves the manifest intact. After a
confirmed success, import its token into the
approved vault and securely remove the local manifest.

The token starts with `iam_admin_`, but that prefix is **not** an automatic
GitHub secret-scanning guarantee. Configure a custom secret pattern for
`iam_admin_[A-Za-z0-9_-]{43}`, verify that scanning and push protection are
enabled for this repository, and test the rule with a synthetic value. The
admin pastes the real token into the dashboard unlock prompt. The
release-candidate dashboard keeps it only in page memory: refresh, navigation,
closing the tab, or sign-out clears it.

The dashboard may durably retain only an opaque write receipt (intent hash,
UUID idempotency key, timestamps). A 2xx receipt is consumed only after the UI
or an authoritative GET has applied it. A crash, refresh failure, or uncertain
transport preserves the receipt and locks unrelated writes. Re-enter a verified
owner token to perform the recovery panel's read-only reconciliation GET; an
operator cannot bypass the barrier and recovery never issues a new POST.

Staging and production are separate approval scopes. Rehearse with a staging
caller/token, staging case, staging origin, and disposable target first. A
production apply requires the production change approval, verified production
origin and caller, target/role/expiry review, and an independent second reviewer
for privileged issuance. If no valid owner token exists, stop: initial bootstrap
is a separately controlled external break-glass procedure. Do not turn the
regular CLI into a service-key/direct-SQL bypass.

## Admin token revoke

> When: an admin left the team, lost their device, or their token might
> be leaked. Revocation is a terminal lifecycle action; mint a new token through
> an approved case if the administrator later needs access again.
> Who can run: an approved security-admin or owner holding a valid token for
> the exact target deployment. The CLI uses only the audited `/api/admin`
> boundary; it never accepts a Supabase secret/service-role key.

```bash
export ADMIN_API_ORIGIN=https://staging.example.edu
export ADMIN_TOKEN="<existing-security-admin-or-owner-token-from-approved-vault>"
TOKEN_ID="<exact-token-row-uuid-from-inventory>"
ADMIN_PROFILE_ID="<reviewed-authoritative-profiles-uuid>"
REVOCATION_IDEMPOTENCY_KEY="<new-v4-uuid-recorded-in-approved-case>"

# 1. Inventory: see who has active tokens
node scripts/admin-token-revoke.mjs --list

# 2. Full lifecycle inventory: active, expired, and revoked are distinct
node scripts/admin-token-revoke.mjs --list --show-inactive

# 3. Email is a cached snapshot and is dry-run discovery only
node scripts/admin-token-revoke.mjs --email operator@example.edu

# 4a. Revoke one exact token row after dry-run/review
node scripts/admin-token-revoke.mjs --id "$TOKEN_ID" --case-id "SEC-2026-010" --approval-ref "change-1250"
node scripts/admin-token-revoke.mjs --id "$TOKEN_ID" --case-id "SEC-2026-010" --approval-ref "change-1250" --idempotency-key "$REVOCATION_IDEMPOTENCY_KEY" --apply

# 4b. Revoke every unrevoked token (active or expired) for one authoritative
#     profiles UUID, so stale credentials also receive an audited terminal state
node scripts/admin-token-revoke.mjs --admin-id "$ADMIN_PROFILE_ID" --case-id "SEC-2026-011" --approval-ref "change-1251"
node scripts/admin-token-revoke.mjs --admin-id "$ADMIN_PROFILE_ID" --case-id "SEC-2026-011" --approval-ref "change-1251" --idempotency-key "$REVOCATION_IDEMPOTENCY_KEY" --apply
```

Without `--apply` the script is a dry-run — prints what it would do, doesn't
touch the DB. `--email --apply` is deliberately rejected: email is only the
issuance-time snapshot and is not authoritative identity. Review the returned
`admin_id`, then apply by exact `--id` or `--admin-id`. Snapshot email matching
is case-insensitive; if it maps to multiple `admin_id` values, the CLI warns and
each identity must be reviewed separately. Each apply requires a
case ID and approval reference. Record an explicit operation UUID with the
approved case and pass it as `--idempotency-key`; if the outcome is unknown,
retry/reconcile only the same request and key. `--admin-id` includes expired but
not-yet-revoked rows so stale credentials receive an audited revocation.

`--list --show-inactive` is token inventory, **not audit history**. Review the
dashboard Audit log plus the approved case record for `token_issued` and
`token_revoked` actor/case/approval evidence. Use a staging rehearsal before a
production revocation; production requires an approved incident/change,
verified production origin/caller/target, and a second reviewer when owner
continuity could be affected. Never revoke the last verified owner before its
replacement has unlocked the exact production deployment.

## Backup & restore

### Managed backups

Confirm the project's current plan and actual restore window in
**Dashboard → Database → Backups** before relying on it. Supabase currently
documents daily backups for Pro (7 days), Team (14 days), and Enterprise (up
to 30 days); PITR is a separate option. Free projects need an independent
logical-backup process. See the live
[Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)
rather than assuming this runbook reflects a future plan change.

Database backups cover database rows and Storage metadata, **not the object
bytes stored through the Storage API**. Back up required bucket objects through
a separate, tested process. Restoring a database backup cannot resurrect an
object that was deleted from Storage after the backup point.

### Manual snapshot (before risky migration)

Use Supabase's filtered dump commands instead of raw `pg_dump`, which can
include managed internal schemas/roles and fail on restore:

```bash
# Connection string from Dashboard → Project Settings → Database → URI.
# Run from an encrypted, access-controlled operator device.
supabase db dump --db-url "$SUPABASE_DB_URL" \
  -f backups/$(date +%Y%m%d_%H%M)_roles.sql --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" \
  -f backups/$(date +%Y%m%d_%H%M)_schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" \
  -f backups/$(date +%Y%m%d_%H%M)_data.sql --data-only --use-copy
```

Record checksums and perform a restore drill into an isolated target. The
repository ignores `backups/`, but ignore rules are not encryption: move the
files to the approved encrypted backup store, remove local temporary copies,
and **never commit or chat-send a dump**. Back up Storage object bytes
separately and reconcile them against the database object manifest.

### Restore from automatic backup

This is destructive — it overwrites the live DB. Don't do it without the team's
agreement; you'll lose every row created since the backup point.

1. **Dashboard → Database → Backups** → pick a backup → "Restore".
2. Plan downtime and wait for the Dashboard to report completion; duration
   depends on database size. Reset any custom-role passwords and rebuild
   non-Realtime replication slots/subscriptions if the project uses them.
3. Do **not** run a blind `supabase db push` in this repository. The production
   ledger and actual schema are known to have drifted, and legacy versions 014
   and 015 collide. Re-run the release's read-only schema/ledger inventory and
   PRECHECK files, then apply only the reviewed, uniquely versioned migration
   tail whose VERIFY/REGRESSION set passed in staging.
4. Reconcile Storage objects separately; the database restore restores only
   their metadata.

### Restore from a manual logical dump (last resort)

Never `DROP SCHEMA public CASCADE` on a managed production project as an
improvised restore. It can destroy application objects while leaving Auth,
Storage metadata, grants, extensions, and managed schemas inconsistent.

1. Create an isolated Supabase project or local recovery environment with a
   compatible Postgres version and extensions.
2. Restore the filtered role/schema/data dumps there using Supabase's current
   [restore guidance](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
3. Run schema, RLS/ACL, migration, Auth, Storage-manifest, and application
   acceptance checks against the isolated target.
4. Make production recovery/cutover a separately reviewed change with an
   explicit maintenance window and rollback point. Do not point the app at the
   recovered target until Auth/Storage identity and object consistency are
   proven.

## Ephemeral data retention

> When: the hourly `/api/data-retention` cron returns 503, or immediately after
> deploying its migration/route. This sweep covers only expired operational
> rows; it is not the legal retention policy for trust-and-safety evidence.

Pre-conditions:

1. `20260718150000_ephemeral_data_retention.sql` was applied only after its
   read-only PRECHECK passed.
2. `_ops/VERIFY_20260718_ephemeral_data_retention.sql` passes.
3. Vercel has `CRON_SECRET`, `SUPABASE_URL`, and
   `SUPABASE_SECRET_KEY` in the target environment. The legacy
   `SUPABASE_SERVICE_ROLE_KEY` name is accepted only as a rolling fallback.

Manually invoke the same authenticated path (do not call the privileged RPC
from a browser or paste the service-role key into curl):

```bash
curl -i https://illinimarket.com/api/data-retention \
  -H "Authorization: Bearer $CRON_SECRET"
```

Interpret the response:

- `200 {"success":true,...}`: the capped batch loop completed and no eligible
  backlog remains.
- `401`: header/secret mismatch. Confirm an exact `Bearer <secret>` header and
  rotate the secret if exposure is suspected.
- `503 retention_backlog_pending`: one invocation completed its cap of five
  1,000-row-per-relation transactions (at most 5,000 per relation), but
  eligible rows remain. Wait the returned `Retry-After` (600 seconds), run the
  endpoint again, and keep the incident open until it returns 200.
- `503 retention_unavailable` / `not_configured`: migration/RPC, environment,
  network, timeout, or response-contract failure. Check Vercel function status
  and the read-only VERIFY script; never compensate with an ad-hoc broad
  `DELETE`.

If backlog persists, these read-only counts locate the class without exposing
emails, bucket keys, trace ids, or content:

```sql
SELECT
  (SELECT count(*) FROM public.edge_rate_limits
    WHERE window_start <= now() - interval '7 days') AS expired_rate_buckets,
  (SELECT count(*) FROM public.illini_verifications
    WHERE expires_at <= now()) AS expired_pending_codes,
  (SELECT count(*) FROM public.wechat_media_checks
    WHERE created_at < now() - interval '7 days') AS dead_media_mappings;
```

The sweep must not be expanded to `reports`, moderation snapshots,
`suspensions`, appeals, account-deletion tombstones, or `admin_audit_log`
without a separately approved product/legal retention specification and
migration. The hourly ceiling is 120,000 deleted rows per relation per day;
repeated backlog responses mean incoming eligible volume is approaching or
exceeding capacity and require a reviewed capacity/schema change.

## Deploy rollback

### Production is broken because of the latest deploy

1. **Vercel → Deployments** → find a green production deploy from
   ≤ 24 h ago.
2. ⋯ menu → "Promote to Production".
3. Within 30 s the alias `illinimarket.com`
   points back at the older bundle. No redeploy needed.
4. Push a `revert` commit on `main` so the next deploy doesn't re-break:
   ```bash
   git revert <bad_sha>
   git push
   ```

### A specific migration broke the DB

Migrations don't auto-rollback. You have two choices:

1. **Forward fix:** write a unique UTC timestamp migration such as `20260718173000_fix_<broken_thing>.sql` that reverses the change,
   apply normally. Preferred.
2. **Restore from backup:** see above. Loses any data written between the
   broken migration and now.

## Hotfix deploy

> When: prod is broken and you need to deploy a fix without going through
> the usual PR review.

1. Branch off `main`:
   ```bash
   git checkout -b hotfix/<issue> main
   ```
2. Write the fix. Keep diff minimal.
3. Local validation:
   ```bash
   cd app && npm run type-check && npm run build:h5
   ```
4. Commit + push:
   ```bash
   git push -u origin hotfix/<issue>
   ```
5. **GitHub → Pull Request.** Wait for CI green (~3 min). Branch protection
   requires CI pass + linear history; merge with squash-or-rebase once green.
   (If auto-merge is enabled on the repo, click "Enable auto-merge" so the
   merge fires automatically when CI passes.)
6. Vercel deploys from `main` automatically (~2 min). Monitor Sentry for new
   error patterns.

If `--no-verify` is needed to skip the pre-push hook (e.g., type-check is
broken because of an unrelated upstream issue), document why in the
commit message.

## Sentry alert response

### Alert just fired ("> 10 events in 5 min")

1. Click the alert link → opens the Issue in Sentry.
2. **Top of issue:** the exception message + first/last seen timestamps. If
   "first seen" is < 30 min ago and matches a recent deploy → likely a regression.
3. **Stack trace:** with source maps, this resolves to `src/...vue:N`. Without
   source maps, you'll see `at e (assets/index-Xyz.js:1:N)`. To fix: see
   [Source maps not working](#source-maps-not-working) below.
4. **Breadcrumbs:** what the user did before the error. Look for an `xhr` /
   `fetch` to a Supabase RPC that 4xx'd just before.
5. **Tags → release:** the 7-char SHA. `git show <sha>` to see the commit.
6. If it's noise (third-party browser extension throwing in our code, etc.)
   → Sentry → Issue → "Ignore" with `Forever`.
7. If it's real → file a bug, link the Sentry issue, fix per [Hotfix deploy](#hotfix-deploy).

### Creating the alert rule (do this once, before launch)

The "alert just fired" flow above assumes a rule exists. Errors are captured
without one, but nobody is told — you'd only find them by opening the dashboard.

1. Sentry → Alerts → Create Alert → "Issues".
2. Add condition: an issue is seen by more than **10 events in 5 minutes** (tune later).
3. Add a second rule: "A new issue is created" → catches first-seen regressions right after a deploy.
4. Action: notify your email (free tier supports it). Add Slack/Discord later if you want faster response.
5. Save. That's the whole ask for a beta — no on-call rota needed.

### Source maps not working

Symptom: stack traces are minified (`at e (assets/index-DRvVKW3T.js:1:54312)`).

Check, in order:
1. **Vercel env vars** present? `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.
   Scope each credential to its reviewed Production or isolated trusted Preview
   Sentry project; never copy a production token across all environments.
2. **Vercel build log** for the deploy that produced the broken Issue. Search
   for `[sentry-vite-plugin]`. Should show `Successfully uploaded source maps`.
   - "no auth token" → step 1 failed.
   - "release X already has artifacts" → benign, source maps got there.
   - upload error → check the auth token has scope `project:releases` + `project:write`.
   A local `vercel build` intentionally skips upload when it has no
   `VERCEL_GIT_COMMIT_SHA`, even if preview credentials were downloaded. For a
   deliberate manual upload, set a unique `VITE_RELEASE` together with
   `SENTRY_UPLOAD_SOURCEMAPS=true` for that one build.
3. **Sentry → Releases → <sha>**. Should list 5-20 .js + .map files. If 0 → the
   plugin didn't upload (build log is the source of truth).
4. **Sentry → Issue → Tags → release** matches the sha in #3? If they differ,
   the bundle was built from a different commit than what got uploaded — usually
   means the build skipped sourcemaps for that one release (rare; redeploy).

### Vercel Function inventory before deploy

Vercel treats every public `.js`, `.mjs`, `.ts`, or `.tsx` file under `api/` as
a Function. API tests therefore keep a leading underscore (which Vercel ignores)
and `.vercelignore` also removes test suites from uploaded source. After
`vercel build --yes`, verify the prebuilt artifact before any deploy:

```bash
find .vercel/output/functions -type d -name '*.func' -print | sort
node --test scripts/vercel-function-boundary.test.mjs

# Required before `vercel deploy --prebuilt`. These values are non-secret and
# must identify the reviewed artifact; a CI/local stub manifest is rejected.
PREBUILT_EXPECTED_VERCEL_ENV=preview \
SUPABASE_EXPECTED_PROJECT_REF=<20-char-staging-ref> \
DEPLOYMENT_APP_ORIGIN=https://<reviewed-preview-host> \
PREBUILT_EXPECTED_GIT_SHA=<full-reviewed-commit-sha> \
node scripts/verify-prebuilt-deployment.mjs
```

The inventory must contain only the 20 runtime API Functions (the 19 business
endpoints plus `api/404.func`) and no `*.test.func` directory. The generated
route for `/api/:path* -> /api/404.js` must remain before the SPA
`/(.*) -> /index.html` fallback so an unknown API returns stable JSON 404
instead of `200 text/html`. `scripts/vercel-function-boundary.test.mjs` checks
the exact source/artifact inventory, route order, `/api` root/nested matching,
and the compiled 404 response. Treat any inventory or route drift as a release
blocker; do not paper over a test Function with a rewrite, because a prebuilt
deploy would still ship the unwanted Function bundle.

The H5 build also emits `deployment-manifest.json` with only non-secret tier,
project-ref, app-origin, release, and commit evidence. Production/Preview builds
fail before output when `DEPLOYMENT_EXPECTED_VERCEL_ENV` or
`SUPABASE_EXPECTED_PROJECT_REF` disagrees with the auto-injected Vercel identity.
Production additionally requires an explicit exact `DEPLOYMENT_APP_ORIGIN`.
Preview derives its unique current origin from auto-injected `VERCEL_URL`; an
optional explicit Preview origin must match it exactly. The prebuilt verifier
still requires the operator to provide the exact reviewed artifact origin.
Merely passing the Function inventory test does not make a stub or stale
artifact a release candidate.

## Privileged Supabase key incident / rotation

> When: a legacy `service_role` JWT or newer `sb_secret_...` key was committed,
> leaked, or no longer has a valid owner. Treat this as a full-database access
> incident, not a five-minute hygiene task.

Supabase is deprecating legacy `anon`/`service_role` JWT API keys. The local
candidate release now supports `SUPABASE_SECRET_KEY`,
`SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PUBLISHABLE_KEY`, while keeping
the old variables as rolling fallbacks. Opaque keys use `apikey`; only a real
user JWT (or a legacy JWT-shaped key during the transition) uses Authorization.
Do not paste a new key into an old variable as an unreviewed shortcut. Follow
the current [Supabase API-key migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys),
the repository's [public audit index](docs/audit/README.md),
and complete the real-provider matrix before disabling legacy keys.

### Pre-flight

- [ ] You're logged into Supabase as project owner.
- [ ] You're logged into Vercel as project owner.
- [ ] Incident owner assigned; exposure source contained; logs/repository/key
      history and affected time window preserved.
- [ ] You can reach the admin dashboard with a separate admin token and have a
      read-only post-change validation plan.
- [ ] A release supporting the intended key type passed API/Auth/Storage/RPC
      tests in staging. Existing H5 and mini-program clients were included in
      the compatibility inventory.

### Procedure

1. Determine whether the exposed value is a rotatable `sb_secret_...` key or
   a legacy JWT-based `service_role` key. Do not log the value while checking.
2. For `sb_secret_...`: create a separate named secret key in **Settings → API
   Keys**. Add it to the already-compatible backend, redeploy, and validate
   every privileged route. Only then delete the compromised key; deletion is
   irreversible.
3. For legacy `service_role`: do not use the obsolete "Reset" recipe. Set the
   new named secret in `SUPABASE_SECRET_KEY`, add the publishable aliases,
   deploy the reviewed compatibility release, inventory old public/mobile
   clients, and follow Supabase's current legacy-key/JWT-signing-key procedure.
   Disabling legacy keys before clients are migrated can break anonymous reads
   and active sessions.
4. Inventory and update Vercel Production/Preview/Development, cron jobs,
   scripts, webhooks/`pg_net`, CI secrets, local operator vaults, and any other
   deployment. New secret keys used by webhooks belong in the `apikey` header,
   not `Authorization: Bearer`.
5. Validate admin, Auth admin, PostgREST RPC, Storage list/delete, email/cron,
   account deletion, and user login/refresh paths. Monitor 401/403/5xx and
   Sentry before revoking the old key.
6. Revoke/delete the exposed key only after the inventory is green. Preserve
   the incident timeline and record all affected data/actions for follow-up.

The public URL/publishable key are not secrets, but they still belong in the
compatibility inventory because disabling a legacy anon key can break shipped
clients. Never assume GitHub Actions, a webhook, or an old preview is out of
scope without checking.

## Migration roll-forward (preferred over rollback)

When a migration is broken in prod, "fix forward" almost always beats
"roll back the migration" because rollbacks lose data.

1. Diagnose: `SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 50;`
   often shows the failure pattern.
2. Write a unique 14-digit UTC timestamp migration that reverses the broken change without
   dropping data. Examples:
   - Bad column type → `ALTER TABLE … ALTER COLUMN … TYPE … USING …`
   - Bad RLS policy → `DROP POLICY` + new one with correct logic
   - Bad trigger → `DROP TRIGGER … ON …; CREATE TRIGGER …`
3. Run its read-only PRECHECK, backup/staging rehearsal, then apply the exact
   reviewed file through the production migration path. Do not run a blind
   `db push` while the ledger/schema drift remains unresolved.
4. Run the matching VERIFY and behavioral regression plus the same query that
   detected the failure.
5. PR + merge as a normal commit (no need for hotfix path unless prod is
   actively broken).

## WeChat callback replay hardening rollout

> When: shipping `20260722024000_harden_wechat_callback_replay.sql` and the
> matching `/api/wechat-callback` build. This is a database-first rollout. Do
> not publish the API merely because its Node tests pass.

> **Production gate:** the callback now accepts only WeChat 安全模式 POST:
> `msg_signature` authenticates Token + timestamp + nonce + `Encrypt`, then the
> receiver performs AES-256-CBC/K=32 PKCS#7 decryption and verifies the trailing
> AppID before any database or Storage operation. JSON and XML encrypted
> envelopes/events are supported; plaintext POSTs and compatibility-mode
> envelopes carrying extra plaintext event fields fail without side effects.
> Event-level idempotency remains defense in
> depth, not a substitute for this body authentication. Keep
> `media_check_async` disabled in production until the exact deployed build and
> environment pass a real WeChat provider retry canary.
> `WECHAT_MEDIA_ASYNC_ENABLED` is the independent fail-closed switch and must
> remain absent/false until that canary passes. `WECHAT_APPID`,
> `WECHAT_PUSH_TOKEN`, and the exact 43-character `WECHAT_ENCODING_AES_KEY` are
> mandatory before the flag can enable image enqueue. `WECHAT_APPSECRET` must
> still be present for WeChat login and synchronous text moderation; do not
> remove it as a workaround for callback risk. When the flag is absent, image
> enqueue returns 503 and callback POST returns 503 before reading a body or
> touching database/Storage; the signed GET configuration handshake remains
> available.

1. Confirm the exact target, backup/restore point, operator approval and
   migration ledger. Every lower migration, including `20260720035037`, must
   already be reconciled; do not use a max-version shortcut.
2. Run
   `PRECHECK_20260722024000_harden_wechat_callback_replay.sql`. It is read-only.
   Any missing `wechat_media_checks` key/RLS contract, object-name collision or
   pre-existing ledger row is a stop condition.
3. Apply the exact manifest-pinned `20260722024000` file through the approved
   ledger-aware executor. Then run its read-only VERIFY. VERIFY must prove the
   deny-all/RLS receipt table, event-key/canonical-payload SHA-256 fields, strict
   five-minute-past/one-minute-future first-delivery window, exact retention
   indexes, and service-role-only claim/complete/release RPCs.
4. Wait for the PostgREST schema reload and confirm all three RPC signatures
   are visible to the service role before publishing the API. If the API is
   deployed first, valid POST callbacks safely return 503, but WeChat delivery
   is interrupted; roll the API back until the database gate is ready.
5. Run
   `REGRESSION_20260722024000_harden_wechat_callback_replay.sql` only in a
   disposable local/staging PostgreSQL 16/17 database. It must end in ROLLBACK
   and prove past/future no-write rejection, same-trace/different-verdict
   conflict, equivalent concurrent delivery, active lease, completion replay,
   zero-row DB-first mapping compatibility and rollback-atomic media cleanup.
   Never run this synthetic regression in production.
6. Deploy the matching callback API at an exact reviewed SHA. In isolated
   staging, use a disposable media object and a real WeChat callback canary:
   configure the matching AppID/Token/EncodingAESKey in **安全模式** (never 明文
   or 兼容), then prove `msg_signature`, encrypted `Encrypt`, AES/AppID
   verification and the selected JSON/XML format,
   then one pass/review or risky verdict and a provider retry using a changed
   timestamp/nonce/signature. JSON key reordering must remain the same event;
   the completed retry must return 200 without a second Storage deletion or
   mapping side effect, while a different verdict for the same trace_id must
   conflict. Confirm logs contain only stable error codes, never a trace_id,
   raw signature, decrypted payload or request body.

If the API needs rollback after the database migration, use only a reviewed
event-key-aware bridge build. **Do not roll back to the legacy callback** that
identifies receipts by query signature/body bytes or deletes mappings outside
the completion transaction. The additive table/RPC migration may remain
installed; do not drop its ledger or replay history. A currently processing
duplicate returns retryable 503 by design—acknowledging it early could lose the
event if the original worker subsequently fails.

## 2026-07 candidate release sequence

> This is the reviewed operational order for the current 38-migration audit
> candidate. It is **not** authorization to change production. Stop before the
> first mutating step unless the release owner has approved the exact target,
> backup/rollback point, migration hashes, and operator.
> Migration SQL always follows its unique, increasing 14-digit version order.
> Every new version must be a real UTC timestamp. The already-frozen
> `20260718240000` through `20260718280000` tranche-coded filenames are legacy
> exceptions, not examples to copy or rename. Product tranches below coordinate
> matching API/client releases; they never authorize applying a later-version
> SQL file ahead of an earlier pending migration, except for the explicit
> 18160000/19151729 and 18250000/19170019 partial-ledger repairs documented in
> steps 7 and 11.

1. Freeze unrelated changes. Export the production migration ledger and exact
   schema/grants/policies/functions, resolve the known drift, back up database
   rows and Storage object bytes separately, and rehearse restore into an
   isolated target. Verify every reviewed migration byte from the directory the
   manifest paths are relative to; any mismatch is a stop condition:

   ```bash
   (cd supabase/migrations && shasum -a 256 -c manifest.sha256)
   ```

2. In two independent fresh PostgreSQL 17 environments, replay all 88
   historical + 38 candidate migrations and every applicable
   PRECHECK/VERIFY/rolled-back REGRESSION file, then compare normalized schema
   outputs. Re-run only the tail fixes that explicitly declare themselves
   re-entrant and require a zero schema diff before/after that pass; first-time
   schema migrations such as `20260718200000` are intentionally one-shot and
   must not be misreported as idempotent. Repeat the same operational order
   against production-like staging. This proves replayability only;
   production reconciliation and post-deploy verification remain separate
   gates.
3. Run every currently applicable production PRECHECK read-only. The WeChat
   retirement PRECHECK intentionally fails while the legacy map is non-empty;
   defer that one check until step 6. Any other mismatch is a stop condition,
   not a reason to edit or skip the guard.
4. Apply the compatibility-first foundation in timestamp order:

   - `20260717092804` through `20260717194842` (public write boundaries,
     block/report/lifecycle/evidence/deletion/Illini verification);
   - `20260718120000` and `20260718130000` (appeal intent and advisory
     fingerprint signal).

   Run each matching VERIFY and behavioral matrix before advancing. Keep the
   guarded legacy consent RPC overloads and legacy Supabase keys enabled for
   rolling clients.
5. Add environment variables additively: `VITE_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, and the
   strict-HTTPS live-email origins (`DIGEST_APP_URL` / `MEETUP_APP_URL`).
   Non-H5 builds also require a valid `VITE_BASE_URL`. Do not paste an opaque
   key into an old variable, revoke a legacy key, expose a secret through
   `VITE_*`, or let preview email links default to production.
6. Deploy the reviewed passwordless WeChat route and wait for in-flight legacy
   requests to drain. Dry-run `scripts/retire-wechat-passwords.mjs`; with a
   separate apply approval, run it for real. Verify the map is empty, run the
   retirement PRECHECK, and only then apply
   `20260718140000_retire_wechat_password_credentials.sql`. Stop if any
   account still depends on a password credential.

   ```bash
   node scripts/retire-wechat-passwords.mjs
   node scripts/retire-wechat-passwords.mjs \
     --apply --confirm RETIRE_WECHAT_PASSWORDS
   ```
7. Apply `20260718150000` retention and `20260718160000` suspension visibility.
   Run both VERIFY files. Manually invoke `/api/data-retention` until no backlog
   remains, then verify anon/A/B/suspended/admin visibility and writes,
   including natural expiry and early lift. Never broaden retention to legal,
   moderation or audit data as an incident shortcut.

   One narrowly reviewed partial-ledger exception exists for a production
   database that has already recorded `18160000` but whose matching VERIFY is
   stopped only by historical PUBLIC/anon/authenticated ACL drift on
   `public.posts` or `public.post_items`. After the 19151729 PRECHECK proves the
   exact expected 18160000 RLS/policy shape, a ledger-aware executor may apply
   and record `20260719151729_reconcile_plaza_base_table_acl.sql` immediately,
   then rerun both its VERIFY and the 18160000 VERIFY. This does not mark any
   intervening lower version as applied: every missing version must still be
   installed and recorded explicitly. Do not use a max-version-only runner for
   this case. After 18280000, rerun the 19151729 VERIFY to prove the broad ACL
   reconciliation converged on the same Plaza contract.
8. Apply the administrator foundation in timestamp order:

   - `20260718170000` required actor attribution;
   - `20260718180000` atomic/idempotent mutations with required audit;
   - `20260718190000` least-privileged capabilities and owner recovery;
   - `20260718200000` managed banner upload saga and leased GC.

   Exercise role denials, required-audit rollback, owner recovery, banner
   attach/detach/GC and exact managed image URLs. New or changed banners cannot
   use arbitrary HTTPS images; unchanged historical rows are compatibility-only.
   `18190000` intentionally backfills every historical token to `operator`;
   never infer an elevated role from cached name/email or from recent use. If
   no reviewed owner exists, the first exact token/profile promotion is an
   external break-glass operation with its own case and second reviewer. After
   the lifecycle API is live, use that verified owner to mint and independently
   exercise a second recoverable owner before declaring the administrator
   backend operational.
9. Deploy the product-integrity tranche with the matching client/API build:

   - `20260718210000` exact deal-attributed ratings;
   - `20260718220000` covering FK indexes;
   - `20260718230000` authoritative public text/media/Storage boundaries.

   `230000` intentionally makes public chat text-only and aligns `item-images`
   to the client's 5 MiB image limit. Old clients may receive a safe rejection
   for retired media behavior. Verify publish/edit, Plaza, avatar, owner quota,
   outcome-unknown and orphan cleanup before progressing.
10. Apply `20260718240000_private_conversation_realtime.sql`, deploy the exact
    private-topic client, and canary Auth handshake, participant topics,
    teardown, reconnect and polling fallback. Realtime “public access” is a
    dashboard setting, not a migration: turn it off only after every supported
    shipped client has migrated or been retired, then repeat the A/B/
    nonparticipant matrix. Supabase owns `realtime.messages` and may retain its
    owner-issued, non-grantable S/I/U base ACL for API roles; application
    authorization comes from the exact authenticated SELECT/INSERT policies.
    Do not attempt to GRANT/REVOKE that managed table to make an app-level ACL
    assertion green, and do not strand an old mini-program build to make an
    advisor green.
11. Deploy the email-delivery tranche and its routes together:

    - `20260718250000` exact meetup event/notification attribution;
    - `20260718260000` atomic meetup + unread reminder seeding;
    - `20260718270000` shared immediate/digest claim, lease and provider key.

    A second narrowly reviewed partial-ledger exception exists for a production
    database that has recorded and verified `18250000`, but whose `18260000`
    PRECHECK stops only because historical table ACLs still make
    `public.meetups.reminded_at` client-mutable. Run
    `PRECHECK_20260719170019_reconcile_meetups_acl_boundary.sql`; if it proves
    the exact current meetup policy/RPC prerequisites, apply and record the
    exact `20260719170019` migration immediately, run its VERIFY, then rerun the
    `18260000` PRECHECK. This exception does not apply or record `19164126`, nor
    does it mark any other intervening lower version as applied. After
    `18280000`, rerun the `19170019` VERIFY to prove the broad ACL tail retained
    the same 13-column authenticated read, RPC-only write and service CRUD
    contract.

    Run synthetic test mode first; it must contain only synthetic content.
    Then run a one-recipient live canary with an approved address, verified
    sender and explicit app origins. Exercise immediate-vs-digest overlap,
    provider timeout/ambiguous acceptance, completion loss, retry, block and
    unsubscribe. Keep live flags off until canary and alerting are green.
12. Apply `20260718280000_reconcile_app_table_acl_boundaries.sql` as the final
    Data API ACL reconciliation before the administrator lifecycle tail. It
    removes inherited/default privilege drift, grants only the exact public and
    account-private columns used by the shipped clients, and keeps new profile
    columns private until explicitly reviewed. Run its PRECHECK, VERIFY and
    anon/A/B/service behavioral regression; a policy existing is not proof that
    the corresponding table/column privilege is safe or usable.
13. Apply the administrator lifecycle, deterministic pagination and real FK
    index tail in exact version order:

    - `20260719010000` owner-only audited token issue plus exact/admin-ID
      revocation lifecycle;
    - `20260719020000` forward-only verified-owner and direct token-mutation
      concurrency reconciliation;
    - `20260719030000` reconciliation-fence and digest-meetup indexes;
    - `20260719082600` deterministic unique-key ordering for every paginated
      administrator RPC that previously ended on a non-unique business field;
    - `20260719083511` full FK indexes for report, token and suspension history
      that an earlier verifier had incorrectly treated as covered by unrelated
      business-predicate partial indexes;
    - `20260719151729` narrowly scoped Plaza base-table ACL reconciliation. If
      the reviewed 18160000 partial-ledger exception already recorded it, do
      not replay it here; rerun its VERIFY instead;
    - `20260719164126` final managed Realtime Authorization reconciliation. It
      rebuilds only the two exact authenticated policies and deliberately does
      not GRANT or REVOKE the Supabase-owned `realtime.messages` table;
    - `20260719170019` exact meetup table ACL reconciliation. If the reviewed
      18250000/18260000 partial-ledger exception already recorded it, do not
      replay it here; confirm its exact ledger row and rerun its VERIFY;
    - `20260719174928` trigger-only function ACL reconciliation. It
      preserves the currency-exchange write guard as a trigger while denying
      direct API-role execution and pins the function to `pg_catalog`;
    - `20260720035037` admin appeal-decision and session-metadata hardening;
    - `20260722024000` WeChat callback timestamp/replay claim hardening;
    - `20260722033904` final legacy 014/015 version-collision reconciliation.
      Its read-only precheck sizes any backfill and validates JSON/i18n plus
      legacy linkage. If the old single-item column remains, the migration
      copies only missing same-owner pairs through migration 041's FK/cap
      contract and proves pair equivalence before retiring the old objects.

    Run `PRECHECK_20260719_admin_token_lifecycle_rpc.sql` before `19010000`.
    After `19010000` is recorded, run the distinct
    `PRECHECK_20260719020000_admin_owner_recovery_concurrency.sql`; the former
    precheck intentionally rejects an already-installed lifecycle tail and is
    not a substitute. The ledger-aware migration executor must establish, in
    the **same database session** used for `19020000`, bounded session settings
    equivalent to:

    ```text
    PGOPTIONS='-c lock_timeout=5s -c statement_timeout=2min' <approved-ledger-aware-migration-command>
    ```

    Confirm both settings with `SHOW` in the executor log. Do not run `\i` or
    raw `psql -f` as a shortcut if that bypasses atomic migration-ledger
    recording. If the approved executor cannot preserve those settings, stop;
    drain the sessions reported by the precheck and use a reviewed maintenance
    path rather than allowing the table lock to wait without a deadline.

    Before `19030000`, run its PRECHECK. A missing target index on a relation
    above 64 MiB is a stop condition: prebuild the exact index concurrently in
    an approved maintenance path, verify it, then let the migration's guarded
    `IF NOT EXISTS` be a no-op. Finish its index work with the `19030000`
    VERIFY. Its historical global check is superseded by the stricter final
    `19083511` VERIFY below; do not treat the earlier partial-index rule as the
    final FK coverage gate.

    Before `19082600`, run
    `PRECHECK_20260719082600_deterministic_admin_pagination_order.sql`. It must
    see the preceding tail indexes plus the exact current RPC and unique-key
    shapes. Apply the function-only migration, then run its matching VERIFY;
    the VERIFY requires report grouping, suspension, appeal, audit and Plaza
    post ordering to end in their stable unique keys and requires every RPC to
    remain executable only by `service_role`. Exercise equal-timestamp and
    equal-priority rows across a page boundary before publishing the console.

    Finally run
    `PRECHECK_20260719083511_release_tail_full_fk_indexes.sql`. A missing target
    index on a relation above 64 MiB, any active/prepared target writer, any FK
    shape mismatch, or any conflicting same-named index is a stop condition.
    Prebuild the exact named index concurrently only through an approved
    maintenance path; otherwise apply `19083511` with its bounded lock/statement
    deadlines. Run its matching VERIFY as the authoritative FK-tail gate. It
    accepts a partial index only when a single nullable FK column's
    entire predicate is exactly that same column `IS NOT NULL`; status,
    revocation, lift or other business predicates do not count as FK coverage.

    Next, either apply 19151729 in normal version order or, for the reviewed
    partial-ledger case, confirm its exact ledger row. Run
    `VERIFY_20260719151729_reconcile_plaza_base_table_acl.sql` after 18280000
    in both cases. The migration must preserve `service_role`, reject inherited
    or grant-option application-role drift, and match the exact Plaza policy
    contract; a same-named policy is not sufficient.

    Finally run
    `PRECHECK_20260719164126_reconcile_managed_realtime_authorization_contract.sql`,
    apply `20260719164126` in normal version order, and run its matching VERIFY.
    The accepted hosted baseline is owner-issued, non-grantable S/I/U with no
    column ACL or parent-role inheritance. PUBLIC, another grantor, grant
    option, DELETE/TRUNCATE/REFERENCES/TRIGGER, or PostgreSQL 17 MAINTAIN is a
    stop condition. The policy dependency gate must also retain authenticated
    SELECT on `conversations.id/buyer_id/seller_id`, USAGE on
    `public/auth/private/realtime`, and EXECUTE on `auth.uid()`,
    `realtime.topic()` and `private.current_user_can_access_pair(uuid,uuid)`;
    an exact policy expression without those effective grants is not usable.
    Exercise the rollback-only regression only in disposable local/staging
    PostgreSQL, never production.

    Finally run
    `PRECHECK_20260719170019_reconcile_meetups_acl_boundary.sql`. Apply
    `20260719170019` in normal order, or confirm its exact ledger row if the
    reviewed reminder-state exception already installed it. Its VERIFY must
    prove anon/PUBLIC have no table or column access, authenticated can select
    only the 13 reviewed client columns and cannot directly write or read
    `reminded_at`, service_role has CRUD without grant option, and the three
    authenticated meetup RPCs plus RLS policy remain intact. PostgreSQL 17
    MAINTAIN, inherited ACLs, another grantor or column drift are stop
    conditions. Never run its rollback-only REGRESSION in production.

    Next, run
    `PRECHECK_20260719174928_reconcile_trigger_only_function_acl.sql`, apply
    `20260719174928` in normal order, and run its matching VERIFY. The VERIFY
    must prove the exact BEFORE ROW INSERT/UPDATE trigger, guarded `category`
    column, function body/identity, SECURITY INVOKER posture, `pg_catalog`
    search path and effective ACL provenance. Exercise the rollback-only
    REGRESSION only in disposable local/staging PostgreSQL, never production.

    Continue in strict ledger order with the 20035037 appeal hardening and its
    PRECHECK/VERIFY, then the separately documented 22024000 WeChat callback
    sequence. Last, run the read-only
    `PRECHECK_20260722033904_reconcile_legacy_migration_versions.sql`. Treat
    missing-item, cross-owner, cap, invalid JSON/i18n, unexpected NULL volume,
    table size, lock-window, or ledger findings as stop conditions. After a
    production-like rehearsal, apply the exact
    `20260722033904_reconcile_legacy_migration_versions.sql`, then run
    `VERIFY_20260722033904_reconcile_legacy_migration_versions.sql`. Confirm there is
    exactly one migration file for every numeric version, the manifest passes,
    version 014 has both `defective` and the two `image_dimensions` columns,
    version 015 has the five i18n columns, `public.post_items` exists, and the
    obsolete `posts.attached_item_id`, ownership trigger/function and index do
    not exist. Preserve the exported precheck counts as change evidence. Do not
    infer linkage migration from the replacement table's existence alone. Do
    not repair the production 014/015 ledger names: their canonical
    `condition_defective` / `content_i18n` rows are already correct.

    Record explicitly that hosted state is schema-convergent but byte-divergent
    from the two pre-repair repository snapshots archived under
    `_ops/forensics/reviewed-history-repairs/`. The Supabase ledger does not
    store SQL content hashes, so a version row proves neither historical byte
    sequence. The manifest protects current replay bytes only; keep PRECHECK,
    VERIFY and the exported schema evidence with the release record.

    Exercise token expiry/revocation, owner-only issuance from authoritative
    profile snapshots, case/approval/idempotency replay, outcome-unknown
    recovery, direct token-write concurrency and the three-role allow/deny
    matrix before publishing the administrator UI/API.
14. Publish the matching H5/mp/legal/re-consent bundle only after the backend
    facts it describes exist. Run the complete browser, two-account,
    administrator, provider and real-device matrix and monitor 401/403/409/
    429/5xx, Auth refresh, Realtime, Storage, cron, Sentry and Supabase Advisors
    through the observation window.
15. Clean prior disposable audit accounts and their objects only through the
    verified durable deletion/admin path. Do not edit Supabase Auth or Storage
    internal tables directly. Disable legacy keys, old Realtime public access
    or guarded RPC overloads only in a later release after adoption is proven.

---

## Launch operations (beta)

> A campus beta is small. This is the minimum to not get surprised — not an
> enterprise on-call rota.

### Launch day — in order (one page)

The reference sections elsewhere are organized by topic; this is the **sequence**.
Top to bottom; each step links to its detail.

1. **Env vars** scoped on Vercel per [ENV_CHECKLIST pre-launch](ENV_CHECKLIST.md#pre-launch-checklist-fall-2026-beta). Production privileged secrets exist only in Production; trusted Preview uses isolated staging resources and a reviewed ref/custom environment; arbitrary PR previews receive no privileged secrets. The two matching-environment `VITE_*` Supabase vars are non-negotiable (white screen without).
2. **Supabase dashboard** (Auth):
   - Site URL + Redirect URLs point at the prod origin.
   - Email confirmation **ON**; password policy at least 8 characters with
     upper/lower/digit/symbol. On Pro or above, enable leaked-password (HIBP)
     protection; do not deliberately leave the Security Advisor finding open.
   - **Reset Password** email template body uses `{{ .Token }}` (the 6-digit code, not the link) **and Email OTP length = 6** (Auth → Providers → Email). The app's reset is a typed code (QA6 #138). Leave the **Confirm signup** template on the link.
3. **Migrations reconciled** — export the production ledger and actual object
   definitions, resolve the documented 014/015 collision and dashboard-applied
   drift, run every release PRECHECK, then deploy only the reviewed timestamped
   candidate set. Spot-check exact function signatures and role privileges;
   the presence of a file in `migrations/` is not proof it is deployed.
4. **Admin token** — mint ≥ 1 ([Admin token mint](#admin-token-mint)); store in a password manager.
5. **Sentry alert rule** — [create it once](#creating-the-alert-rule-do-this-once-before-launch).
6. **Seed content** — ≥ a dozen real listings across the main categories. An empty market reads as dead.
7. **Device verification** — run [QA_DEVICE_CHECKLIST](docs/QA_DEVICE_CHECKLIST.md) (esp. §7: QA6 + motion) on a real iPhone / iPad / Mac + two accounts. CI cannot catch keyboard, realtime, or desktop-layout regressions.
8. **Post-deploy diagnostic** — [ENV_CHECKLIST diagnostic](ENV_CHECKLIST.md#diagnostic): app 200, admin 200, Sentry receiving events tagged with the deploy SHA.
9. **Invite the first small cohort**, then run the [daily week-1](#daily-during-week-1) loop. Digest stays **OFF** unless prepped (verify sender-domain DKIM, clear `DIGEST_TEST_EMAIL`, set `DIGEST_LIVE=true`, and set an explicit HTTPS-origin-only `DIGEST_APP_URL`; live mail fails closed without it).

### Before you invite the first cohort

- [ ] Run the pre-launch checklist in `ENV_CHECKLIST.md` (env vars + Supabase auth + reset test).
- [ ] Mint at least one admin token ([Admin token mint](#admin-token-mint)); store it in a password manager.
- [ ] Create the [Sentry alert rule](#creating-the-alert-rule-do-this-once-before-launch).
- [ ] Seed the marketplace so the first visitor doesn't hit an empty feed — a dozen real listings across the main categories. An empty market reads as dead.

### Daily during week 1

- [ ] Sentry: any new issue since yesterday? (the alert pings you; this is the backstop.)
- [ ] Admin dashboard → Reports: clear the abuse/spam queue.
- [ ] If the digest is live: Vercel → Cron → confirm the 23:00 UTC run was green.

### If it breaks

- App down / bad deploy → [Deploy rollback](#deploy-rollback) (Vercel: promote the last green deploy — alias flip, no rebuild).
- A user reports a broken account → [user repair](#a-specific-user-reports-their-account-is-broken).
- Spam spike → suspend via the admin dashboard; the reason lands in `admin_audit_log`.

### Rollout shape

Beta cohort first (a known, friendly group), then widen. There's **no code flag**
to flip — any signup can use the app, so "beta" is simply how many people you've
told. Keep it small until week-1 reports are quiet, then widen by one invite batch
at a time.

## Updates to this file

This file is committed (unlike `_ai_notes/`) because everyone on call
needs the same words. When you update a procedure:
- One commit per section if possible.
- Title prefix: `docs(runbook): …`
- If you used a procedure during an incident and found it wrong/missing,
  update it the next day while the experience is fresh.
