# Environment variable checklist

Where each env var lives, who needs to set it, and what happens if it's
missing. Sorted by criticality.

## TL;DR — Vercel-only vs everywhere

- **Vercel-only** (server-side, never exposed to browser): the secrets.
  `SUPABASE_SECRET_KEY` (preferred; legacy fallback
  `SUPABASE_SERVICE_ROLE_KEY`), `SENTRY_AUTH_TOKEN`, `CRON_SECRET`,
  `RESEND_API_KEY`, `OPENAI_API_KEY`, `WECHAT_APPSECRET`,
  `WECHAT_PUSH_TOKEN`, and any future RPC secret. The retired shared
  `ADMIN_API_KEY` is not read by the current API and should be unset.
- **Vercel + local `.env`**: VITE-prefixed public build configuration.
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (preferred; legacy
  fallback `VITE_SUPABASE_ANON_KEY`), optional
  `VITE_SENTRY_DSN`, `VITE_BASE_URL`, and `VITE_SUPPORT_EMAIL`.
- **Every trusted Vercel deployment (non-secret assertions)**:
  `DEPLOYMENT_EXPECTED_VERCEL_ENV` and `SUPABASE_EXPECTED_PROJECT_REF`; Production
  also requires `DEPLOYMENT_APP_ORIGIN`. Preview derives its unique current
  origin from auto-injected `VERCEL_URL`; an optional explicit Preview origin
  must match it exactly. Missing or contradictory values stop the build and make
  every Supabase-backed Function return 503 before it can send a key or bearer
  upstream.
- **GitHub Actions**: build jobs use publishable-key Supabase stubs; the smoke
  job reads `VITE_SUPABASE_URL` plus `VITE_SUPABASE_PUBLISHABLE_KEY` (preferred)
  or `VITE_SUPABASE_ANON_KEY` (legacy fallback) from Actions secrets and
  optionally reads `SMOKE_EMAIL` / `SMOKE_PASSWORD` for its read-only
  authenticated sweep.
- **Auto-derived, do not set**: `VITE_RELEASE` is derived from
  `VERCEL_GIT_COMMIT_SHA` at build time. Override only if you need a
  custom release name.

> **Supabase key-transition warning (July 2026):** the local candidate now
> implements dual-generation header semantics. Put new keys in the new variable
> names above; do not overwrite an old variable and assume the rollout is done.
> Do not paste an `sb_publishable_...` value into `VITE_SUPABASE_ANON_KEY`, or
> an `sb_secret_...` value into `SUPABASE_SERVICE_ROLE_KEY`: the new component
> keys are not drop-in JWT replacements even where Supabase offers transition
> compatibility. The Vite build now fails if either public variable contains an
> `sb_secret_...` key or a legacy JWT declaring `role=service_role`; never
> bypass that guard.
> Real-provider staging across H5, mini-program, PostgREST, Auth, Storage,
> Realtime, scripts, and crons is still a launch blocker. Keep legacy keys
> enabled until both the matrix and the shipped-client inventory are green.
> See the public audit index in `docs/audit/README.md` and the incident
> procedure in `RUNBOOK.md`; detailed environment findings stay in the private
> operational handoff until disclosure is approved.

## The full list

### Required for the app to work at all

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | ✅ stub (build) / secret (smoke) | ✅ | App can't reach Supabase. White screen. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ preferred | ✅ stub (build) / secret (smoke) | ✅ preferred | New public component key. If it and the legacy fallback are both missing, the app cannot initialize Supabase. |
| `VITE_SUPABASE_ANON_KEY` | ⚠️ legacy fallback | ⚠️ smoke fallback | ⚠️ legacy fallback | Keep only for rolling support of already-shipped clients; plan removal after the real-provider/client-version matrix. |
| `SUPABASE_SECRET_KEY` | ✅ preferred | ❌ | ⚠️ shell-only | Admin、账号注销、短期数据清理、邮件、审核等 server functions 返回 500/503 when neither privileged key is set. |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ legacy fallback | ❌ | ⚠️ shell-only | JWT-shaped legacy fallback; do not disable in Supabase until old integrations/clients are inventoried. |
| `SUPABASE_URL` | ✅ recommended | ❌ | ⚠️ shell-only | Server functions fall back to `VITE_SUPABASE_URL`; setting the server-side alias avoids relying on a browser-prefixed var. |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ recommended | ❌ | ⚠️ optional | Server-side alias for user-scoped/anonymous routes; preferred over legacy anon and VITE fallbacks. |
| `SUPABASE_ANON_KEY` | ⚠️ legacy fallback | ❌ | ⚠️ optional fallback | Server functions use it only when `SUPABASE_PUBLISHABLE_KEY` is absent. |
| `DEPLOYMENT_EXPECTED_VERCEL_ENV` | ✅ required, exact tier | ❌ | ❌ except `vercel dev` rehearsal | Operator assertion (`production`, `preview`, or `development`) must equal auto-injected `VERCEL_ENV`; prevents a credential set copied into the wrong tier from silently running. |
| `SUPABASE_EXPECTED_PROJECT_REF` | ✅ required, exact 20-char ref | ❌ | ⚠️ for `vercel dev` | Both `SUPABASE_URL` and `VITE_SUPABASE_URL` must resolve exactly to `https://<this-ref>.supabase.co`; arbitrary HTTPS hosts and wrong Supabase projects fail before upstream work/build output. |
| `DEPLOYMENT_APP_ORIGIN` | ✅ Production required; Preview optional | ❌ | ⚠️ for local API/share rehearsal | Production canonical origin. Preview derives the exact current origin from auto-injected `VERCEL_URL`; if this variable is set in Preview it must match that host exactly. Share responses use the validated origin and Preview remains `noindex`. No path/query/credentials. |
| `SHARE_SITE_URL` | ❌ legacy alias | ❌ | ⚠️ local compatibility only | Legacy local/test alias for share-card URLs. Hosted deployments use the validated deployment origin; this variable cannot bypass the deployment boundary. |
| `VITE_BASE_URL` | ✅ required for non-H5 artifacts | ✅ non-production stub (build) | ✅ required for non-H5 | Exact HTTPS origin for mp API/share/reset URLs. Missing/malformed values stop the mp build before an artifact is emitted and never fall back to production; H5 stays on `window.location.origin`. |
| `VITE_SUPPORT_EMAIL` | ✅ optional | ❌ | ⚠️ optional | Legal-page contact falls back to `help@illinimarket.com`. |
| `NOMINATIM_BASE_URL` | ✅ optional | ❌ | ⚠️ optional | Reverse geocoding uses the public Nominatim endpoint by default. Set an HTTPS Nominatim-compatible endpoint to switch providers without a client release. |

> **GH Actions split**: type/build jobs do not contact Supabase and use
> `https://ci-stub.supabase.co` / `sb_publishable_ci-stub-key`. The separate smoke job
> does contact the configured project, so it reads the two public Supabase
> values from Actions secrets. Do not describe a green build-only job as a
> production-backend E2E result.

### Admin API auth

There is **no shared admin-key environment variable**. `/api/admin` accepts
only a per-admin `iam_admin_...` bearer token whose SHA-256 hash exists in
`public.admin_tokens` (migration 036). The old `ADMIN_API_KEY` path has been
removed and the variable is ignored; delete it from Vercel if it still exists.

Mint and revoke tokens with `scripts/admin-token-mint.mjs` and
`scripts/admin-token-revoke.mjs`. These regular lifecycle CLIs do **not** read
`SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`; they call the audited
candidate API with the following shell-only values:

| Var | Vercel | GH Actions | Local shell | Purpose / rule |
|---|---|---|---|---|
| `ADMIN_API_ORIGIN` | ❌ | ❌ | ✅ required for lifecycle CLI | Exact target origin. HTTPS is required except loopback rehearsal. Staging and production values must never be reused interchangeably. |
| `ADMIN_TOKEN` | ❌ | ❌ | ✅ required for lifecycle CLI | Existing owner token for issue; security-admin or owner token for revoke. Retrieve temporarily from an approved vault; never store in `.env`, shell startup files, CI, logs, or command arguments. |

Issuance takes an authoritative `profiles.id`; the server derives the
name/email snapshot from that row. It requires case/approval/idempotency
metadata and a 90-day default expiry. Operator/security-admin accept 1–365 days;
owner accepts 2–365 whole days and the database also requires more than 24 hours
of recovery life. Apply mode never writes
plaintext to stdout and uses an absolute, exclusively created mode-`0600` JSON
recovery manifest. The manifest contains both the token and immutable request
metadata and is itself a secret. If an outcome is unknown, retain it and run
`--resume-file <same-absolute-path> --apply` with the exact original owner
`ADMIN_TOKEN`; the manifest rejects a different issuer token and is retained
for controlled reconciliation. Conflicts (409) are outcome-unknown and never
delete the only plaintext. After confirmed success, vault the credential and
securely remove the local manifest. Revocation goes
through the same audited `/api/admin` boundary; email selection is dry-run
only and case-insensitive, and multiple matching admin IDs trigger a warning;
apply targets an exact token ID or one reviewed authoritative admin ID. Token
inventory reports `active`, `expired`, and `revoked` separately and is not a
substitute for the Audit log/case record.

Paste the plaintext token into the admin gate for the current page session
only. The UI keeps it in memory and clears it on refresh, navigation away,
close, or sign-out; never put it in `localStorage` / `sessionStorage`. Keep any
needed backup in an approved vault. The `iam_admin_` prefix is only a detectable
format: configure and test a GitHub custom secret pattern and verify repository
secret scanning/push protection rather than assuming the prefix is caught.

Run a disposable-token staging rehearsal before any production lifecycle
change. Production issue/revoke requires an approved case/change, target
origin/caller/identity/role/expiry review, and an independent second reviewer
when privileged access or last-owner continuity is involved. The first-owner
bootstrap is an external controlled break-glass gate; neither regular CLI may
bypass it with a Supabase key or direct SQL.

### Observability (Sentry)

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `VITE_SENTRY_DSN` | ✅ optional | ❌ | ⚠️ optional | Errors fall back to `console.error`. App boots fine. |
| `SENTRY_AUTH_TOKEN` | ✅ optional | ❌ | ❌ | Sentry stack traces stay minified. |
| `SENTRY_ORG` | ✅ optional | ❌ | ❌ | Same — source maps not uploaded. |
| `SENTRY_PROJECT` | ✅ optional | ❌ | ❌ | Same — source maps not uploaded. |
| `SENTRY_UPLOAD_SOURCEMAPS` | ❌ auto/optional | ❌ | ❌ one-command override | Remote Vercel deploys use the injected commit SHA. Set this to `true` only for an intentional manual upload with an explicit `VITE_RELEASE`; local `vercel build` otherwise stays read-only toward Sentry. |
| `VITE_RELEASE` | ❌ auto | ❌ auto | ❌ optional override | Sentry release tag falls back to `VERCEL_GIT_COMMIT_SHA[:7]` then `'dev'`. |
| `SENTRY_DSN` | ✅ optional | ❌ | ❌ | Admin audit-write failures and digest server-side errors only log to Vercel; falls back to `VITE_SENTRY_DSN`. |

Sentry is fully optional. The app boots and works without DSN. Set the DSN
on Vercel, and the 3 source-map credentials on Vercel, to get full production
debugging. Remote deploys supply the commit identity automatically; a local
`vercel build` will not upload. **None** of these belong in CI — CI builds don't deploy.

### Notification digest cron (`/api/notification-digest`, daily 23:00 UTC per `vercel.json`)

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `CRON_SECRET` | ✅ required | ❌ | ❌ | The digest route 401s on **every** run (incl. the Vercel cron) — no emails ever send. Vercel injects this header on scheduled invocations; the route compares it timing-safely. |
| `RESEND_API_KEY` | ✅ required | ❌ | ❌ | Digest、meetup 即时邮件和 Illini 验证码都无法发送。 |
| `DIGEST_TEST_EMAIL` | ✅ test-mode | ❌ | ❌ | If set, **every** digest is rerouted to this one address (real users never emailed) — the safe default for staging. |
| `DIGEST_LIVE` | ✅ `'true'` to go live | ❌ | ❌ | Unset/≠`'true'` **and** no `DIGEST_TEST_EMAIL` → route refuses to send. Real users are emailed only when `DIGEST_LIVE=true` **and** `DIGEST_TEST_EMAIL` is cleared (two deliberate actions). |
| `DIGEST_FROM` | ✅ required for verified sender | ❌ | ❌ | Falls back to `Illini Market <noreply@send.illinimarket.com>`; Resend must verify that domain/address. |
| `DIGEST_APP_URL` | ✅ required for live mail | ❌ | ❌ | Must be an explicit HTTPS **origin only** (no path/query/credentials). Live digest and meetup mail fail closed when it is absent/invalid; a hosted preview must match `VERCEL_URL`. Synthetic test mail alone may use the harmless sample default. |
| `MEETUP_APP_URL` | ⚠️ optional live override | ❌ | ❌ | Exact HTTPS origin for meetup mail; falls back only to the explicitly configured `DIGEST_APP_URL`, never to an implicit live production URL. |

`DEPLOYMENT_APP_ORIGIN` is the deployment-wide preferred value and wins over
the two legacy mail-specific aliases above. Keep the aliases only during a
reviewed transition; they cannot bypass the shared deployment boundary.

The digest is inert by default: it needs `CRON_SECRET` to run at all, and
either `DIGEST_TEST_EMAIL` (test) or `DIGEST_LIVE=true` plus an explicit safe
`DIGEST_APP_URL` (live) to send anything.

### Account-deletion recovery cron (`/api/auth/delete-account`, every 10 minutes per `vercel.json`)

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `CRON_SECRET` | ✅ required | ❌ | ⚠️ shell-only for local API tests | Scheduled recovery returns 503/401, so a deletion interrupted after Storage or Auth will remain pending. The initial POST still fails safely before any side effect when its durable job cannot be created. |
| `SUPABASE_SECRET_KEY` | ✅ preferred | ❌ | ⚠️ shell-only | The privileged job table and Storage/Auth/WeChat cleanup cannot run when neither secret nor legacy service role is set. |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ legacy fallback | ❌ | ⚠️ shell-only | Rolling fallback only. |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ recommended | ❌ | ⚠️ optional | User-initiated POST cannot validate the caller JWT when no public/publishable fallback exists; cron recovery does not need this key. |
| `SUPABASE_ANON_KEY` | ⚠️ legacy fallback | ❌ | ⚠️ optional fallback | Used only when the publishable aliases are absent. |

Deploy `supabase/migrations/20260717194646_account_deletion_jobs.sql` **before**
deploying the API change, then run
`supabase/_ops/VERIFY_20260717_account_deletion_jobs.sql`. Until that migration
is present, the POST capability probe returns 503 before touching Storage,
Auth, or the WeChat map. Once a job is persisted, transient cleanup failures
return `202 pending`; the app signs out and this cron resumes the monotonic
`requested → storage_deleted → auth_deleted → completed` checkpoints. Every
job row, including `completed`, is retained as a deletion tombstone: the same
migration installs restrictive `item-images` INSERT/UPDATE policies so an old
access JWT cannot upload after deletion starts. The worker also verifies
Storage again after Auth deletion before it may clean WeChat state and finish.
Treat any failure to create those Storage policies as a deployment blocker.

### Ephemeral-data retention cron (`/api/data-retention`, hourly at minute 17 UTC per `vercel.json`)

| Var | Vercel | GH Actions | Local `.env` | If missing |
|---|---|---|---|---|
| `CRON_SECRET` | ✅ required | ❌ | ⚠️ shell-only for API tests | Route returns retryable 503/401 and no cleanup runs. The endpoint accepts only an exact Bearer scheme and compares the secret timing-safely. |
| `SUPABASE_URL` | ✅ recommended | ❌ | ⚠️ shell-only | Falls back to `VITE_SUPABASE_URL`; a missing/malformed or non-HTTPS production URL fails closed before any request. |
| `SUPABASE_SECRET_KEY` | ✅ preferred | ❌ | ⚠️ shell-only | The privileged cleanup RPC cannot be invoked when neither secret nor legacy service role is set; no table is touched. |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ legacy fallback | ❌ | ⚠️ shell-only | Rolling fallback only. |

Deploy and verify
`supabase/migrations/20260718150000_ephemeral_data_retention.sql` **before**
enabling this route, using its matching `_ops/PRECHECK`, `_ops/VERIFY`, and
isolated/local `_ops/REGRESSION` scripts. The no-argument RPC uses fixed
cutoffs and deletes at most 1,000 rows per relation per transaction. One API
run performs at most five sequential RPC batches under a 20-second total
deadline, so one hourly invocation can remove at most 5,000 eligible rows per
relation (120,000/day theoretical ceiling):

- `edge_rate_limits` buckets whose `window_start` is at least seven days old
  (the database already rejects rate-limit windows longer than seven days);
- expired pending `illini_verifications` rows;
- dead `wechat_media_checks` callback mappings older than seven days.

This cron deliberately does **not** delete or define a retention promise for
reports, moderation evidence, suspensions/appeals, account-deletion tombstones,
or admin audit logs. Those records require a separately approved legal and
product policy. A non-2xx/malformed/timeout RPC result or remaining eligible
backlog after five batches returns 503 + `Retry-After: 600`; treat that as an
operational failure, not a successful partial cleanup. If eligible row creation
ever approaches 5,000/hour for a relation, this bounded worker cannot catch up;
page on the repeated 503 and redesign capacity instead of silently raising an
unbounded delete.

### Optional AI and WeChat services

| Var | Vercel | GH Actions | Local | If missing |
|---|---|---|---|---|
| `OPENAI_API_KEY` | ✅ optional | ❌ | ⚠️ shell-only | Remote moderation/translation provider is skipped; local/database safety layers remain. |
| `WECHAT_APPID` | ✅ for mp login/security | ❌ | ⚠️ shell-only | WeChat login returns 503; media classifier degrades after authentication. |
| `WECHAT_APPSECRET` | ✅ for mp login/security | ❌ | ⚠️ shell-only | Same; server-only and never browser-prefixed. |
| `WECHAT_PUSH_TOKEN` | ✅ for callback | ❌ | ⚠️ shell-only | `/api/wechat-callback` cannot authenticate WeChat push callbacks. |

The full WeChat provisioning and rotation constraints live in
[`docs/WECHAT_MP_SETUP.md`](docs/WECHAT_MP_SETUP.md). In particular, do not
rotate an in-use legacy password salt without a migration plan.

### Auto-injected by Vercel (do nothing)

| Var | Source | Used for |
|---|---|---|
| `VERCEL` | Vercel build/runtime | Required platform-identity marker for hosted Production/Preview Functions. |
| `VERCEL_GIT_COMMIT_SHA` | Vercel build env | `VITE_RELEASE` derivation in `vite.config.ts` |
| `VERCEL_ENV` | Vercel build/runtime | Compared with `DEPLOYMENT_EXPECTED_VERCEL_ENV`; also tags client/server Sentry events as `production`, `preview`, or `development`. |
| `VERCEL_URL` | Vercel build/runtime | Source of the exact dynamic Preview origin. A malformed value, or a mismatch with an optional explicit `DEPLOYMENT_APP_ORIGIN`, fails closed. |

### Supabase Auth — manual dashboard setup (not env vars)

These live in the Supabase dashboard, not Vercel, so they're easy to forget.
A wrong Redirect URL silently breaks password reset + OAuth on day 1.

| Setting | Where (Supabase dashboard) | Value |
|---|---|---|
| Site URL | Auth → URL Configuration | `https://illinimarket.com` |
| Redirect URLs | Auth → URL Configuration | add `https://illinimarket.com/**` |
| Email confirmation | Auth → Providers → Email | **ON** — signup returns no session until confirmed; the app expects this |
| Password policy | Auth → Policies | At least 8 characters + upper/lower/digit/symbol. Current production leaked-password (HIBP) protection is **OFF** and Security Advisor reports it; on Pro or above enable it before launch rather than treating the finding as accepted. |
| Reset-password email | Auth → Email Templates → Reset Password | body uses `{{ .Token }}` (6-digit code, **not** the link) **and** Email OTP length = 6 (Auth → Providers → Email). The app's reset is a typed code (QA6 #138). Leave **Confirm signup** on the link. |

Verify reset works end-to-end before launch (use a `+alias`, never a real user):

```bash
curl -X POST https://lfhvgprfphyfvhidegum.supabase.co/auth/v1/recover \
  -H "apikey: <PUBLISHABLE_OR_LEGACY_ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"reset-qa+<run-id>@<verified-test-domain>"}'
# Replace the synthetic placeholder above with a dedicated, owned QA inbox;
# never use a personal address or a real user's address.
# You'll receive a 6-digit CODE (not a link). Enter it on the app's reset
# screen with a new password → should sign you in. Record this staging run;
# historical QA6 #138 is not evidence that the current candidate/provider passes.
# Requires the Reset Password template = {{ .Token }} and OTP length = 6.)
```

## Pre-launch checklist (Fall 2026 beta)

Before inviting the first cohort. Details for each var are in the tables above.

**Vercel → public/build variables (Production and trusted Preview, with each
environment's exact origin/project):**

- [ ] `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — preferred current pair; keep `VITE_SUPABASE_ANON_KEY` only as the tested rolling fallback for old clients
- [ ] `DEPLOYMENT_EXPECTED_VERCEL_ENV`, `SUPABASE_EXPECTED_PROJECT_REF` — exact tier/project assertions; set them separately in Production and only the reviewed trusted Preview environment. Production also requires exact `DEPLOYMENT_APP_ORIGIN`; Preview normally uses auto-injected `VERCEL_URL` and only needs an explicit origin when deliberately pinning it to that same host
- [ ] `VITE_BASE_URL` — set the exact environment origin for every non-H5 Preview/Production artifact; the mp build must exit non-zero when it is absent/malformed, while H5 remains same-origin
- [ ] `SUPABASE_PUBLISHABLE_KEY` — use the same environment's public project; keep legacy `SUPABASE_ANON_KEY` only as that environment's rolling fallback
- [ ] `VITE_SENTRY_DSN` — use an environment-specific public DSN when error visibility is enabled

**Privileged server variables (strictly environment-scoped):**

- [ ] Production: `SUPABASE_SECRET_KEY`, legacy `SUPABASE_SERVICE_ROLE_KEY` fallback, `CRON_SECRET`, `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`, `OPENAI_API_KEY`, and `WECHAT_APPSECRET` exist **only** in Production scope and point to production resources
- [ ] Trusted Preview/staging: use a separate staging Supabase project and separately revocable staging provider keys; restrict them to an allowlisted reviewed branch/custom environment. An untrusted or arbitrary-branch Preview receives no privileged variables
- [ ] Deployment gate is green: Vite refuses tier/project/origin drift; all 19 Supabase-backed Functions return 503 before upstream work on drift; the deployed project has 20 runtime Functions in total including the non-Supabase custom 404 boundary; `deployment-manifest.json` records a non-secret artifact identity
- [ ] `SENTRY_ORG` + `SENTRY_PROJECT` accompany the environment-specific Sentry credentials when source maps are intentionally published
- [ ] `DIGEST_FROM` is a verified test sender in staging and the reviewed production sender in Production; Resend is also used by meetup mail and Illini verification
- [ ] Apply + verify `20260717194646_account_deletion_jobs.sql`, including its restrictive Storage tombstone policies; the same `CRON_SECRET` authorizes its 10-minute recovery cron
- [ ] Apply + verify `20260718150000_ephemeral_data_retention.sql`; confirm the hourly `/api/data-retention` cron returns 200 (a 503 backlog/error is not green)
- [ ] `OPENAI_API_KEY` — optional and environment-specific (content moderation; safe to skip for a soft launch)
- [ ] For the 2026-07-20 release, WeChat is a production gate: `WECHAT_APPID`,
  environment-specific `WECHAT_APPSECRET`, and `WECHAT_PUSH_TOKEN` must be
  present in their reviewed scopes; `WECHAT_APPSECRET` must be Sensitive and
  Production-only. Create a new exact-commit Production deployment after the
  variable is saved—an older deployment cannot prove the new environment
  snapshot—and complete the legacy-password retirement runbook in
  `docs/WECHAT_MP_SETUP.md` only after the provider canary succeeds.

**Supabase dashboard (manual, above):**

- [ ] Site URL + Redirect URLs set, reset-password tested end-to-end
- [ ] Email confirmation ON; strong password policy confirmed; leaked-password protection enabled when the plan supports it

**Digest — keep OFF for the beta unless you've prepped it.** Going live later is
three deliberate actions: clear `DIGEST_TEST_EMAIL`, set `DIGEST_LIVE=true`, and
set an explicit HTTPS-origin-only `DIGEST_APP_URL` (plus `MEETUP_APP_URL` only
when meetup links intentionally use a different origin). Before
flipping: verify the Resend sender domain (DKIM/SPF) or mail lands in spam, and
confirm the current Resend plan/rate limits rather than relying on an old vendor quota.
(Digest email is already **bilingual inline** — zh primary + en in one message;
per-user locale is an optional refinement, not a blocker.)

**After deploy:** run the [Diagnostic](#diagnostic) block — expect app 200, admin 200,
and Sentry receiving events tagged with the deploy's 7-char SHA.

## Where to manage

- **Vercel envs**: Project Settings → Environment Variables. Public build values
  may be set per matching tier. Privileged secrets are never copied across all
  tiers: Production uses production-only scope; trusted Preview uses isolated
  staging resources and a reviewed branch/custom environment; untrusted Preview
  and Development receive no production or staging privileged secret.
- **GitHub Actions secrets**: Repo Settings → Secrets and variables → Actions.
  Build jobs use stubs. The PR-capable public smoke job expects only
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (preferred) with
  `VITE_SUPABASE_ANON_KEY` as the legacy fallback. Put `SMOKE_EMAIL`,
  `SMOKE_PASSWORD`, and both synthetic attestations **only** in the protected
  `staging-smoke` Environment, never as repository secrets; that main-only job
  also requires reviewed Environment variables
  `SMOKE_EXPECTED_SUPABASE_PROJECT_REF` and `SMOKE_EXPECTED_USER_ID`. Missing or
  mismatched configuration fails red; after login the browser session UUID must
  equal the reviewed synthetic account. The job uploads no browser artifacts. Never store a service-role or admin bearer token
  in Actions for either smoke job.
- **Local `.env`**: `app/.env` (git-ignored). Copy `app/.env.example`,
  fill in values, commit nothing.
- **Direct local Function rehearsal outside `node --test`**: export
  `CAACI_LOCAL_DEV=true` only in a non-production shell with no Vercel identity.
  Hosted deployments and `NODE_ENV=production` cannot use this bypass. A
  `vercel dev` rehearsal instead supplies the three exact deployment assertions.
- **Shell exports for admin lifecycle CLIs**: set the exact
  `ADMIN_API_ORIGIN` and temporarily retrieve `ADMIN_TOKEN` from the approved
  vault. The mint/revoke scripts deliberately reject the old privileged-key
  path. Do not put an admin token or secret/service-role key in `.env`,
  `~/.zshrc`, CI, a command argument, or a screen-shareable terminal history.
- **Other privileged maintenance scripts**: when their own runbook explicitly
  requires it, export `SUPABASE_SECRET_KEY` only for that command's lifetime;
  the legacy service-role variable is rolling compatibility, not a default.

## Diagnostic

Quick "is everything wired?" check after a deploy:

```bash
# 1. App loads (frontend reaches Supabase)
curl -I https://illinimarket.com

# 2. Admin API responds. The deployed server owns its privileged Supabase key;
#    the operator supplies only the per-admin Bearer.
curl -i https://illinimarket.com/api/admin?resource=stats \
  -H "Authorization: Bearer iam_admin_<your_token>"
# Expect 200 + JSON. 401 is limited to malformed or authoritatively invalid
# credentials. Missing privileged configuration, unavailable v2 auth RPCs, or
# other authentication-upstream failures return retryable 503 auth_unavailable.

# 3. Sentry receiving events (use the dashboard, look for events from this 7-char SHA)
git rev-parse --short=7 HEAD
# Then Sentry → Issues, filter release = <that 7-char SHA>

# 4. If deploying a local prebuilt output, verify its public identity first.
# All four values are non-secret but must describe the reviewed candidate.
PREBUILT_EXPECTED_VERCEL_ENV=preview \
SUPABASE_EXPECTED_PROJECT_REF=<20-char-staging-ref> \
DEPLOYMENT_APP_ORIGIN=https://<reviewed-preview-host> \
PREBUILT_EXPECTED_GIT_SHA=<full-reviewed-commit-sha> \
node scripts/verify-prebuilt-deployment.mjs
# A CI/local stub artifact is marked deployable=false and must be rebuilt,
# never promoted with `vercel deploy --prebuilt`.
```

## Onboarding new dev

```bash
git clone <repo>
cd app
cp .env.example .env
# Fill VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (or the temporary legacy anon fallback)
npm install --legacy-peer-deps
npm run dev:h5
```

That's it. Sentry is optional locally. Admin lifecycle scripts need a scoped
admin bearer and API origin, never a Supabase service-role key.
