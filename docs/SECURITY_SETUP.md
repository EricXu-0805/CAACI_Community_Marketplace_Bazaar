# Security setup — historical context and current release gates

> **Do not use this file as a production paste-run checklist.** It originally
> described the one-off activation of historical migrations 023–027. The live
> project state must be reconciled against the current migration ledger before
> every release. The 2026-07 candidate adds a reviewed timestamped tail; a file
> existing in Git is not deployment evidence. Start with [`audit/README.md`](audit/README.md),
> [`../RUNBOOK.md`](../RUNBOOK.md), and [`../ENV_CHECKLIST.md`](../ENV_CHECKLIST.md).

## 1. Current database deployment discipline

Never paste historical migrations into the production SQL Editor, run a blind
`supabase db push`, or drop triggers as an ad-hoc rollback. A migration filename
in the repository is not evidence that production has the same definition.

For an existing environment, use the release sequence in `RUNBOOK.md`:

1. inventory the migration ledger and exact live object/grant/policy definitions;
2. run the matching read-only `supabase/_ops/PRECHECK_*.sql` files;
3. take a tested backup and rehearse the full ordered chain in isolated staging;
4. apply only the reviewed unique timestamped candidate migrations;
5. run every matching VERIFY and rollback-transaction REGRESSION bundle;
6. canary API/client compatibility and observe auth, Realtime, Storage, cron,
   provider and admin audit behavior before any production window.

Rollback is a reviewed release decision: prefer a forward fix or a proven
backup restore plan. Do not use a partial `DROP TRIGGER` recipe that leaves
schema, grants, functions and clients in mutually inconsistent generations.

Historical migrations 023–027 introduced banners, keyword moderation, consent,
trust/suspension fields and their first RPC/trigger versions. Those names are
useful provenance only. Later migrations supersede several definitions, so
their present behavior must be verified from the current candidate and live
catalog rather than from this historical description.

## 2. OpenAI moderation configuration

`/api/moderate` is an authenticated, rate-limited server route. With no
`OPENAI_API_KEY`, the optional provider layer is explicitly disabled; once
configured, provider timeout, malformed output and service failures fail closed
so the client can retry. The database keyword/ACL/RLS boundaries remain the
authoritative write guard.

Provisioning rules:

- create least-privilege, separately revocable server keys per environment;
  keep the production key in Production scope only, use a staging-only key in
  a trusted branch/custom Preview environment, and give arbitrary PR previews
  no provider key; never expose it through `VITE_*`;
- confirm current provider pricing, quota, data handling and incident ownership
  in the provider console instead of relying on an old “free” claim;
- use the normal reviewed staging deployment workflow. Do not create an empty
  commit or push merely to trigger an unreviewed production redeploy;
- verify first with a dedicated staging user JWT and benign fixtures. Do not
  probe production or send sensitive test text without authorization.

Example staging contract check (use a disposable staging account and keep the
token out of shell history/log artifacts):

```bash
curl -i -X POST "$STAGING_ORIGIN/api/moderate" \
  -H "Authorization: Bearer $STAGING_USER_JWT" \
  -H 'Content-Type: application/json' \
  --data '{"text":"campus marketplace test"}'
```

Expected success is a bounded documented JSON contract. `401/403` means the
caller identity/authorization is invalid; a stable `503`/retryable response is
not permission to bypass moderation or write directly to Supabase.

## 3. Moderation layers and failure boundaries

| Layer | Where | Boundary |
|---|---|---|
| Length/contact/local keyword | client | fast user feedback; never a trust boundary by itself |
| Duplicate/session checks | client | reduces accidental replay; server/database still enforce writes |
| OpenAI moderation | authenticated Vercel route | optional when unconfigured; fail-closed once configured |
| Database keyword/actor triggers | Supabase | authoritative content/actor enforcement |
| ACL + RLS + RPC ownership | Supabase | prevents direct Data API bypass and cross-account writes |

Provider health must be observed independently. A green client response does
not prove symbolication, alert routing, quota, or the database trigger layer.

## 4. Keyword and policy changes

Treat moderation lexicon edits as production data/config changes:

- propose the exact term/category/severity delta with an owner and false-positive
  review;
- apply and test it in staging with bilingual allow/block fixtures;
- deploy through an audited admin/migration path with a reversible change record;
- verify counts and behavior without copying user content into logs;
- monitor appeals/false positives and deactivate through the same controlled
  path. Do not run casual production `INSERT`/`UPDATE` statements from this doc.

The current release decision, production Advisor snapshot, provider gates and
administrator role matrix live in the dated audit, not in historical setup
notes.
