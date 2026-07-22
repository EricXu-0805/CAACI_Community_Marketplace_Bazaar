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
function ACL reconciliation. On a clean ledger, keep normal version order and
run all four after 19083511.
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
