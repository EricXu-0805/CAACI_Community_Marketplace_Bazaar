# Database operation files

The `PRECHECK_*`, `VERIFY_*`, and `REGRESSION_*` files are the reviewed
companions to timestamped migrations in `../migrations/`. Run them only in the
order and environment described by the root `RUNBOOK.md`.

Every `PRECHECK_*` and `VERIFY_*` file is an enforced read-only transaction:
`ON_ERROR_STOP` + `BEGIN` + `SET TRANSACTION READ ONLY` + final `ROLLBACK`.
`scripts/database-operations-boundary.test.mjs` rejects an operation file that
loses that shape. `REGRESSION_*` files may create synthetic fixtures, but must
remain rollback-only and are limited to disposable local/staging environments.

The migration filenames and exact SQL bytes are covered by
`../migrations/manifest.sha256` and
`scripts/migration-version-boundary.test.mjs`. The one reviewed exception was
the DB-01 repair below: duplicate 014/015 files made a clean Supabase branch
impossible because the ledger version, not the full filename, is unique. That
repair is now frozen too. Do not edit, rename, or delete any canonical migration
again to make a ledger match; add a later, unique 14-digit UTC forward migration
and reconcile the target ledger explicitly.

`20260719020000_admin_owner_recovery_concurrency.sql` deliberately has its own
`PRECHECK_20260719020000_admin_owner_recovery_concurrency.sql`: the earlier
19010000 precheck must run before 19010000 and correctly refuses an installed
lifecycle tail. The 19030000 and deterministic-pagination 19082600 migrations
have distinct companions. The 19083511 full-FK migration and its stricter
VERIFY remain the authoritative FK tail, but they are no longer the literal
last migration: 19151729 is a later, narrowly scoped Plaza ACL reconciliation,
followed by 19164126's managed Realtime Authorization policy reconciliation,
19170019's exact meetup ACL reconciliation, and 19174928's trigger-only
function ACL reconciliation. The later strict tail is 20035037 appeal/session
hardening, 22024000 WeChat replay protection, 22033904 legacy convergence,
22080918 exact auth-RLS initplan optimization, 22081137 in-place `pg_trgm`
relocation, and 22081141 authenticated-function surface hardening. On a clean
ledger, keep normal version order. The 22080918, 22081137, and 22081141
REGRESSION files remain
rollback-only local/staging evidence; the `pg_trgm` migration must preserve the
four existing GIN index OIDs, and the function-surface VERIFY pins the 18
intentional authenticated SECURITY DEFINER RPCs rather than weakening their
underlying table/RLS boundaries to silence an advisor.
The first reviewed exception is a production database already stopped after
18160000 by the exact Plaza ACL drift documented in the root `RUNBOOK.md`:
there, a ledger-aware executor may record the exact missing 19151729 repair
early, must then fill every lower missing version explicitly, and must rerun
19151729 VERIFY after 18280000 reconciles the wider application ACL inventory.
The exception never advances 19164126: apply it only in the normal final
position after every lower version. Its PRECHECK/VERIFY accept Supabase's
owner-issued, non-grantable S/I/U baseline on `realtime.messages` but reject
PUBLIC, column grants, another grantor, grant options, inheritance, dangerous
non-RLS privileges and PG17 MAINTAIN. It also fails closed if authenticated
loses any policy dependency: the three projected conversation columns, schema
USAGE for public/auth/private/realtime, or EXECUTE for auth.uid(),
realtime.topic() and the private pair-access helper. Its REGRESSION is
rollback-only local/staging evidence and must never run in production.

The second reviewed exception is a production database stopped between
18250000 and 18260000 only because historical `public.meetups` table grants
still expose the server-owned reminder state. After the 19170019 PRECHECK, a
ledger-aware executor may install and record that exact migration early, then
rerun the 18260000 PRECHECK. It must not mark 19164126 or any other lower
missing version as applied. Rerun 19170019 VERIFY after 18280000, and at the
normal tail confirm the exact early ledger row instead of replaying it.

Files whose names begin with `RUN_` are historical one-off dashboard bundles.
They remain in the repository as drift and incident-recovery evidence, but are
deliberately fail-closed because replaying one after the current migration chain
can restore obsolete function bodies or privileges. They are not a deployment
shortcut.

`LOCAL_BOOTSTRAP_*` files are fixtures for disposable local PostgreSQL replay
only. They must never be run against staging or production.

## 20260808040313 bounded fingerprint eviction (historical DB239-S1/S2 gate)

`PRECHECK_20260808040313_evict_oldest_device_fingerprint_instead_of_failing.sql`,
the matching `VERIFY` and `REGRESSION`, and
`LOCAL_BOOTSTRAP_20260808040313_device_fingerprint_eviction.sql` are the
reviewed gate for replacing the obsolete 21st-hash error with deterministic
least-recently-seen eviction. The forward migration is intentionally
function-only and refuses any target that already has more than 20 rows for a
profile. It never authorizes bulk cleanup of historical fingerprint data.

Run the rollback-only REGRESSION only after the new function is installed on a
disposable local PostgreSQL database. It proves 20 -> 20 replacement,
five-minute deduplication, invalid/unauthenticated rejection, over-cap
fail-closed behavior, profile isolation, and zero Auth-session creation. It is
not a deployment rollback: its `bigserial` `nextval()` calls are not undone by
`ROLLBACK`, so it is forbidden on hosted staging and production.
The script also refuses to start unless the local connection was opened with
`PGOPTIONS='-c caaci.local_fingerprint_regression=20260808040313-disposable-fingerprint-regression'`.

The staging database gate is narrower: run the read-only PRECHECK, apply the
exact migration once through the official ledger-aware migrations endpoint,
then run the read-only VERIFY and compare the pre/post fingerprint, profile,
and Auth-session counts plus row-set digests. The migration itself must change
no existing row. Protected-account smoke is a separate, later gate because it
will intentionally invoke the new function. At the time of this gate,
production over-cap cleanup and Auth-session retention were separate future
changes. That wording is retained as historical approval scope, not as a
statement of current production state; neither operation may ever be inferred
from a successful staging migration.

## 20260811140018/20260811143207 fingerprint-churn forward fix

These two migrations are one reviewed safety sequence but two separate ledger
entries. `20260811140018_bound_device_fingerprint_churn.sql` first installs a
temporary write-quiescence bridge: a recent same-hash call stays a no-op, while
every call that would perform a physical fingerprint write returns fail-fast
`PT429 fingerprint_write_deferred`. The bridge performs no fingerprint,
profile, or Auth business DML and creates one private, single-use cutover row.

Use the exact companions for each phase:

- `PRECHECK_20260811140018_bound_device_fingerprint_churn.sql`, matching
  `VERIFY`, `REGRESSION`, and
  `LOCAL_BOOTSTRAP_20260811140018_device_fingerprint_churn.sql`;
- `PRECHECK_20260811143207_install_device_fingerprint_churn_limiter.sql`,
  matching `VERIFY`, `REGRESSION`, and
  `LOCAL_BOOTSTRAP_20260811143207_device_fingerprint_churn_limiter.sql`.

For any hosted target, pause browser fingerprint calls and all service/admin
direct fingerprint or profile writes. Run the 140018 PRECHECK, apply 140018 once
through the official ledger-aware endpoint, then run its independent VERIFY.
Do not run protected smoke while the bridge is installed. Wait at least 65
seconds, then run the 143207 PRECHECK twice at least five seconds apart. Both
results must show `bridge_age_seconds >= 65`, `active_rpc_rows = 0`, and
`matching_advisory_rows = 0`. Only then apply 143207 once through the same
ledger-aware endpoint and run its independent VERIFY. A failed or ambiguous
response consumes that attempt: inspect read-only state and stop; never use raw
`psql`, hand-write the ledger, or retry automatically.

An exact-empty data-plane fast path keeps newly-created Preview replay
deterministic: only when `auth.users`, `auth.identities`, `auth.sessions`,
`auth.refresh_tokens`, `public.profiles`, and `public.device_fingerprints` are
all exactly empty may the embedded 143207 precheck accept a non-future,
just-installed bridge without waiting. Supabase applies seed data after
migration replay, and this repository has no seed file. The SQL proves this
empty state, not Preview provenance: an existing or used branch does not
qualify merely because it is called Preview. The exception is not available
through the hosted companion PRECHECK and operationally never replaces the
65-second/two-census gate on any target with a row in one of those six tables.

The final limiter uses a try-advisory lock plus NOWAIT row locks, permits at
most one physical write per profile every five minutes and at most five new
hashes per rolling 24 hours, and keeps rejected requests free of row locks. At
20 rows it rewrites the exact LRU row in place, preserving its id and sequence;
19-to-20 uses one INSERT; more than 20 fails closed. The final migration removes
the single-use cutover table. The client does not retry and treats only exact
`PT429` messages `fingerprint_busy`, `fingerprint_write_deferred`, and
`fingerprint_rate_limited` as expected deferrals.

Both REGRESSION and LOCAL_BOOTSTRAP pairs are disposable-local PostgreSQL
evidence only. Never run them on hosted staging or production: rollback does
not undo every sequence effect. Staging and production require separate exact
approvals and evidence bundles.

## DB-01 repaired legacy duplicate versions

The historical inventory had two version collisions:

- `014_condition_defective.sql` / `014_image_dimensions.sql`;
- `015_content_i18n.sql` / `015_plaza_item_tag.sql`.

Supabase's `supabase_migrations.schema_migrations` ledger has one row per
numeric version. The production ledger already records
`014=condition_defective` and `015=content_i18n`; production also already has
the image-dimension columns. A clean Preview branch, however, executed the
second 014 SQL and then failed when it tried to insert another version-014 row.

The reviewed repair deliberately creates one canonical file for each version:

- `014_condition_defective.sql` now also creates the `items` and `posts`
  `image_dimensions` columns required by later migrations;
- `015_content_i18n.sql` remains canonical;
- obsolete `015_plaza_item_tag.sql` is not replayed because migration 041
  replaced its single `attached_item_id` with `public.post_items`.

The original duplicate bytes are retained, byte-for-byte, outside the migration
runner at:

- `forensics/legacy-version-collisions/014_image_dimensions.sql.frozen`
  (`sha256=e9ca084686661d2842981e66298a6cb3dab9c4bc2e0a7947a4fc896526ff3002`);
- `forensics/legacy-version-collisions/015_plaza_item_tag.sql.frozen`
  (`sha256=fca3f3941ee49f3041fb0a50a1a564199326b41caffbb8681d9bacea0c4df114`).

`20260722033904_reconcile_legacy_migration_versions.sql` is the forward-only
compatibility repair for already-ledgered databases. Its dedicated read-only
`PRECHECK_20260722033904_reconcile_legacy_migration_versions.sql` reports table
size, NULL/backfill work, invalid i18n/JSON values, and every legacy-linkage
risk. If `posts.attached_item_id` still exists, the migration locks the
replacement, rejects any missing-item, cross-owner, or cap conflict, inserts
only missing `(post_id,item_id)` pairs through migration 041's live FK/cap
contract, and proves every legacy pair exists before dropping the old column.
`VERIFY_20260722033904_reconcile_legacy_migration_versions.sql` then proves the
canonical columns/constraints, RLS, ledger row and obsolete-object removal.
The existence of `public.post_items` alone is never treated as data-migration
evidence.

不要把取证副本移回 `migrations/`，也不要再次改写 canonical 历史。All future
schema changes must use 唯一的 14 位时间戳迁移；the manifest and boundary test
freeze the repaired inventory and the forensic hashes.

## Reviewed historical byte divergence

Two frozen migration files required narrowly reviewed repository repairs after
their versions had already appeared in hosted ledgers: canonical 014 absorbed
the colliding image-dimension shape, and 19151729 accepted PostgreSQL 17's
equivalent composite-row deparser order. The target databases are
schema-convergent but byte-divergent from the pre-repair repository history.
Supabase's migration ledger does not store SQL content hashes, so a version row
must never be presented as proof that either exact byte sequence ran. The
manifest protects the current replay bytes only; PRECHECK/VERIFY and forward
convergence establish the hosted schema outcome.

The immediately preceding reviewed repository bytes are retained at:

- `forensics/reviewed-history-repairs/014_condition_defective.sql.pre-collision-repair.frozen`
  (`sha256=3786a03b60787aa1b3a8642f6656d4b6971a174a7afa3339c5f009a631595a29`);
- `forensics/reviewed-history-repairs/20260719151729_reconcile_plaza_base_table_acl.sql.pre-pg17-replay-repair.frozen`
  (`sha256=2232d8b5c9739974db2a667e175880f59dde89d301c4a7a58362d83b1dd96620`).

These are evidence, not runnable migrations. Never restore them into the
migration runner or use them to rewrite a hosted ledger.
