# Environment variable checklist

Where each env var lives, who needs to set it, and what happens if it's
missing. Sorted by criticality.

## TL;DR — Vercel-only vs everywhere

- **Vercel-only** (server-side, never exposed to browser): the secrets.
  `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_API_KEY` (legacy), `SENTRY_AUTH_TOKEN`,
  any RPC secret.
- **Vercel + GitHub Actions + local `.env`**: VITE-prefixed vars that the
  build inlines into the bundle. `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_SENTRY_DSN`.
- **Auto-derived, do not set**: `VITE_RELEASE` is derived from
  `VERCEL_GIT_COMMIT_SHA` at build time. Override only if you need a
  custom release name.

## The full list

### Required for the app to work at all

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | ✅ stub | ✅ | App can't reach Supabase. White screen. |
| `VITE_SUPABASE_ANON_KEY` | ✅ | ✅ stub | ✅ | Same as above. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ❌ | ⚠️ shell-only | Admin API + edge functions return 500. |

> **GH Actions stub**: CI doesn't have the real values. The build only needs
> the strings to *exist* so that Vite doesn't error on `import.meta.env`.
> Stubs `https://ci-stub.supabase.co` / `ci-stub-anon-key` work fine.

### Admin API auth

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `ADMIN_API_KEY` | ⚠️ legacy | ❌ | ❌ | Falls back to per-admin tokens (migration 036). Once every admin has migrated, **delete this var.** |

The legacy shared `ADMIN_API_KEY` is preserved as a fallback during the
rollout window. Each per-admin token in `admin_tokens` supersedes it. When
all admins are on per-admin tokens, remove the env var to lock the legacy
path. Verify by attempting the old shared key — should get 401.

### Observability (Sentry)

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `VITE_SENTRY_DSN` | ✅ optional | ❌ | ⚠️ optional | Errors fall back to `console.error`. App boots fine. |
| `SENTRY_AUTH_TOKEN` | ✅ optional | ❌ | ❌ | Sentry stack traces stay minified. |
| `SENTRY_ORG` | ✅ optional | ❌ | ❌ | Same — source maps not uploaded. |
| `SENTRY_PROJECT` | ✅ optional | ❌ | ❌ | Same — source maps not uploaded. |
| `VITE_RELEASE` | ❌ auto | ❌ auto | ❌ optional override | Sentry release tag falls back to `VERCEL_GIT_COMMIT_SHA[:7]` then `'dev'`. |

Sentry is fully optional. The app boots and works without DSN. Set the DSN
on Vercel, and the 3 source-map vars on Vercel, to get full production
debugging. **None** of these belong in CI — CI builds don't deploy.

### Notification digest cron (`/api/notification-digest`, daily 23:00 UTC per `vercel.json`)

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `CRON_SECRET` | ✅ required | ❌ | ❌ | The digest route 401s on **every** run (incl. the Vercel cron) — no emails ever send. Vercel injects this header on scheduled invocations; the route compares it timing-safely. |
| `BREVO_API_KEY` | ✅ required | ❌ | ❌ | Digest cannot send (Brevo API rejects). |
| `DIGEST_TEST_EMAIL` | ✅ test-mode | ❌ | ❌ | If set, **every** digest is rerouted to this one address (real users never emailed) — the safe default for staging. |
| `DIGEST_LIVE` | ✅ `'true'` to go live | ❌ | ❌ | Unset/≠`'true'` **and** no `DIGEST_TEST_EMAIL` → route refuses to send. Real users are emailed only when `DIGEST_LIVE=true` **and** `DIGEST_TEST_EMAIL` is cleared (two deliberate actions). |

The digest is inert by default: it needs `CRON_SECRET` to run at all, and
either `DIGEST_TEST_EMAIL` (test) or `DIGEST_LIVE=true` (live) to send anything.

### Auto-injected by Vercel (do nothing)

| Var | Source | Used for |
|---|---|---|
| `VERCEL_GIT_COMMIT_SHA` | Vercel build env | `VITE_RELEASE` derivation in `vite.config.ts` |
| `VERCEL_ENV` | Vercel build env | (currently unused; available if needed) |

## Where to manage

- **Vercel envs**: Project Settings → Environment Variables.
  Always set Production + Preview + Development unless you know one tier
  shouldn't have it.
- **GitHub Actions secrets**: Repo Settings → Secrets and variables → Actions.
  Currently nothing here — CI uses build-time stubs for VITE vars and doesn't
  need any secrets. If we ever add e2e tests against a real Supabase, this
  is where their creds go.
- **Local `.env`**: `app/.env` (git-ignored). Copy `app/.env.example`,
  fill in values, commit nothing.
- **Shell exports** (for `node scripts/admin-token-mint.mjs` etc.): export
  in your shell only for the duration of the command. Don't `~/.zshrc` the
  service_role key — too easy to leak via screen-share.

## Diagnostic

Quick "is everything wired?" check after a deploy:

```bash
# 1. App loads (frontend reaches Supabase)
curl -I https://caaci-community-marketplace-bazaar.vercel.app

# 2. Admin API responds (uses SUPABASE_SERVICE_ROLE_KEY)
curl -i https://caaci-community-marketplace-bazaar.vercel.app/api/admin?resource=stats \
  -H "Authorization: Bearer iam_admin_<your_token>"
# Expect 200 + JSON. 401 = bad token. 500 = service_role unset.

# 3. Sentry receiving events (use the dashboard, look for events from this 7-char SHA)
git rev-parse --short=7 HEAD
# Then Sentry → Issues, filter release = <that 7-char SHA>
```

## Onboarding new dev

```bash
git clone <repo>
cd app
cp .env.example .env
# Fill VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (ask in #engineering for shared dev creds)
npm install --legacy-peer-deps
npm run dev:h5
```

That's it. Sentry is optional locally. Service role is optional unless they're
running admin scripts.
