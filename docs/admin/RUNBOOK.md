# Admin Runbook

Practical operator guide for the moderation dashboard at
`/#/pages/admin/index`. For architecture see `IMPLEMENTATION_GUIDE.md`. For
manual privacy-rights requests, appeal outcomes, and copyright/content
complaints, use `RIGHTS_AND_CONTENT_REQUESTS.md`.

> Release boundary: this document describes the current release-candidate
> dashboard and API, not a confirmed production deployment. Before operator
> use, verify the deployed H5 route hash, `/api/admin` build, required RPC/token
> migrations, Vercel variables, and an audited test-token login in that exact
> environment.

## First-time setup

You only need to do this once per Vercel project.

1. Do not use the retired `RUN_*_MIGRATION.sql` names; those bundle files are
   not in this repository. A new environment applies the complete ordered
   migration set. The core admin/token chain is 029, 030, 031, 036, 050, 079,
   `20260718170000_require_admin_token_actor.sql`,
   `20260718180000_atomic_admin_mutations.sql`,
   `20260718190000_admin_token_capabilities.sql`, and
   `20260718200000_recoverable_banner_uploads.sql`, followed by
   `20260719010000_admin_token_lifecycle_rpc.sql` and the forward-only
   `20260719020000_admin_owner_recovery_concurrency.sql`, then
   `20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql`,
   `20260722145042_harden_last_active_owner_revoke.sql`, and
   `20260722152000_harden_admin_invalid_auth_amplification.sql`, followed by
   `20260722161200_protect_admin_owner_presentation_signal.sql`;
   later dashboard features also use 073, 075, 077, 078, 080, 081, and 083.
   For the existing production project, first reconcile its ledger and actual
   schema, then use the comprehensive audit's PRECHECK → backup/staging →
   migration → VERIFY path. Do not replay individual files from this list.

   The three final `20260722` migrations are one ordered release tail. Run the 145042
   PRECHECK, apply 145042, and run its VERIFY before running the 152000
   PRECHECK, migration, and VERIFY. Then run the 161200 PRECHECK, migration,
   and VERIFY. The later prechecks intentionally require their recorded
   predecessors and must not be run out of order.

   The actor migration intentionally stops if any historical `admin_tokens`
   row has `admin_id IS NULL`. Do not guess an identity from mutable
   `admin_name` or `admin_email`. Inventory those rows in a controlled session,
   revoke them, independently verify each operator's exact `public.profiles.id`,
   mint attributed replacements, retain required forensic metadata in the
   approved case record, and remove the obsolete NULL rows through a reviewed
   cleanup before retrying the migration.

2. On Vercel → Project → Settings → Environment Variables, add:
   - `SUPABASE_URL` — same as `VITE_SUPABASE_URL`
   - `SUPABASE_SECRET_KEY` — from Supabase → Settings → API Keys → a named secret key
   - `CRON_SECRET` — Vercel Cron bearer secret; also protects hourly abandoned
     banner-upload garbage collection at `/api/banner-upload-gc`
   - `WECHAT_APPSECRET` — Production-only and Sensitive; paste it directly in
     the Vercel console and never place it in chat, source control, build logs,
     or a command line
   - keep an already-deployed `SUPABASE_SERVICE_ROLE_KEY` only as a temporary
     rolling fallback until the provider/client matrix is green; a new
     deployment should not create a dependency on it

3. **For the 2026-07-20 production rollout, deploy bridge → database → final
   Edge in that exact order.** First create a new Production deployment of
   bridge commit `eaeaee9410044c1b07e7922eebd77fffd04d7f72` after the Production
   environment variables are complete, then verify its deployment identity,
   token authorization, reads, and a reversible non-appeal atomic write. The
   bridge uses v1 token authorization plus the atomic mutation dispatcher and
   is compatible with both the pre- and post-migration schemas.

   Pause appeal decisions before the bridge serves production. Next run the
   reviewed `20260720035037` PRECHECK, confirm the backup and rollback evidence,
   apply the migration atomically, and run VERIFY while the bridge remains in
   service. Then deploy and verify the final build that calls
   `admin_token_authorization_v2`, `admin_list_appeals_v2`, and the versioned
   audit RPCs. Environment-variable changes also require a new deployment.

   Once the database advances, `0091b0e` is permanently incompatible with the
   hardened helper ACL and is not a permitted application rollback target.
   Roll back only to the verified bridge; keep appeals paused for the entire
   time the bridge is serving because its old appeal action can lift
   enforcement without recording a terminal structured appeal decision.

4. Mint a unique role-scoped token for each administrator from a trusted shell.
   The regular CLI calls the audited `/api/admin` lifecycle boundary and never
   accepts a Supabase secret/service-role key. It requires an existing owner
   token for the exact deployment. The default is the least-privileged
   moderation `operator`, with a 90-day expiry:

   ```bash
   export ADMIN_API_ORIGIN=https://staging.example.edu
   export ADMIN_TOKEN="<existing-owner-token-from-approved-vault>"
   ADMIN_PROFILE_ID="<verified-public.profiles-id-uuid>"
   node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role operator --expires-days 90 --case-id "SEC-2026-001" --approval-ref "change-1234"
   node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role operator --expires-days 90 --case-id "SEC-2026-001" --approval-ref "change-1234" --output-file /absolute/private/path/admin-token-recovery.json --apply
   ```

   Security-admin and owner issuance require the role to be repeated as a
   deliberate confirmation:

   ```bash
   node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role security_admin --confirm-privileged-role security_admin --expires-days 90 --case-id "SEC-2026-002" --approval-ref "change-1235" --output-file /absolute/private/path/security-admin-recovery.json --apply
   node scripts/admin-token-mint.mjs --admin-id "$ADMIN_PROFILE_ID" --role owner --confirm-privileged-role owner --expires-days 90 --case-id "SEC-2026-003" --approval-ref "change-1236" --output-file /absolute/private/path/owner-recovery.json --apply
   ```

   First run the matching privileged arguments without `--output-file` /
   `--apply`; explicit role confirmation does not replace dry-run review.

   A run without `--apply` performs profile/schema preflight only: it does not
   generate a credential. `--apply` generates exactly one credential into a
   newly created mode-`0600` JSON recovery manifest at an absolute, non-existing
   path in an approved mode-`0700` private vault directory outside every source
   checkout/Git worktree; plaintext is never written to stdout. The CLI resolves
   symlinked ancestors and rejects repository/worktree paths before network or
   credential generation. The manifest contains the token
   and immutable request/idempotency fields, so it is itself a secret. The
   command rejects a malformed ID, and the server checks the
   exact profile and derives its name/email snapshot rather than trusting
   caller-supplied identity text. Operator/security-admin expiry must be 1–365
   days; owner expiry must be 2–365 whole days so issuance cannot create a
   credential inside the database's 24-hour recovery horizon. Independently
   verify the person, profile ID, requested role, expiry, case ID, and approval
   reference through trusted channels before running it. If the response is
   outcome-unknown after the automatic identical retry, retain the manifest and
   run:

   ```bash
   node scripts/admin-token-mint.mjs \
     --resume-file /absolute/private/path/admin-token-recovery.json \
     --apply
   ```

   Use the exact original owner `ADMIN_TOKEN`; the ledger is scoped to that
   actor token, so a replacement token is rejected locally while the manifest
   remains intact. A successful replay is not accepted as lifecycle proof by
   itself: the CLI immediately reconciles the manifest hash against the
   authoritative token row and reports vault success only when the same token ID
   is still attached, unrevoked, and unexpired. A missing, mismatched, revoked,
   expired, detached, or unavailable reconciliation exits nonzero and retains
   the manifest with an explicit do-not-vault instruction. If that original
   token has expired or been revoked, retrieve
   a currently authorized replacement owner token and run the read-only:

   ```bash
   node scripts/admin-token-mint.mjs \
     --reconcile-file /absolute/private/path/admin-token-recovery.json
   ```

   This checks the manifest token hash and exact role/expiry plus attached admin
   ID against the authoritative token row, including inactive rows. A null admin
   ID is accepted only when account deletion already detached and revoked that
   exact row. It prints no plaintext and never deletes the manifest
   automatically. A 409 is also treated as
   outcome-unknown. Do not repeat or
   change the issuance flags, mint another credential, or change the
   idempotency key. Import only a confirmed active token into the approved
   vault. For a revoked, expired, or detached result, record the token ID under
   the case, do not vault the credential, and securely remove the manifest only
   after evidence review.

   Maintain at least two concurrently verified owner tokens during rotation.
   Recovery health counts only a token whose profile still exists, which has
   successfully authorized at least once (`last_used_at` is set), and which has
   no expiry or at least 24 hours remaining. The Tokens tab calls out unverified
   and near-expiry owners separately; neither can recover an outcome. Verify a
   replacement in a separate session against the exact deployment before
   removing the old owner. Use overlapping finite expiries and rotate before the
   warning; non-expiring issuance is not part of the candidate contract. Verify the full token ID and admin ID shown both on the token card
   and inside the revocation evidence panel before confirming revocation.

   Rehearse with a disposable target, staging caller/token, staging case, and
   staging origin first. A production apply requires production-scoped approval,
   exact origin/caller/target/role/expiry review, and an independent second
   reviewer for privileged issuance. If the environment has no valid owner,
   stop and invoke the separately controlled external bootstrap/break-glass
   process. Do not add a service-key or direct-SQL bypass to the regular CLI.

5. After moving the credential from the recovery file into the approved vault,
   visit `https://<your-domain>/#/pages/admin/index`, enter the
   `iam_admin_...` token in the gate, and click Unlock. The token exists only
   in page memory. Refreshing, leaving, closing, or signing out clears it;
   retrieve it from the approved vault when you need a new session.

   The browser may retain an opaque idempotency receipt after a privileged
   write, but never the token or request body. A 2xx is consumed only after the
   UI or authoritative GET is applied. If refresh/transport is uncertain or the
   tab closes first, unrelated writes remain locked. Re-enter a verified owner
   token and use the recovery panel: it performs only the owner-authorized GET
   reconciliation, never another POST. Operators cannot dismiss or bypass this
   evidence barrier.

   The `iam_admin_` prefix is not an automatic GitHub scanning guarantee.
   Configure and verify a repository custom secret pattern for
   `iam_admin_[A-Za-z0-9_-]{43}`, enable push protection where available, and
   test the rule with a synthetic value.

## Token inventory and revocation

Use a valid security-admin or owner token for the exact deployment. The CLI
uses `/api/admin`; do not export a Supabase secret/service-role key:

```bash
export ADMIN_API_ORIGIN=https://staging.example.edu
export ADMIN_TOKEN="<security-admin-or-owner-token-from-approved-vault>"
TOKEN_ID="<exact-token-row-uuid-from-inventory>"
ADMIN_PROFILE_ID="<reviewed-authoritative-profiles-uuid>"
REVOCATION_IDEMPOTENCY_KEY="<new-v4-uuid-recorded-in-approved-case>"

# Current usable credentials only, then the complete lifecycle inventory
node scripts/admin-token-revoke.mjs --list
node scripts/admin-token-revoke.mjs --list --show-inactive

# Cached email is discovery-only; review the authoritative admin_id it returns
node scripts/admin-token-revoke.mjs --email operator@example.edu

# Dry-run and apply one exact row
node scripts/admin-token-revoke.mjs --id "$TOKEN_ID" --case-id "SEC-2026-010" --approval-ref "change-1250"
node scripts/admin-token-revoke.mjs --id "$TOKEN_ID" --case-id "SEC-2026-010" --approval-ref "change-1250" --idempotency-key "$REVOCATION_IDEMPOTENCY_KEY" --apply

# Or dry-run/apply every unrevoked token (active or expired) for one
# authoritative profile UUID
node scripts/admin-token-revoke.mjs --admin-id "$ADMIN_PROFILE_ID" --case-id "SEC-2026-011" --approval-ref "change-1251"
node scripts/admin-token-revoke.mjs --admin-id "$ADMIN_PROFILE_ID" --case-id "SEC-2026-011" --approval-ref "change-1251" --idempotency-key "$REVOCATION_IDEMPOTENCY_KEY" --apply
```

Email apply is deliberately rejected. Snapshot email matching is
case-insensitive; a match spanning multiple `admin_id` values is warned and
each identity must be reviewed separately. Inventory labels `active`, `expired`,
and `revoked` separately. Admin-ID apply includes expired unrevoked rows so
stale credentials receive an audited terminal state. Every apply requires
case/approval metadata; create and record one operation UUID in the approved
case, then pass it with `--idempotency-key`. If the result is unknown,
reconcile/retry only the same request and key. Run a staging rehearsal first; a
production revoke needs production-scoped approval,
verified origin/caller/target, and an independent reviewer when privileged or
last-owner access could be affected.

---

## Daily workflow

### 1. Triage reports

Open the dashboard → **Reports** tab. The default view shows every
report regardless of status, newest first. Click **Open** on a report
to see the full detail.

From the detail sheet you can:
- **Open target** — jumps to the actual item/post page in a new route,
  so you can see what was reported.
- **Open author profile** — jumps to the author's seller profile.
- **Apply ban to author** — opens the 5-level ban picker (see below).

Status transitions:
- `pending` — just arrived, not yet reviewed
- `reviewed` — admin has looked at it
- `resolved` — admin took action (usually a ban)
- `dismissed` — admin decided no action needed

Rule of thumb: never leave a report in `pending` for more than 24h.
Even `dismissed` is better than `pending` because the dashboard stats
(top of screen) highlight pending count.

### 2. Apply bans — the 5-level ladder

Every ban requires a `reason`. The reason is shown to the user on
their `/pages/suspended` page and is the evidence we show on appeal.
Write it as if the banned user will read it — because they will.

| Level | Duration | Use for |
|---|---|---|
| **L1 Account warning** | No time limit; just warning_count++ | First offense, borderline content. This is currently an internal moderation record: the app does **not** guarantee a warning modal or delivery. Use an approved support channel if the user must be notified, and record that contact in the case log. |
| **L2** | 72 hours | Recurring minor offense, mild abuse, repeat spammer. Blocks posts / items / comments / messages during the window. |
| **L3** | 7 days | Deceptive listings (scam attempt), targeted harassment, obvious sockpuppet. Existing public items/posts are hidden from other users only while an L3+ action is currently started, unlifted, and unexpired. Visibility returns automatically at expiry; do not lift an expired action merely to refresh cached state. |
| **L4** | 30 days | Serious abuse, confirmed scam with victim, CSAM-adjacent, repeat L3. Triggers shadow-ban. Shared device fingerprints are only advisory candidates for manual review; they are never automatic proof or an automatic sanction. |
| **L5** | Permanent | CSAM, doxing, credible threats, admin compromise, multi-strike L4. Triggers shadow-ban. No automatic lift; any linked-account action requires separate evidence and a separate audited decision. |

### 3. Decide an appeal

> Availability gate: do not perform any appeal mutation while the production
> bridge is serving, including after a rollback from the final build to that
> bridge. Keep the queue and external case log intact. Enable the actions only
> after `20260720035037` VERIFY succeeds, the exact reviewed final Edge
> deployment is live, and a real administrator has verified the positive
> decision plus restricted-audit flow in that deployment.

Appeals show up in the **Appeals** tab. Each card shows the original
ban reason, the user's appeal text, issued-by info, whether the underlying
action is still active, the authoritative filing time when available, and
whether more information was already requested. Historical appeals that
predate the filing-time column are explicitly labelled unknown and sort ahead
of known FIFO timestamps; never substitute the suspension creation time.

The dashboard supports three reviewed outcomes:

- **Accept** — records the terminal decision and lifts the action only when it
  is still active. Accepting an already expired or already lifted action records
  the decision without recreating or fabricating a lift. When another active
  L2+ suspension still restricts the same profile, the remaining restriction
  stays authoritative; the user receives only the truthful “one action was
  lifted; another restriction remains active” state notice, never the false
  “account restriction lifted” notice.
- **Deny** — records a terminal decision and leaves the enforcement state
  unchanged.
- **More information required** — records a non-terminal request and keeps the
  appeal in the queue so a later reviewer can accept or deny it.

Every action opens a required reason prompt. The reason is written to the
restricted audit ledger. Be specific, factual, and do not copy unrelated PII:

- Good: `First-time offender, apologized, agreed to re-read guidelines`
- Good: `False positive — reporter bulk-reporting competitor listings`
- Bad: `ok` / `fixed` / blank

An appeal can remain in the evidence/review queue after its underlying action
expires. Public visibility/write access has already returned automatically
(unless a different action is active). Continue the approved case-review and
support process; never create a fake lift event merely to clear the queue.

The database rejects an administrator deciding or lifting an action against
their own profile. Transfer that case to another administrator. If the case
raises concern about the administrator's privileged access, handle token
revocation as a separate owner/security action; marketplace suspension and
administrator authorization are intentionally different controls.

The structured decision is **not** a delivery receipt. The app still does not
guarantee an automatic decision notification, and the user can submit only one
in-app appeal per suspension. Accepting a still-active action also triggers the
existing generic in-app **restriction lifted** notification; that message is
not a structured appeal outcome and has no verified support-channel delivery
receipt. Denial, more-information, and acceptance of an already inactive action
do not gain an equivalent automatic decision notice from this workflow. After
every outcome, reply through the verified support channel, record delivery in
the approved case log, and do not close the support case until delivery is
confirmed. Follow
`RIGHTS_AND_CONTENT_REQUESTS.md` for identity, second-review, case-log, and
delivery controls.

### 4. Monitor flagged users proactively

The **Flagged** tab shows users who have any of:
- `warning_count > 0`
- a currently active L3+ visibility action
- a currently active L2+ write restriction

Suspension state and trust score are computed from current action rows rather
than the compatibility cache on `profiles`. Sorted by warning_count DESC,
trust_score ASC — so the most abused
accounts float to the top. Use this to pre-empt: if someone has
warning_count=3 and trust_score=12, one more offense should be an
L3, not another L1.

### 5. Read the audit log

**Audit log** tab is the evidence surface for audited candidate mutations and
server-blocked publish attempts, newest first. Token inventory is a separate
current-state view: `--list --show-inactive` distinguishes active, expired, and
revoked rows but does not prove who approved or performed a lifecycle change.
For issue/revoke, reconcile `token_issued` / `token_revoked` with the actor,
case ID, approval reference, idempotency result, and external approved case
record. Filter the moderation entries mentally by color:

- 🔴 red `ban_applied` — admin action
- 🟢 green `suspension_lifted` — admin action
- 🔵 blue `report_status_changed` — admin action
- 🟠 orange `actor_blocked` — server-side enforcement (user tried to
  post while banned and got rejected)

`actor_blocked` events are noise-free: they only fire when someone is
actively trying to abuse. A burst of them from one user is a strong
signal that they're probing the system for a workaround — consider
escalating their ban level.

---

## Decision tree: what level to ban at

```
First offense?
├── Borderline / ambiguous
│   └── L1 warning (let them recalibrate)
└── Clear-cut
    ├── Annoying (spam, low-quality)
    │   └── L2 (72h)
    ├── Harmful (scam, harassment)
    │   └── L3 (7d) + shadow-ban existing content
    └── Severe (CSAM, doxing, threats)
        └── L5 permanent

Repeat offense?
├── Was L1 → escalate to L2
├── Was L2 → escalate to L3
├── Was L3 → escalate to L4 (review linked candidates manually)
└── Was L4 → L5 permanent
```

Tie-breakers when you're unsure:
- **Victim impact first**: a scam with one confirmed victim > 10 spam
  posts with no victim. L3 vs L2.
- **Intent matters**: a posts-and-deletes accidental rule violation
  doesn't need more than L1. A coordinated evasion attempt is L4.
- **When in doubt, go lower**: appeals are a safety valve. An over-
  ban that gets appealed is recoverable. An under-ban that emboldens
  a bad actor is not.

---

## Troubleshooting

### "Could not find the function public.X in the schema cache"

First distinguish a missing object from a stale PostgREST cache. Check the
production object definition and migration ledger; do not rerun a retired
bundle. If the object exists with the expected signature, issue a controlled
`NOTIFY pgrst, 'reload schema'`. If it is absent or drifted, deploy the specific
reviewed migration through PRECHECK/backup/staging/VERIFY.

### Gate unlock fails with "Wrong key"

Three causes in order of likelihood:
1. The token was copied incorrectly, expired, or was revoked. Tokens are
   exact opaque credentials: do not edit or case-normalize them. Retrieve the
   original from the approved vault. A separately authenticated
   `node scripts/admin-token-revoke.mjs --list --show-inactive` inventory can
   confirm a known token row's lifecycle state, but cannot validate mistyped
   plaintext.
2. Migration 036 or the later token hardening migrations are absent/drifted,
   especially `20260720035037`, so `admin_token_authorization_v2` cannot return
   the exact token ID, expiry, database time, role, and capability contract.
3. `SUPABASE_URL` / `SUPABASE_SECRET_KEY` (and legacy service-role fallback) is missing from the deployed
   API. Fix the server environment and redeploy; `ADMIN_API_KEY` is ignored.

### `suspension_active:N:TS` error when user tries to post

This is the trigger working correctly. The user is banned and their
attempt was blocked. No action needed unless they complain — then
check their suspension detail, check the evidence, and either lift
or leave alone.

### Audit log shows `actor_blocked` bursts from one user

They're probing for a bypass. Consider:
- Raising their ban level (e.g. L2 → L3 so shadow_banned kicks in)
- Checking device_fingerprints for sockpuppets

### A ban was applied via `service_role` directly in SQL editor

Treat this as an audit-control incident, not a normal operator shortcut. Stop
further direct writes, preserve the authorized change/case evidence, reconcile
the affected rows, and have an independent reviewer decide remediation. Routine
admin changes and all token lifecycle changes must go through the capability-
checked, actor-attributed, idempotent `/api/admin` boundary. If that boundary is
unavailable, use only the separately approved external break-glass procedure;
do not improvise with the lifecycle CLI or a service-role key.

### Review a possible linked account

The hardened candidate never sanctions an account merely because it shares a
client-asserted device fingerprint. L4/L5 audit entries include only a count of
recent linked candidates for follow-up. Confirm with independent evidence
(behavior, content, timing, verified account facts), then apply any sanction to
that exact account as a separate dashboard action with its own reason. Never
describe a fingerprint match as proof of identity.

---

## Never do this

- **Don't commit or browser-persist an `iam_admin_...` token.** Keep it in an
  approved vault and paste it into the in-memory gate only when needed. If it
  leaks, revoke that token and mint a replacement; no Vercel shared-key
  rotation is involved.
- **Don't share an admin token over chat.** Per-admin tokens are supported;
  mint a separate token for each operator so actions remain attributable and
  one person's token can be revoked independently.
- **Don't use `x-admin-key` in candidate clients or lifecycle tooling.** Use
  `Authorization: Bearer iam_admin_...`; the legacy header is temporary
  compatibility only.
- **Don't click "Open target" on a permanent-banned user's item.**
  The nav works fine, but your view counts as a "visit" and can
  inflate their item stats. Open in an incognito window if you need
  to verify evidence.
- **Don't apply L5 without screenshots.** The system is designed
  to be appealed. If the user appeals an L5 and you can't remember
  why, you'll be forced to reduce it. Save evidence before banning.
