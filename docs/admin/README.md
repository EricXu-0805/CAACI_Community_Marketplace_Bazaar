# Admin docs

> These files describe the release-candidate admin surface. They do not prove
> that production has the same H5/API hashes or RPC/token schema; perform the
> RUNBOOK deployment checks before treating the dashboard as operational.

| File | Audience | When to read |
|---|---|---|
| [RUNBOOK.md](./RUNBOOK.md) | Operators | Daily work — triage reports, apply bans, handle appeals, read audit log |
| [RIGHTS_AND_CONTENT_REQUESTS.md](./RIGHTS_AND_CONTENT_REQUESTS.md) | Operators + privacy/legal reviewer | Manual data access/deletion/correction requests, appeal decisions, and copyright/content complaints |
| [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) | Maintainers | Architecture, RPC surface, security model, how to extend |

## Deploy sequence

Do not use the old `RUN_*_MIGRATION.sql` bundle names; those files are not in
the repository. A new environment must apply the repository's ordered
migrations. On the existing production project, reconcile the migration
ledger/schema first and do not blindly replay this list.

```
supabase/migrations/029_admin_functions.sql
supabase/migrations/030_admin_audit_log.sql
supabase/migrations/031_admin_audit_log_table.sql
supabase/migrations/036_admin_tokens.sql
supabase/migrations/050_lock_down_admin_rpcs.sql
supabase/migrations/079_admin_token_expiry_and_revoke_audit.sql
supabase/migrations/20260718170000_require_admin_token_actor.sql
supabase/migrations/20260718180000_atomic_admin_mutations.sql
supabase/migrations/20260718190000_admin_token_capabilities.sql
supabase/migrations/20260718200000_recoverable_banner_uploads.sql
supabase/migrations/20260719010000_admin_token_lifecycle_rpc.sql
supabase/migrations/20260719020000_admin_owner_recovery_concurrency.sql
supabase/migrations/20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql
supabase/migrations/20260722145042_harden_last_active_owner_revoke.sql
supabase/migrations/20260722152000_harden_admin_invalid_auth_amplification.sql
supabase/migrations/20260722161200_protect_admin_owner_presentation_signal.sql
```

Later admin features also depend on their ordered migrations (073, 075, 077,
078, 080, 081, and 083). The final three `20260722` administrator migrations
must be run in the displayed order: 145042 PRECHECK → migration → VERIFY,
then the corresponding 152000 sequence, then the 161200 sequence. This list
explains ownership; it is not a production
copy/paste runbook. Follow the comprehensive audit's PRECHECK/backup/staging/
VERIFY release path for production.

The release-candidate API needs these Vercel server variables:

| Env var | Source |
|---|---|
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys → named secret key (preferred) |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy rolling fallback only |
| `CRON_SECRET` | Vercel Cron bearer for retention and managed banner-upload GC |
| `SUPABASE_PUBLISHABLE_KEY` | Same component key as `VITE_SUPABASE_PUBLISHABLE_KEY` (used by user-scoped/public routes) |
| `SUPABASE_ANON_KEY` | Legacy rolling fallback only |

There is no `ADMIN_API_KEY` fallback. The Vercel variables above belong to the
deployed API; they are **not** credentials for the regular token lifecycle
CLIs. After the required schema is present, an existing owner issues a separate
token for each operator only through the audited API:

```bash
export ADMIN_API_ORIGIN=https://staging.example.edu
export ADMIN_TOKEN="<existing-owner-token-from-approved-vault>"
ADMIN_PROFILE_ID="<verified-public.profiles-id-uuid>"
node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role operator --expires-days 90 --case-id "SEC-2026-001" --approval-ref "change-1234"
node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role operator --expires-days 90 --case-id "SEC-2026-001" --approval-ref "change-1234" --output-file /absolute/private/path/admin-token-recovery.json --apply
```

This defaults to `operator` and 90 days. Operator/security-admin expiry is
1–365 days; owner expiry is 2–365 whole days so every newly issued owner starts
outside the database's 24-hour recovery horizon.
Privileged issuance must repeat the requested role:

```bash
node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role security_admin --confirm-privileged-role security_admin --expires-days 90 --case-id "SEC-2026-002" --approval-ref "change-1235" --output-file /absolute/private/path/security-admin-recovery.json --apply
node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role owner --confirm-privileged-role owner --expires-days 90 --case-id "SEC-2026-003" --approval-ref "change-1236" --output-file /absolute/private/path/owner-recovery.json --apply
```

For either privileged command, first run the same reviewed arguments without
`--output-file` / `--apply`; do not skip dry-run because the role is explicit.

Without `--apply`, the command performs preflight and generates no credential.
With `--apply`, it creates a mode-`0600` recovery/output file and never writes
the `iam_admin_...` plaintext to stdout. `--output-file` must be an absolute,
non-existing path in an approved mode-`0700` private vault directory **outside
this repository and every other source checkout/Git worktree**. The CLI resolves
symlinked ancestors and rejects source/worktree paths before any network request
or plaintext generation. The JSON manifest contains the credential plus immutable
request/idempotency fields and is itself a secret. The server confirms the exact
`public.profiles` row and derives the name/email snapshot from it; the CLI
rejects caller-supplied name/email. Independently verify the operator before
granting that profile administrator capability. Case ID, approval reference,
actor, identity snapshot, result, idempotency, and required audit commit through
the same transaction. An outcome-unknown response retains the manifest; resume
the exact operation with the exact original owner `ADMIN_TOKEN` (the ledger is
scoped to that actor token) using
`--resume-file /absolute/private/path/admin-token-recovery.json --apply`, without
repeating or changing issuance flags. A different issuer or any 409 keeps the
manifest. Even a successful replay must pass the CLI's immediate authoritative
hash reconciliation: only the same attached, unrevoked, unexpired token ID is
reported as vaultable; missing, mismatched, inactive, detached, or unavailable
state exits nonzero and keeps the manifest. If the original owner token has
expired or been revoked, a currently
authorized replacement owner must run the read-only
`--reconcile-file /absolute/private/path/admin-token-recovery.json` mode. It
compares only the manifest token hash with authoritative token lifecycle state,
validates exact role/expiry and the attached admin ID, and accepts a null admin
ID only for an already-revoked account-deletion detachment. It never prints
plaintext and leaves the file intact on no match or malformed/unavailable
state. Import only a confirmed active token into the approved vault. A revoked,
expired, or detached result proves the issuance committed but is unusable: record
the token ID under the case, do not vault the credential, and securely remove
the local manifest after evidence review. Visit
`/#/pages/admin/index` and paste it into the gate for that page session; the UI
keeps it in memory only and never persists it in browser storage.

The dashboard persists only opaque write receipts (hashed intent ID, UUID
idempotency key, and timestamps), never the token or request body. A normal 2xx
result is acknowledged only after the affected UI state or an authoritative GET
has been applied. If the page closes, the refresh fails, or the transport result
is uncertain, the receipt remains and unrelated writes fail closed. Unlock with
a verified owner to run the read-only reconciliation GET and acknowledge an
exact completed result; an operator cannot reconcile it, and recovery never
sends a replacement POST.

Revoke uses `ADMIN_API_ORIGIN` plus an existing security-admin/owner
`ADMIN_TOKEN` and the same audited `/api/admin` boundary. Inventory distinguishes
active, expired, and revoked. Email is an issuance-time snapshot and therefore
case-insensitive dry-run discovery only; multiple matching admin IDs are
reported for separate review. Apply by exact token ID or authoritative admin ID with
case, approval, and an explicit case-recorded idempotency key. Admin-ID revoke
includes active and expired unrevoked rows. Inventory is not audit history: use
the Audit log and approved case record for lifecycle evidence.

Keep at least two verified owner tokens overlapping through rotation. A token is
recovery-capable only after a successful authorization has set `last_used_at`,
its attached profile is still active, and it has no expiry or at least 24 hours
remaining. Unverified and near-expiry owner tokens are shown separately and do
not count toward recovery health. Verify the replacement in a separate session
against the exact deployment before revoking/expiring the old owner. Each token card and the
revocation evidence panel display the authoritative token ID and admin ID so
operators can verify the exact target before submitting a destructive action.

Rehearse lifecycle changes with disposable tokens against a controlled staging
origin. Production issue/revoke requires a production-scoped approval, verified
origin/caller/target, and independent review when privileged access or owner
continuity is affected. If no valid owner exists, stop: initial bootstrap is a
separately controlled external break-glass procedure, not a reason to add a
service-key/direct-SQL bypass to the regular scripts.

The `iam_admin_` prefix is not itself a GitHub scanning guarantee. Configure a
custom secret pattern for `iam_admin_[A-Za-z0-9_-]{43}`, verify secret scanning
and push protection in repository settings, and test the rule with a synthetic
value.

## Endpoints

| Path | Purpose | Auth |
|---|---|---|
| `/api/admin` | Admin dashboard data surface (GET resource=... / POST action=...) | Candidate clients use `Authorization: Bearer iam_admin_...`; `x-admin-key` is temporary backward-compatibility only and must not be used by new operator tooling |
| `/api/banner-upload-gc` | Leased deletion of abandoned/detached managed banner objects | Vercel Cron `CRON_SECRET` |
| `/api/realtime-poll` | Long-poll for mp chat (~1s latency) | User's Supabase JWT |
| `/api/translate` | AI translation proxy | User's Supabase JWT |
| `/api/moderate` | AI content moderation proxy | User's Supabase JWT |
| `/api/share`, `/api/share-post` | OG meta pages for shared links | None (public) |

## Threat model quick reference

| Threat | Control |
|---|---|
| Stolen user session reaches admin surface | Per-admin bearer is separate from user JWT |
| Admin token leaked | Revoke that token row and mint a replacement; no shared-key rotation/redeploy |
| SQL injection in admin RPCs | All RPCs are PL/pgSQL or SQL function with typed params |
| Malicious admin lifts their own bans | Every lift recorded in `admin_audit_log` with actor_id |
| Ban evasion via alt account | Fingerprint matches produce advisory candidates for independent manual review; each account action needs separate evidence and an audited decision |
| Shadow content leaks or stays hidden after expiry | Base `items` / `posts` SELECT RLS and share views resolve current L3+ action rows at read time; the owner still sees their own rows |
| User tries to post while banned | `trg_enforce_actor` resolves current action rows and blocks active L2+ writes; expired cached fields do not decide |
