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
`scripts/migration-version-boundary.test.mjs`. Never edit, rename, or delete an
already frozen migration to make a ledger match; add a later, unique 14-digit
UTC forward migration and reconcile the target ledger explicitly.

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

## DB-01 frozen legacy duplicate versions

The historical migration inventory contains two already-published version
collisions:

- `014_condition_defective.sql` and `014_image_dimensions.sql`;
- `015_content_i18n.sql` and `015_plaza_item_tag.sql`.

不要直接重命名已经上线的文件。Reconcile each environment's migration
ledger first, then repair only with a new, unique 14-digit UTC version. Every
forward migration after the frozen history must use 唯一的 14 位时间戳迁移；
the byte manifest and boundary tests prevent rewriting either legacy file.
