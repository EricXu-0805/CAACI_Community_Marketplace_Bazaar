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

### Stripe subscriptions (migration 043)

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | ✅ | ❌ | ⚠️ shell-only | `api/subscriptions` + admin cancel/refund return 500. Checkout/portal unavailable. |
| `STRIPE_WEBHOOK_SECRET` | ✅ | ❌ | ⚠️ shell-only | `api/stripe/webhook` returns 500 / rejects all events — DB never syncs. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | ✅ optional | ❌ | ❌ | Billing Portal uses your Stripe default configuration. |

Server-side only — **never** VITE-prefixed, never in the browser bundle. Notes:

- **Webhook endpoint**: in the Stripe Dashboard add a webhook to
  `https://<deploy>/api/stripe/webhook` and subscribe to:
  `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
  `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`.
  Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
- **Plans**: each row in `subscription_plans` references a Stripe Price via
  `stripe_price_id`. CAACI creates the Product + Price in Stripe, then fills
  `stripe_price_id` (via the admin `upsert_plan` action). No price/secret is
  hard-coded.
- **Local testing**: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
  prints a temporary signing secret — export it as `STRIPE_WEBHOOK_SECRET` for
  the dev session.

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
