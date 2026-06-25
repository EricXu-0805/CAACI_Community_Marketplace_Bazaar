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
| service_role key in a leaked log / commit | [Service role key rotation](#service-role-key-rotation) |
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
   SELECT id, email, status, ban_level, created_at
     FROM auth.users JOIN public.profiles ON profiles.id = users.id
    WHERE auth.users.email = 'their@email';
   ```
3. Check `admin_audit_log` for any recent admin actions on this user.
4. If suspended in error → Admin dashboard → Suspensions → "Lift suspension" with reason.

## Admin token mint

> When: a new admin needs dashboard access, or an existing admin lost their token.
> Who can run: any developer with `SUPABASE_SERVICE_ROLE_KEY` in their shell.

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# Dry-run: prints the plaintext but doesn't write to DB
node scripts/admin-token-mint.mjs \
  --name "Alice Example" \
  --email "alice@illinois.edu"

# Real: writes hash to DB. Plaintext printed once — copy now or you'll
# have to revoke + re-mint.
node scripts/admin-token-mint.mjs \
  --name "Alice Example" \
  --email "alice@illinois.edu" \
  --apply

# If linking to an existing profiles.id (so audit-log gets actor_id):
node scripts/admin-token-mint.mjs \
  --name "Alice Example" \
  --email "alice@illinois.edu" \
  --admin-id 9f2c3a1e-... \
  --apply
```

The plaintext token starts with `iam_admin_` (so GitHub secret-scanning catches
accidental commits) and is shown ONCE. The admin pastes it into the dashboard's
first-visit prompt → it lives in their browser's localStorage as `admin_token`.

## Admin token revoke

> When: an admin left the team, lost their device, or their token might
> be leaked. Setting `revoked_at` is reversible but conventionally permanent —
> mint a new one if they need access back.
> Who can run: same as mint.

```bash
# 1. Inventory: see who has active tokens
node scripts/admin-token-revoke.mjs --list

# 2a. Revoke a single token by id (copy from --list output)
node scripts/admin-token-revoke.mjs --id 9f2c3a1e-... --apply

# 2b. Revoke ALL active tokens for a departed admin (single email = single
#     admin in our model)
node scripts/admin-token-revoke.mjs --email kenny@illinois.edu --apply

# 3. Audit history (revoked + active)
node scripts/admin-token-revoke.mjs --list --show-revoked
```

Without `--apply` the script is a dry-run — prints what it would do, doesn't
touch the DB. **Always do the dry-run first** for `--email` revokes since one
typo can lock out an admin.

## Backup & restore

### Backups (automatic)

Supabase ships daily backups on the Pro plan. They're retained 7 days.
**Dashboard → Database → Backups**.

> ⚠️  Free tier has NO automatic backups. If we're still on Free, the only
> backup is whatever you manually pg_dump'd. Upgrade or set up your own.

### Manual snapshot (before risky migration)

```bash
# Connection string from Dashboard → Project Settings → Database → URI
pg_dump "$SUPABASE_DB_URL" > backups/$(date +%Y%m%d_%H%M)_pre_migration.sql

# Compress for smaller file (typical: 5-30 MB)
gzip backups/*_pre_migration.sql
```

`backups/` is `.gitignore`d. Store the result in 1Password / Google Drive / wherever
you keep credentials. **Never commit a pg_dump.**

### Restore from automatic backup

This is destructive — it overwrites the live DB. Don't do it without the team's
agreement; you'll lose every row created since the backup point.

1. **Dashboard → Database → Backups** → pick a backup → "Restore".
2. Wait ~5 min for the DB to come back up.
3. Run the migration tail to bring the schema current:
   ```bash
   npx supabase db push  # applies any migrations from supabase/migrations/
   ```

### Restore from manual pg_dump (last resort)

```bash
# Drops + recreates everything in public schema. ALL DATA LOST.
psql "$SUPABASE_DB_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c backups/<file>.sql.gz | psql "$SUPABASE_DB_URL"
```

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

1. **Forward fix:** write `040_fix_<broken_thing>.sql` that reverses the change,
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
   Settings → Environment Variables → all 3, all environments.
2. **Vercel build log** for the deploy that produced the broken Issue. Search
   for `[sentry-vite-plugin]`. Should show `Successfully uploaded source maps`.
   - "no auth token" → step 1 failed.
   - "release X already has artifacts" → benign, source maps got there.
   - upload error → check the auth token has scope `project:releases` + `project:write`.
3. **Sentry → Releases → <sha>**. Should list 5-20 .js + .map files. If 0 → the
   plugin didn't upload (build log is the source of truth).
4. **Sentry → Issue → Tags → release** matches the sha in #3? If they differ,
   the bundle was built from a different commit than what got uploaded — usually
   means the build skipped sourcemaps for that one release (rare; redeploy).

## Service role key rotation

> When: key was committed, leaked in logs, an ex-employee had access to it,
> or quarterly key-rotation hygiene.
> Time: ~5 min. Brief downtime (~30 s) when the new key reaches Vercel +
> the old key still appears in cached fetch handlers.

### Pre-flight

- [ ] You're logged into Supabase as project owner.
- [ ] You're logged into Vercel as project owner.
- [ ] You can reach the admin dashboard with at least one admin token (so
      you have a way to validate post-rotation).

### Procedure

1. **Supabase Dashboard → Project Settings → API → service_role**.
2. Click "Reset". Confirm. **The new key replaces the old one immediately;**
   from this moment, every system using the old key returns 401 until
   updated.
3. Copy the new key (starts with `sbp_` followed by a long base64 string).
4. **Vercel → Project Settings → Environment Variables**:
   - Find `SUPABASE_SERVICE_ROLE_KEY` (likely set on Production + Preview +
     Development).
   - Edit each → paste new value → Save.
5. **Vercel → Deployments → latest production deploy → ⋯ → Redeploy**.
   Wait ~2 min.
6. Update your local shell:
   ```bash
   # Whatever you use — ~/.zshrc, ~/.envrc, 1Password CLI etc.
   export SUPABASE_SERVICE_ROLE_KEY=<new_key>
   ```
7. **Validate:** open admin dashboard → click "Reports" tab → it should
   load without 401. If you see 401, the old key is still cached somewhere
   you missed (check GitHub Secrets, any `.env` files, any other deploys).

### What you can skip

- You do NOT need to rotate `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` —
  those are public by design and don't need rotation.
- You do NOT need to update GitHub Actions: CI doesn't use the service_role
  key (it stubs Supabase URLs at build time).

### If something goes wrong

The old key is permanently dead the moment you reset. There's no
"undo." If you broke something, the recovery is:
1. Reset again (third reset; gives you a third key).
2. Update everything carefully this time.

## Migration roll-forward (preferred over rollback)

When a migration is broken in prod, "fix forward" almost always beats
"roll back the migration" because rollbacks lose data.

1. Diagnose: `SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 50;`
   often shows the failure pattern.
2. Write `0XX_fix_<thing>.sql` that reverses the broken change without
   dropping data. Examples:
   - Bad column type → `ALTER TABLE … ALTER COLUMN … TYPE … USING …`
   - Bad RLS policy → `DROP POLICY` + new one with correct logic
   - Bad trigger → `DROP TRIGGER … ON …; CREATE TRIGGER …`
3. `npx supabase db push` to apply.
4. Verify with the same query that detected the failure.
5. PR + merge as a normal commit (no need for hotfix path unless prod is
   actively broken).

---

## Launch operations (beta)

> A campus beta is small. This is the minimum to not get surprised — not an
> enterprise on-call rota.

### Launch day — in order (one page)

The reference sections elsewhere are organized by topic; this is the **sequence**.
Top to bottom; each step links to its detail.

1. **Env vars** set on Vercel (Production + Preview) per [ENV_CHECKLIST pre-launch](ENV_CHECKLIST.md#pre-launch-checklist-fall-2026-beta). The two `VITE_*` Supabase vars are non-negotiable (white screen without).
2. **Supabase dashboard** (Auth):
   - Site URL + Redirect URLs point at the prod origin.
   - Email confirmation **ON**; password policy min 8 + upper/lower/digit; **leaked-password (HIBP) OFF** (deliberate — QA round 2).
   - **Reset Password** email template body uses `{{ .Token }}` (the 6-digit code, not the link) **and Email OTP length = 6** (Auth → Providers → Email). The app's reset is a typed code (QA6 #138). Leave the **Confirm signup** template on the link.
3. **Migrations current** — prod is at the latest migration (064–069 + any 07x). Spot-check intent, e.g. `select has_function_privilege('anon','<fn>(args)','execute');`.
4. **Admin token** — mint ≥ 1 ([Admin token mint](#admin-token-mint)); store in a password manager.
5. **Sentry alert rule** — [create it once](#creating-the-alert-rule-do-this-once-before-launch).
6. **Seed content** — ≥ a dozen real listings across the main categories. An empty market reads as dead.
7. **Device verification** — run [QA_DEVICE_CHECKLIST](docs/QA_DEVICE_CHECKLIST.md) (esp. §7: QA6 + motion) on a real iPhone / iPad / Mac + two accounts. CI cannot catch keyboard, realtime, or desktop-layout regressions.
8. **Post-deploy diagnostic** — [ENV_CHECKLIST diagnostic](ENV_CHECKLIST.md#diagnostic): app 200, admin 200, Sentry receiving events tagged with the deploy SHA.
9. **Invite the first small cohort**, then run the [daily week-1](#daily-during-week-1) loop. Digest stays **OFF** unless prepped (verify sender-domain DKIM, clear `DIGEST_TEST_EMAIL`, set `DIGEST_LIVE=true`).

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
