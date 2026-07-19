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
have distinct companions; the later 19083511 full-FK migration and its stricter
VERIFY are the authoritative release tail and must remain last in version order.

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
