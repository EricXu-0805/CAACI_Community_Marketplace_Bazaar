# Admin docs

| File | Audience | When to read |
|---|---|---|
| [RUNBOOK.md](./RUNBOOK.md) | Operators | Daily work — triage reports, apply bans, handle appeals, read audit log |
| [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) | Maintainers | Architecture, RPC surface, security model, how to extend |

## Deploy sequence

Four SQL bundles, run in order in Supabase SQL Editor, first time only:

```
supabase/migrations/RUN_ONBOARDING_MIGRATION.sql     (if not already applied)
supabase/migrations/RUN_ADMIN_MIGRATION.sql
supabase/migrations/RUN_ADMIN_AUDIT_MIGRATION.sql
supabase/migrations/RUN_AUDIT_LOG_MIGRATION.sql
```

Then on Vercel:

| Env var | Source |
|---|---|
| `ADMIN_API_KEY` | `openssl rand -hex 32` — keep secret |
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role |
| `SUPABASE_ANON_KEY` | Same as `VITE_SUPABASE_ANON_KEY` (used by `/api/realtime-poll`) |

Redeploy after setting env vars — edge functions don't pick them up
otherwise. Then visit `/#/pages/admin/index` and unlock with the
`ADMIN_API_KEY`.

## Endpoints

| Path | Purpose | Auth |
|---|---|---|
| `/api/admin` | Admin dashboard data surface (GET resource=... / POST action=...) | `x-admin-key` header |
| `/api/realtime-poll` | Long-poll for mp chat (~1s latency) | User's Supabase JWT |
| `/api/translate` | AI translation proxy | None (CORS-locked) |
| `/api/moderate` | AI content moderation proxy | None (CORS-locked) |
| `/api/share`, `/api/share-post` | OG meta pages for shared links | None (public) |

## Threat model quick reference

| Threat | Control |
|---|---|
| Stolen user session reaches admin surface | Admin key is separate from user JWT |
| Admin key leaked | Rotate via Vercel env + redeploy |
| SQL injection in admin RPCs | All RPCs are PL/pgSQL or SQL function with typed params |
| Malicious admin lifts their own bans | Every lift recorded in `admin_audit_log` with actor_id |
| Ban evasion via alt account | L4+ auto-bans device_fingerprint siblings from last 90d |
| Content re-appears after shadow ban | `items_visible` / `posts_visible` views filter at read time |
| User tries to post while banned | `trg_enforce_actor` BEFORE INSERT trigger blocks + audits |
