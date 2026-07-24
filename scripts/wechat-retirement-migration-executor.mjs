#!/usr/bin/env node
/**
 * Fail-closed release executor for the one intentionally deferred WeChat
 * credential-retirement migration.
 *
 * Safe default: Supabase CLI dry-run only. Apply requires an exact target ref,
 * an exact confirmation phrase, an exact one-migration dry-run, an intact
 * manifest-pinned migration set, and the reviewed CLI binary. The child CLI
 * receives bounded startup options as defense in depth; because CLI 2.95.4
 * resets session GUCs before each migration, the guarded target reasserts its
 * transaction-local timeouts before either ledger or target-table locks.
 *
 * This wrapper is deliberately specific. It does not accept an arbitrary
 * command and must not be replaced by an API migration call whose database
 * session settings and atomic migration-ledger write cannot be attested.
 */

import { createHash, X509Certificate } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const ROOT = new URL('../', import.meta.url)
const MIGRATION_BASENAME =
  '20260718140000_retire_wechat_password_credentials'
const MIGRATION_FILE = `${MIGRATION_BASENAME}.sql`
const CONVERGENCE_MIGRATION_BASENAME =
  '20260722194923_converge_wechat_retirement_rpc_only'
const CONVERGENCE_MIGRATION_FILE =
  `${CONVERGENCE_MIGRATION_BASENAME}.sql`
const EXPECTED_MIGRATION_DIGEST =
  'f2e3653df0be6e83b3d7d904696c2c4e088ae2df061332fb5108ad21ce4a2a32'
const EXPECTED_NORMALIZED_MIGRATION_DIGEST =
  'b5f07a4b98b4ca5df4bd32cfbc10c7e005ee969066f0d94f2bb4c8eae0558044'
const EXPECTED_HARDENED_MIGRATION_DIGEST =
  '79ab7cafb4fda74226ec273cd18be9371d04774a66ef7e34dcee388482312058'
const EXPECTED_GUARDED_EXECUTION_DIGEST =
  'PENDING_GUARDED_RETIREMENT_DIGEST'
const EXPECTED_CONVERGENCE_MIGRATION_DIGEST =
  'PENDING_CONVERGENCE_MIGRATION_DIGEST'
const EXPECTED_MANIFEST_DIGEST =
  'PENDING_MIGRATION_MANIFEST_DIGEST'
const EXPECTED_MIGRATION_COUNT = 133
const EXPECTED_REMOTE_LEDGER_COUNT = 108
const EXPECTED_INTERMEDIATE_LEDGER_COUNT = 109
const EXPECTED_FINAL_LEDGER_COUNT = 110
const EXPECTED_EXECUTION_MIGRATION_COUNT = 110
// These 51 repository versions are not Production ledger versions. Twenty-six
// have reviewed hosted-version aliases below; the rest are schema-convergence
// history that must never be presented to `db push` as pending Production SQL.
const LOCAL_ONLY_NON_TARGET_FILES = new Set([
  '041_post_items_join_table.sql',
  '042_handle_new_user_oauth_fullname.sql',
  ...Array.from({ length: 46 }, (_, index) => {
    const version = String(44 + index).padStart(3, '0')
    const names = {
      '044': 'rate_limit_window_buffer', '045': 'bio_pii_moderation',
      '046': 'currency_exchange_daily_cap', '047': 'storage_block_active_mime',
      '048': 'message_type_video', '049': 'moderation_word_boundary',
      '050': 'lock_down_admin_rpcs', '051': 'offers', '052': 'meetups',
      '053': 'seller_response_rate', '054': 'listing_type_wanted',
      '055': 'notification_emailed_at', '056': 'notifications_realtime',
      '057': 'function_privilege_hardening', '058': 'fix_delete_my_account_uid_ambiguity',
      '059': 'revoke_offer_rpcs_from_anon', '060': 'search_items_fuzzy_listing_type',
      '061': 'meetup_reschedule_dupeguard_reminder', '062': 'search_posts_fuzzy',
      '063': 'reschedule_meetup_dupeguard', '064': 'messages_update_column_lockdown',
      '065': 'notify_item_sold_from_reserved', '066': 'saved_search_listing_type',
      '067': 'moderate_profile_nickname', '068': 'storage_list_lockdown',
      '069': 'email_digest_optout', '070': 'unread_message_reminder',
      '071': 'remove_currency_exchange', '072': 'illini_email_verification',
      '073': 'admin_takedown_content', '074': 'report_dedup_and_grouping',
      '075': 'admin_takedown_comments', '076': 'notify_on_suspension_change',
      '077': 'admin_search_users', '078': 'report_detail_thumbnail',
      '079': 'admin_token_expiry_and_revoke_audit', '080': 'dashboard_oldest_pending',
      '081': 'admin_linked_accounts', '082': 'edge_rate_limit',
      '083': 'admin_plaza_controls', '084': 'profiles_column_lockdown',
      '085': 'meetup_state_and_comment_count', '086': 'banner_default_fallback',
      '087': 'wechat_media_checks', '088': 'moderation_status_guard',
      '089': 'moderation_nfkc_normalize',
    }
    return `${version}_${names[version]}.sql`
  }),
  '20260722145042_harden_last_active_owner_revoke.sql',
  '20260722152000_harden_admin_invalid_auth_amplification.sql',
  '20260722161200_protect_admin_owner_presentation_signal.sql',
])
const REMOTE_LEDGER_ALIASES = Object.freeze([
  { remoteVersion: '20260610051549', remoteName: 'currency_exchange_daily_cap', canonicalName: '046_currency_exchange_daily_cap.sql' },
  { remoteVersion: '20260610051622', remoteName: 'storage_block_active_mime', canonicalName: '047_storage_block_active_mime.sql' },
  { remoteVersion: '20260610052821', remoteName: 'message_type_video', canonicalName: '048_message_type_video.sql' },
  { remoteVersion: '20260610070328', remoteName: '049_moderation_word_boundary', canonicalName: '049_moderation_word_boundary.sql' },
  { remoteVersion: '20260610074447', remoteName: '050_lock_down_admin_rpcs', canonicalName: '050_lock_down_admin_rpcs.sql' },
  { remoteVersion: '20260610105651', remoteName: 'offers', canonicalName: '051_offers.sql' },
  { remoteVersion: '20260611070731', remoteName: 'meetups', canonicalName: '052_meetups.sql' },
  { remoteVersion: '20260611074306', remoteName: 'meetups_revoke_anon_exec', canonicalName: null },
  { remoteVersion: '20260611081126', remoteName: 'seller_response_rate', canonicalName: '053_seller_response_rate.sql' },
  { remoteVersion: '20260611110828', remoteName: 'seller_response_rate_handle_delete', canonicalName: null },
  { remoteVersion: '20260611113104', remoteName: 'listing_type_wanted', canonicalName: '054_listing_type_wanted.sql' },
  { remoteVersion: '20260611120448', remoteName: 'notification_emailed_at', canonicalName: '055_notification_emailed_at.sql' },
  { remoteVersion: '20260612040723', remoteName: '056_notifications_realtime', canonicalName: '056_notifications_realtime.sql' },
  { remoteVersion: '20260612151855', remoteName: 'function_privilege_hardening', canonicalName: '057_function_privilege_hardening.sql' },
  { remoteVersion: '20260613014057', remoteName: 'fix_delete_my_account_uid_ambiguity', canonicalName: '058_fix_delete_my_account_uid_ambiguity.sql' },
  { remoteVersion: '20260613211743', remoteName: '059_revoke_offer_rpcs_from_anon', canonicalName: '059_revoke_offer_rpcs_from_anon.sql' },
  { remoteVersion: '20260613211820', remoteName: '060_search_items_fuzzy_listing_type', canonicalName: '060_search_items_fuzzy_listing_type.sql' },
  { remoteVersion: '20260615032902', remoteName: 'meetup_reschedule_dupeguard_reminder', canonicalName: '061_meetup_reschedule_dupeguard_reminder.sql' },
  { remoteVersion: '20260615044304', remoteName: 'search_posts_fuzzy', canonicalName: '062_search_posts_fuzzy.sql' },
  { remoteVersion: '20260615072758', remoteName: 'reschedule_meetup_dupeguard', canonicalName: '063_reschedule_meetup_dupeguard.sql' },
  { remoteVersion: '20260615114247', remoteName: '064_messages_update_column_lockdown', canonicalName: '064_messages_update_column_lockdown.sql' },
  { remoteVersion: '20260615114323', remoteName: '065_notify_item_sold_from_reserved', canonicalName: '065_notify_item_sold_from_reserved.sql' },
  { remoteVersion: '20260615114347', remoteName: '066_saved_search_listing_type', canonicalName: '066_saved_search_listing_type.sql' },
  { remoteVersion: '20260615114410', remoteName: '067_moderate_profile_nickname', canonicalName: '067_moderate_profile_nickname.sql' },
  { remoteVersion: '20260615114453', remoteName: '069_email_digest_optout', canonicalName: '069_email_digest_optout.sql' },
  { remoteVersion: '20260722163412', remoteName: '20260722145042_harden_last_active_owner_revoke', canonicalName: '20260722145042_harden_last_active_owner_revoke.sql' },
  { remoteVersion: '20260722163454', remoteName: '20260722152000_harden_admin_invalid_auth_amplification', canonicalName: '20260722152000_harden_admin_invalid_auth_amplification.sql' },
  { remoteVersion: '20260722163545', remoteName: '20260722161200_protect_admin_owner_presentation_signal', canonicalName: '20260722161200_protect_admin_owner_presentation_signal.sql' },
].map(entry => Object.freeze(entry)))
const EXPECTED_REMOTE_VERSION_SET_DIGEST =
  'ed34d5f714acf5a05d8f2085cf66d1568071589132efc7debce383f6d2cf3d45'
const EXPECTED_REMOTE_IDENTITY_SET_DIGEST =
  'ee470c4438ea3efeafcd226e82defd8415c47f539aae030c8a6a2c14118ea5f8'
const EXPECTED_ALIAS_MAPPING_DIGEST =
  '411c79b96a2715e96f8de7954badf92389bfe0ddb4da5051c4ca29d75f24fa01'
// Digest of 108 exact Production-version execution-deny guards plus the
// guarded retirement target and byte-identical forward convergence target. It
// is intentionally not the 133-file canonical replay.
const EXPECTED_EXECUTION_SET_DIGEST =
  'PENDING_EXECUTION_SET_DIGEST'
const PRODUCTION_PROJECT_REF = 'lfhvgprfphyfvhidegum'
const REVIEWED_POOLER_HOST = 'aws-1-us-east-1.pooler.supabase.com'
const REVIEWED_POOLER_PORT = '5432'
const APPLY_CONFIRMATION =
  'APPLY_WECHAT_RETIREMENT_CONVERGENCE_20260722194923'
const PRIVILEGED_FREEZE_CONFIRMATION =
  'PRIVILEGED_DDL_ACL_FREEZE_ACTIVE'
const BOUNDED_PGOPTIONS = '-c lock_timeout=5s -c statement_timeout=2min'
const PINNED_CLI_PATH =
  '/opt/homebrew/Cellar/supabase/2.95.4/bin/supabase'
const PINNED_CLI_VERSION = '2.95.4'
const PINNED_CLI_DIGEST =
  '6d0f911ff159fd1e8fa125df475acfeadfc76bd7431f60904ab6ceaca95020c8'
// Filled only after the Production project CA is downloaded from the
// authenticated Supabase Database Settings page and independently reviewed.
// An empty value intentionally keeps the real executor fail-closed.
const PINNED_PRODUCTION_CA_FINGERPRINT256 = ''
const CLI_TIMEOUT_MS = 3 * 60 * 1000
const ANSI_ESCAPE_RE = /\u001B\[[0-?]*[ -/]*[@-~]/g
const MINIMAL_CONFIG = `project_id = "caaci-wechat-retirement-20260718140000"

[db]
major_version = 17

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = false
sql_paths = []
`

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

const MINIMAL_CONFIG_DIGEST = sha256(MINIMAL_CONFIG)

export function transactionNormalizedRetirementMigration(source) {
  const original = Buffer.isBuffer(source) ? source : Buffer.from(source)
  if (sha256(original) !== EXPECTED_MIGRATION_DIGEST) {
    throw new Error('retirement_migration_reviewed_digest_mismatch')
  }
  const text = original.toString('utf8')
  const beginLines = [...text.matchAll(/^BEGIN;$/gm)]
  const commitLines = [...text.matchAll(/^COMMIT;$/gm)]
  if (
    beginLines.length !== 1 ||
    commitLines.length !== 1 ||
    beginLines[0].index >= commitLines[0].index ||
    /^\s*(?:ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT|START\s+TRANSACTION|SET\s+TRANSACTION)\b/im.test(text)
  ) {
    throw new Error('retirement_migration_transaction_shape_mismatch')
  }
  const normalized = Buffer.from(
    text.replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n?$/m, ''),
  )
  if (
    sha256(normalized) !== EXPECTED_NORMALIZED_MIGRATION_DIGEST ||
    /^\s*(?:BEGIN|COMMIT)\s*;\s*$/im.test(normalized.toString('utf8'))
  ) {
    throw new Error('retirement_migration_execution_digest_mismatch')
  }
  return normalized
}

export function hardenedRetirementMigrationBody(source) {
  const normalized = transactionNormalizedRetirementMigration(source)
  const legacyCompatibilityComment = `-- The table/functions remain temporarily because the durable account-deletion
-- worker still issues a service-role DELETE for compatibility. No caller may
-- read or create a reusable credential after this migration.
`
  const hardenedCompatibilityComment = `-- The empty table/functions remain temporarily for the durable account-deletion
-- worker. Compatibility is RPC-only; no API role retains direct table access
-- or any reusable credential read/write capability after this migration.
`
  const createMarker =
    'CREATE OR REPLACE FUNCTION public.delete_wechat_password_credential('
  const legacyMapGuard = `LOCK TABLE public.wechat_password_map IN ACCESS EXCLUSIVE MODE;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.wechat_password_map
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'wechat_password_map_not_empty: run scripts/retire-wechat-passwords.mjs before this migration'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;
`
  const directDeleteGrant = `-- Retained only for the account-deletion saga until its compatibility sweep
-- is removed in a later deployment.
GRANT DELETE ON TABLE public.wechat_password_map TO service_role;
`
  const legacyTableComment =
    "'RETIRED credential map. Must remain empty. service_role DELETE only for account-deletion compatibility; drop after that worker no longer references it.'"
  const hardenedTableComment =
    "'RETIRED credential map. Must remain empty. No API role has table access; account-deletion compatibility is RPC-only.'"
  const text = normalized.toString('utf8')
  if (
    text.split(createMarker).length !== 2 ||
    text.split(legacyCompatibilityComment).length !== 2 ||
    text.split(legacyMapGuard).length !== 2 ||
    text.split(directDeleteGrant).length !== 2 ||
    text.split(legacyTableComment).length !== 2
  ) {
    throw new Error('retirement_delete_rpc_create_shape_mismatch')
  }
  const hardened = Buffer.from(text
    .replace(legacyCompatibilityComment, hardenedCompatibilityComment)
    .replace(
      legacyMapGuard,
      '-- Atomic Production predecessor guard already holds and verifies the map.\n',
    )
    .replace(
      directDeleteGrant,
      '-- Hardened Production derivative grants no direct table access.\n',
    )
    .replace(
      createMarker,
      'CREATE FUNCTION public.delete_wechat_password_credential(',
    )
    .replace(legacyTableComment, hardenedTableComment))
  if (sha256(hardened) !== EXPECTED_HARDENED_MIGRATION_DIGEST) {
    throw new Error('retirement_hardened_migration_digest_mismatch')
  }
  return hardened
}

export function productionTransactionSettingsSql() {
  return Buffer.from(`-- Transaction-local Production limits. Supabase CLI
-- 2.95.4 resets session GUCs before each migration, so reassert them inside
-- the same implicit transaction that runs every guard, DDL statement, and the
-- final migration-ledger INSERT.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
SET LOCAL search_path = pg_catalog;

`)
}

export function productionLedgerGuardSql(projectedMigrations) {
  const identities = projectedMigrations
    .filter(entry => ![
      MIGRATION_FILE,
      CONVERGENCE_MIGRATION_FILE,
    ].includes(entry.canonicalName))
    .map(entry => ({
      version: entry.remoteVersion,
      name: entry.remoteName,
    }))
    .sort((left, right) => (
      left.version.localeCompare(right.version) || left.name.localeCompare(right.name)
    ))
  if (
    identities.length !== EXPECTED_REMOTE_LEDGER_COUNT ||
    identities.some(identity => (
      !/^(?:[0-9]{3}|[0-9]{14})$/.test(identity.version || '') ||
      !/^[A-Za-z0-9_.-]+$/.test(identity.name || '')
    )) ||
    new Set(identities.map(identity => identity.version)).size !== identities.length ||
    sha256(identities.map(identity => `${identity.version}|${identity.name}\n`).join('')) !==
      EXPECTED_REMOTE_IDENTITY_SET_DIGEST
  ) {
    throw new Error('production_ledger_guard_identity_mismatch')
  }
  const values = identities
    .map(identity => `      ('${identity.version}', '${identity.name}')`)
    .join(',\n')
  return Buffer.from(`-- Transaction-local Production ledger fence.
-- Resolve and validate the ledger through catalogs before LOCK TABLE can touch
-- a same-name view, foreign table, or trigger-bearing replacement.
DO $caaci_production_ledger_shape_guard$
DECLARE
  migration_ledger regclass := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'production_ledger_guard_requires_postgres'
      USING ERRCODE = '42501';
  END IF;
  IF migration_ledger IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = migration_ledger
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND NOT relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND (
         (attribute.attname IN ('version', 'name')
          AND attribute.atttypid = 'text'::pg_catalog.regtype)
         OR (attribute.attname = 'statements'
          AND attribute.atttypid = 'text[]'::pg_catalog.regtype)
       )
  ) <> 3 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) <> 3 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attrdef AS attribute_default
     WHERE attribute_default.adrelid = migration_ledger
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_attribute AS key_attribute
        ON key_attribute.attrelid = index_row.indrelid
       AND key_attribute.attnum = index_row.indkey[0]
     WHERE index_row.indrelid = migration_ledger
       AND index_row.indisprimary
       AND index_row.indisunique
       AND index_row.indisvalid
       AND index_row.indisready
       AND index_row.indimmediate
       AND index_row.indnkeyatts = 1
       AND index_row.indnatts = 1
       AND index_row.indexprs IS NULL
       AND index_row.indpred IS NULL
       AND key_attribute.attname = 'version'
       AND key_attribute.atttypid = 'text'::pg_catalog.regtype
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
     WHERE index_row.indrelid = migration_ledger
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = migration_ledger
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS relation_acl
     WHERE relation.oid = migration_ledger
       AND relation_acl.grantee <> relation.relowner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
        AS column_acl
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND column_acl.grantee <>
           pg_catalog.to_regrole('postgres')::oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = migration_ledger
        OR inheritance.inhparent = migration_ledger
  ) THEN
    RAISE EXCEPTION 'production_ledger_relation_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_production_ledger_shape_guard$;

-- Blocks concurrent INSERT/UPDATE/DELETE of migration history while allowing
-- this transaction's own final CLI ledger INSERT.
LOCK TABLE ONLY supabase_migrations.schema_migrations
  IN SHARE ROW EXCLUSIVE MODE;

DO $caaci_production_ledger_guard$
DECLARE
  migration_ledger regclass := pg_catalog.to_regclass(
    'supabase_migrations.schema_migrations'
  );
  actual_count bigint := 0;
  unique_version_count bigint := 0;
  unique_identity_count bigint := 0;
  mismatch_count bigint := 0;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'production_ledger_guard_requires_postgres'
      USING ERRCODE = '42501';
  END IF;

  -- Repeat the catalog check after the lock, so a replacement committed in
  -- the pre-lock window cannot become the source of the identity snapshot.
  IF migration_ledger IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = migration_ledger
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND NOT relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND (
         (attribute.attname IN ('version', 'name')
          AND attribute.atttypid = 'text'::pg_catalog.regtype)
         OR (attribute.attname = 'statements'
          AND attribute.atttypid = 'text[]'::pg_catalog.regtype)
       )
  ) <> 3 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) <> 3 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attrdef AS attribute_default
     WHERE attribute_default.adrelid = migration_ledger
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_attribute AS key_attribute
        ON key_attribute.attrelid = index_row.indrelid
       AND key_attribute.attnum = index_row.indkey[0]
     WHERE index_row.indrelid = migration_ledger
       AND index_row.indisprimary
       AND index_row.indisunique
       AND index_row.indisvalid
       AND index_row.indisready
       AND index_row.indimmediate
       AND index_row.indnkeyatts = 1
       AND index_row.indnatts = 1
       AND index_row.indexprs IS NULL
       AND index_row.indpred IS NULL
       AND key_attribute.attname = 'version'
       AND key_attribute.atttypid = 'text'::pg_catalog.regtype
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
     WHERE index_row.indrelid = migration_ledger
  ) <> 1 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = migration_ledger
  ) <> 1 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS relation_acl
     WHERE relation.oid = migration_ledger
       AND relation_acl.grantee <> relation.relowner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
        AS column_acl
     WHERE attribute.attrelid = migration_ledger
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND column_acl.grantee <>
           pg_catalog.to_regrole('postgres')::oid
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = migration_ledger
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = migration_ledger
        OR inheritance.inhparent = migration_ledger
  ) THEN
    RAISE EXCEPTION 'production_ledger_relation_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(DISTINCT ledger_row.version),
    pg_catalog.count(DISTINCT (ledger_row.version, ledger_row.name))
    INTO actual_count, unique_version_count, unique_identity_count
    FROM supabase_migrations.schema_migrations AS ledger_row;
  IF actual_count <> 108
     OR unique_version_count <> 108
     OR unique_identity_count <> 108 THEN
    RAISE EXCEPTION 'production_ledger_identity_cardinality_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)
    INTO mismatch_count
    FROM (VALUES
${values}
    ) AS expected_row(version, name)
    FULL OUTER JOIN supabase_migrations.schema_migrations AS ledger_row
      ON ledger_row.version = expected_row.version
     AND ledger_row.name = expected_row.name
   WHERE expected_row.version IS NULL
      OR ledger_row.version IS NULL;

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'production_ledger_projection_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_production_ledger_guard$;

`)
}

export function productionCredentialPredecessorGuardSql() {
  return Buffer.from(`-- Resolve the map through catalogs before LOCK TABLE can
-- touch a same-name view, foreign table, or attacker-controlled rule surface.
DO $caaci_wechat_prelock_shape_guard$
DECLARE
  map_table regclass := pg_catalog.to_regclass(
    'public.wechat_password_map'
  );
  exact_column_count bigint := 0;
  live_column_count bigint := 0;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'credential_predecessor_guard_requires_postgres'
      USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'credential_predecessor_transaction_mode_mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF map_table IS NULL OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = map_table
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = map_table
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = map_table
        OR inheritance.inhparent = map_table
  ) THEN
    RAISE EXCEPTION 'credential_predecessor_relation_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE
        (attribute.attname = 'openid'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'password'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'created_at'
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname IN ('last_used_at', 'rotated_at')
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND NOT attribute.attnotnull)
    )
    INTO live_column_count, exact_column_count
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = map_table
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF live_column_count <> 5 OR exact_column_count <> 5 THEN
    RAISE EXCEPTION 'credential_predecessor_column_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_wechat_prelock_shape_guard$;

-- Hold the retired credential relation stable while its reviewed
-- security-relevant predecessor shape is revalidated. Privileged GRANT/role changes additionally
-- require the operator freeze documented in RUNBOOK.md.
LOCK TABLE ONLY public.wechat_password_map IN ACCESS EXCLUSIVE MODE;

DO $caaci_wechat_predecessor_guard$
DECLARE
  map_table regclass := pg_catalog.to_regclass(
    'public.wechat_password_map'
  );
  lookup_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_lookup(text)'
  );
  store_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_store(text,text)'
  );
  legacy_rpc_shape_count bigint := 0;
  exact_column_count bigint := 0;
  live_column_count bigint := 0;
  role_name text;
  forbidden_privilege text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'credential_predecessor_guard_requires_postgres'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS required(role_name)
     WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'credential_predecessor_required_role_missing'
      USING ERRCODE = '55000';
  END IF;

  IF map_table IS NULL OR lookup_rpc IS NULL OR store_rpc IS NULL THEN
    RAISE EXCEPTION 'credential_predecessor_object_missing'
      USING ERRCODE = '55000';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname IN (
         'wechat_password_lookup', 'wechat_password_store'
       )
  ) <> 2 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname = 'delete_wechat_password_credential'
  ) THEN
    RAISE EXCEPTION 'credential_predecessor_rpc_namespace_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = map_table
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = map_table
  ) THEN
    RAISE EXCEPTION 'credential_predecessor_relation_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE
        (attribute.attname = 'openid'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'password'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'created_at'
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname IN ('last_used_at', 'rotated_at')
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND NOT attribute.attnotnull)
    )
    INTO live_column_count, exact_column_count
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = map_table
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF live_column_count <> 5 OR exact_column_count <> 5 THEN
    RAISE EXCEPTION 'credential_predecessor_column_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_attribute AS key_attribute
        ON key_attribute.attrelid = index_row.indrelid
       AND key_attribute.attnum = index_row.indkey[0]
     WHERE index_row.indrelid = map_table
       AND index_row.indisprimary
       AND index_row.indisunique
       AND index_row.indisvalid
       AND index_row.indisready
       AND index_row.indimmediate
       AND index_row.indnkeyatts = 1
       AND index_row.indnatts = 1
       AND key_attribute.attname = 'openid'
       AND key_attribute.atttypid = 'text'::pg_catalog.regtype
  ) <> 1 THEN
    RAISE EXCEPTION 'credential_predecessor_primary_key_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = map_table
        OR inheritance.inhparent = map_table
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = map_table
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = map_table
  ) THEN
    RAISE EXCEPTION 'credential_predecessor_dependency_or_hook_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee NOT IN (
         relation.relowner,
         pg_catalog.to_regrole('service_role')::oid
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
        AS column_acl
     WHERE attribute.attrelid = map_table
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND column_acl.grantee <>
           pg_catalog.to_regrole('postgres')::oid
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND relation_acl.privilege_type IN (
         'SELECT', 'INSERT', 'UPDATE', 'DELETE'
       )
       AND NOT relation_acl.is_grantable
  ) <> 4 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND (
         relation_acl.privilege_type NOT IN (
           'SELECT', 'INSERT', 'UPDATE', 'DELETE'
         )
         OR relation_acl.is_grantable
       )
  ) THEN
    RAISE EXCEPTION 'credential_predecessor_relation_acl_mismatch'
      USING ERRCODE = '55000';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']::text[] LOOP
    FOREACH forbidden_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER', 'MAINTAIN'
    ]::text[] LOOP
      IF pg_catalog.has_table_privilege(
           role_name,
           map_table,
           forbidden_privilege
         ) THEN
        RAISE EXCEPTION
          'credential_predecessor_browser_privilege_mismatch'
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege(
       'service_role', map_table, 'SELECT'
     ) OR NOT pg_catalog.has_table_privilege(
       'service_role', map_table, 'DELETE'
     ) THEN
    RAISE EXCEPTION 'credential_predecessor_service_privilege_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.count(*)
    INTO legacy_rpc_shape_count
    FROM pg_catalog.pg_proc AS function
   WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
     AND function.prokind = 'f'
     AND function.proowner = pg_catalog.to_regrole('postgres')::oid
     AND function.prosecdef
     AND function.provolatile = 'v'
     AND function.proconfig = ARRAY['search_path=public']::text[];

  IF legacy_rpc_shape_count <> 2 THEN
    RAISE EXCEPTION 'credential_predecessor_rpc_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function.proacl,
          pg_catalog.acldefault('f', function.proowner)
        )
      ) AS function_acl
     WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
       AND function_acl.grantee NOT IN (
         function.proowner,
         pg_catalog.to_regrole('service_role')::oid
       )
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', lookup_rpc, 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', store_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', lookup_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', store_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', lookup_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', store_rpc, 'EXECUTE'
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(function.proacl)
        AS function_acl
     WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
       AND function_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND function_acl.privilege_type = 'EXECUTE'
       AND NOT function_acl.is_grantable
  ) <> 2
  THEN
    RAISE EXCEPTION 'credential_predecessor_rpc_acl_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.wechat_password_map
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'credential_predecessor_map_not_empty'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_wechat_predecessor_guard$;

`)
}

export function productionCredentialPostconditionGuardSql() {
  return Buffer.from(`-- Final in-transaction postcondition. This detects the
-- reviewed security-relevant drift committed before this snapshot.
-- The privileged-change freeze remains mandatory through COMMIT because
-- PostgreSQL GRANT does not lock the target relation.
DO $caaci_wechat_retirement_postcondition$
DECLARE
  map_table regclass := pg_catalog.to_regclass(
    'public.wechat_password_map'
  );
  lookup_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_lookup(text)'
  );
  store_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.wechat_password_store(text,text)'
  );
  delete_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.delete_wechat_password_credential(text)'
  );
  exact_column_count bigint := 0;
  live_column_count bigint := 0;
  legacy_rpc_shape_count bigint := 0;
  role_name text;
  forbidden_privilege text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'credential_postcondition_requires_postgres'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
        AS required(role_name)
     WHERE pg_catalog.to_regrole(required.role_name) IS NULL
  ) OR map_table IS NULL OR lookup_rpc IS NULL OR store_rpc IS NULL
     OR delete_rpc IS NULL THEN
    RAISE EXCEPTION 'credential_postcondition_object_missing'
      USING ERRCODE = '55000';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname IN (
         'wechat_password_lookup', 'wechat_password_store'
       )
  ) <> 2 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = function.pronamespace
     WHERE namespace.nspname = 'public'
       AND function.proname = 'delete_wechat_password_credential'
  ) <> 1 THEN
    RAISE EXCEPTION 'credential_postcondition_rpc_namespace_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = map_table
       AND relation.relkind = 'r'
       AND relation.relpersistence = 'p'
       AND relation.relowner = pg_catalog.to_regrole('postgres')::oid
       AND relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = map_table
  ) THEN
    RAISE EXCEPTION 'credential_postcondition_relation_shape_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE
        (attribute.attname = 'openid'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'password'
         AND attribute.atttypid = 'text'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname = 'created_at'
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND attribute.attnotnull)
        OR (attribute.attname IN ('last_used_at', 'rotated_at')
         AND attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
         AND NOT attribute.attnotnull)
    )
    INTO live_column_count, exact_column_count
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = map_table
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF live_column_count <> 5 OR exact_column_count <> 5 OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_attribute AS key_attribute
        ON key_attribute.attrelid = index_row.indrelid
       AND key_attribute.attnum = index_row.indkey[0]
     WHERE index_row.indrelid = map_table
       AND index_row.indisprimary
       AND index_row.indisunique
       AND index_row.indisvalid
       AND index_row.indisready
       AND index_row.indimmediate
       AND index_row.indnkeyatts = 1
       AND index_row.indnatts = 1
       AND key_attribute.attname = 'openid'
       AND key_attribute.atttypid = 'text'::pg_catalog.regtype
  ) <> 1 THEN
    RAISE EXCEPTION 'credential_postcondition_column_or_key_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_inherits AS inheritance
     WHERE inheritance.inhrelid = map_table
        OR inheritance.inhparent = map_table
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = map_table
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_rewrite AS rewrite_rule
     WHERE rewrite_rule.ev_class = map_table
  ) THEN
    RAISE EXCEPTION 'credential_postcondition_dependency_or_hook_mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.wechat_password_map
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'credential_postcondition_map_not_empty'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) AS relation_acl
     WHERE relation.oid = map_table
       AND relation_acl.grantee <> relation.relowner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
        AS column_acl
     WHERE attribute.attrelid = map_table
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND column_acl.grantee <>
           pg_catalog.to_regrole('postgres')::oid
  ) THEN
    RAISE EXCEPTION 'credential_postcondition_relation_acl_mismatch'
      USING ERRCODE = '55000';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ]::text[] LOOP
    FOREACH forbidden_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
      'TRIGGER', 'MAINTAIN'
    ]::text[] LOOP
      IF pg_catalog.has_table_privilege(
           role_name,
           map_table,
           forbidden_privilege
         ) THEN
        RAISE EXCEPTION 'credential_postcondition_table_privilege_mismatch'
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
    FOREACH forbidden_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
    ]::text[] LOOP
      IF pg_catalog.has_any_column_privilege(
           role_name,
           map_table,
           forbidden_privilege
         ) THEN
        RAISE EXCEPTION 'credential_postcondition_column_privilege_mismatch'
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END LOOP;

  SELECT pg_catalog.count(*)
    INTO legacy_rpc_shape_count
    FROM pg_catalog.pg_proc AS function
   WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
     AND function.prokind = 'f'
     AND function.proowner = pg_catalog.to_regrole('postgres')::oid
     AND function.prosecdef
     AND function.provolatile = 'v'
     AND function.proconfig = ARRAY['search_path=public']::text[]
     AND function.prosrc !~* '\\mEXECUTE\\M';
  IF legacy_rpc_shape_count <> 2 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function.proacl,
          pg_catalog.acldefault('f', function.proowner)
        )
      ) AS function_acl
     WHERE function.oid IN (lookup_rpc::oid, store_rpc::oid)
       AND function_acl.grantee <> function.proowner
  ) THEN
    RAISE EXCEPTION 'credential_postcondition_legacy_rpc_mismatch'
      USING ERRCODE = '55000';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role'
  ]::text[] LOOP
    IF pg_catalog.has_function_privilege(role_name, lookup_rpc, 'EXECUTE')
       OR pg_catalog.has_function_privilege(role_name, store_rpc, 'EXECUTE') THEN
      RAISE EXCEPTION 'credential_postcondition_legacy_rpc_executable'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
     WHERE function.oid = delete_rpc::oid
       AND function.prokind = 'f'
       AND function.proowner = pg_catalog.to_regrole('postgres')::oid
       AND function.prosecdef
       AND function.provolatile = 'v'
       AND function.prorettype = 'boolean'::pg_catalog.regtype
       AND function.pronargs = 1
       AND function.pronargdefaults = 0
       AND function.provariadic = 0
       AND function.proargmodes IS NULL
       AND function.proargnames = ARRAY['openid_in']::text[]
       AND function.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND function.prosrc LIKE '%DELETE FROM public.wechat_password_map%'
       AND function.prosrc LIKE '%WHERE openid = openid_in%'
       AND function.prosrc LIKE '%GET DIAGNOSTICS deleted_rows = ROW_COUNT%'
       AND function.prosrc !~* '\\mEXECUTE\\M'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          function.proacl,
          pg_catalog.acldefault('f', function.proowner)
        )
      ) AS function_acl
     WHERE function.oid = delete_rpc::oid
       AND (
         function_acl.grantee NOT IN (
           function.proowner,
           pg_catalog.to_regrole('service_role')::oid
         )
         OR (
           function_acl.grantee =
             pg_catalog.to_regrole('service_role')::oid
           AND (
             function_acl.privilege_type <> 'EXECUTE'
             OR function_acl.is_grantable
           )
         )
       )
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_proc AS function
      CROSS JOIN LATERAL pg_catalog.aclexplode(function.proacl)
        AS function_acl
     WHERE function.oid = delete_rpc::oid
       AND function_acl.grantee =
           pg_catalog.to_regrole('service_role')::oid
       AND function_acl.privilege_type = 'EXECUTE'
       AND NOT function_acl.is_grantable
  ) <> 1
  OR NOT pg_catalog.has_function_privilege(
    'service_role', delete_rpc, 'EXECUTE'
  ) OR pg_catalog.has_function_privilege('anon', delete_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', delete_rpc, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'credential_postcondition_delete_rpc_mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF COALESCE(
       pg_catalog.obj_description(map_table, 'pg_class'),
       ''
     ) NOT LIKE 'RETIRED credential map.%' THEN
    RAISE EXCEPTION 'credential_postcondition_marker_missing'
      USING ERRCODE = '55000';
  END IF;
END
$caaci_wechat_retirement_postcondition$;

`)
}

export function productionGuardedRetirementMigration(source, projectedMigrations) {
  const execution = Buffer.concat([
    productionTransactionSettingsSql(),
    productionCredentialPredecessorGuardSql(),
    productionLedgerGuardSql(projectedMigrations),
    hardenedRetirementMigrationBody(source),
    productionCredentialPostconditionGuardSql(),
  ])
  if (sha256(execution) !== EXPECTED_GUARDED_EXECUTION_DIGEST) {
    throw new Error('retirement_migration_guarded_execution_digest_mismatch')
  }
  return execution
}

export function historicalExecutionGuard(name) {
  if (
    !/^[A-Za-z0-9_.-]+\.sql$/.test(name) ||
    name === MIGRATION_FILE ||
    name === CONVERGENCE_MIGRATION_FILE
  ) {
    throw new Error('historical_guard_name_invalid')
  }
  return Buffer.from(`-- Execution-deny history marker for ${name}.
-- The remote ledger must already contain this version. If it does not, abort
-- rather than replaying historical schema against Production.
DO $caaci_historical_replay_guard$
BEGIN
  RAISE EXCEPTION 'unexpected_non_target_migration_execution'
    USING ERRCODE = '55000';
END
$caaci_historical_replay_guard$;
`)
}

export function productionLedgerProjection(migrationEntries) {
  const canonicalByName = new Map(migrationEntries)
  if (
    canonicalByName.size !== EXPECTED_MIGRATION_COUNT ||
    LOCAL_ONLY_NON_TARGET_FILES.size !== 51 ||
    REMOTE_LEDGER_ALIASES.length !== 28 ||
    [...LOCAL_ONLY_NON_TARGET_FILES].some(name => !canonicalByName.has(name)) ||
    LOCAL_ONLY_NON_TARGET_FILES.has(MIGRATION_FILE)
  ) {
    throw new Error('production_ledger_projection_inventory_mismatch')
  }

  const aliases = REMOTE_LEDGER_ALIASES.map(entry => {
    let canonicalDigest = null
    if (entry.canonicalName) {
      canonicalDigest = canonicalByName.get(entry.canonicalName)
      if (!canonicalDigest || !LOCAL_ONLY_NON_TARGET_FILES.has(entry.canonicalName)) {
        throw new Error(`production_ledger_alias_canonical_mismatch:${entry.remoteVersion}`)
      }
    }
    return {
      canonicalName: entry.canonicalName,
      canonicalDigest,
      name: `${entry.remoteVersion}_${entry.remoteName}.sql`,
      remoteName: entry.remoteName,
      remoteVersion: entry.remoteVersion,
    }
  })
  const aliasMappingDigest = sha256(aliases
    .map(entry => [
      entry.remoteVersion,
      entry.remoteName,
      entry.canonicalName || '<hosted-only>',
      entry.canonicalDigest || '<hosted-only>',
    ].join('|'))
    .sort()
    .map(line => `${line}\n`)
    .join(''))
  if (aliasMappingDigest !== EXPECTED_ALIAS_MAPPING_DIGEST) {
    throw new Error('reviewed_production_ledger_alias_mapping_mismatch')
  }

  const projected = [
    ...migrationEntries
      .filter(([canonicalName]) => !LOCAL_ONLY_NON_TARGET_FILES.has(canonicalName))
      .map(([canonicalName, canonicalDigest]) => {
        const match = canonicalName.match(/^([0-9]{3}|[0-9]{14})_([A-Za-z0-9_.-]+)\.sql$/)
        if (!match) {
          throw new Error(`canonical_migration_identity_invalid:${canonicalName}`)
        }
        const isTarget = [
          MIGRATION_FILE,
          CONVERGENCE_MIGRATION_FILE,
        ].includes(canonicalName)
        return {
          canonicalName,
          canonicalDigest,
          name: canonicalName,
          remoteName: isTarget ? null : match[2],
          remoteVersion: isTarget ? null : match[1],
        }
      }),
    ...aliases,
  ].sort((left, right) => left.name.localeCompare(right.name))
  const projectedNames = new Set(projected.map(entry => entry.name))
  const projectedVersions = projected.map(entry => {
    const match = entry.name.match(/^([0-9]{3}|[0-9]{14})_/)
    if (!match) throw new Error(`production_ledger_projection_version_invalid:${entry.name}`)
    return match[1]
  })
  const targetIndexes = projected
    .map((entry, index) => ([
      MIGRATION_FILE,
      CONVERGENCE_MIGRATION_FILE,
    ].includes(entry.canonicalName) ? index : -1))
    .filter(index => index >= 0)
  const targetIndexSet = new Set(targetIndexes)
  const remoteVersions = projectedVersions.filter(
    (_, index) => !targetIndexSet.has(index),
  )
  const remoteVersionSetDigest = sha256(
    [...remoteVersions].sort().map(version => `${version}\n`).join(''),
  )
  const remoteIdentitySetDigest = sha256(projected
    .filter(entry => ![
      MIGRATION_FILE,
      CONVERGENCE_MIGRATION_FILE,
    ].includes(entry.canonicalName))
    .map(entry => `${entry.remoteVersion}|${entry.remoteName}\n`)
    .sort()
    .join(''))
  if (
    projected.length !== EXPECTED_EXECUTION_MIGRATION_COUNT ||
    projectedNames.size !== projected.length ||
    new Set(projectedVersions).size !== projected.length ||
    targetIndexes.length !== 2 ||
    projected.filter(entry => entry.canonicalName === MIGRATION_FILE).length !== 1 ||
    projected.filter(
      entry => entry.canonicalName === CONVERGENCE_MIGRATION_FILE,
    ).length !== 1 ||
    remoteVersions.length !== EXPECTED_REMOTE_LEDGER_COUNT ||
    remoteVersionSetDigest !== EXPECTED_REMOTE_VERSION_SET_DIGEST ||
    remoteIdentitySetDigest !== EXPECTED_REMOTE_IDENTITY_SET_DIGEST
  ) {
    throw new Error('production_ledger_projection_incomplete')
  }
  return projected
}

export function boundedChildEnv(
  baseEnv = process.env,
  { includePassword = true, temporaryDirectory = tmpdir() } = {},
) {
  const env = {
    LANG: 'C',
    LC_ALL: 'C',
    NO_COLOR: '1',
    PGOPTIONS: BOUNDED_PGOPTIONS,
    TERM: 'dumb',
    TMPDIR: temporaryDirectory,
  }
  if (includePassword) {
    env.SUPABASE_DB_PASSWORD = baseEnv.SUPABASE_DB_PASSWORD || ''
  }
  return env
}

export function boundedDatabaseUrl(rawUrl, sslRootCertPath) {
  let url
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('invalid_reviewed_pooler_url')
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.username !== `postgres.${PRODUCTION_PROJECT_REF}` ||
    url.password ||
    url.hostname !== REVIEWED_POOLER_HOST ||
    url.port !== REVIEWED_POOLER_PORT ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash ||
    !sslRootCertPath ||
    !isAbsolute(sslRootCertPath)
  ) {
    throw new Error('invalid_reviewed_pooler_url')
  }
  // Input query parameters are forbidden because libpq/pgx parameters such as
  // hostaddr, service, password, user and dbname can override URI authority.
  url.searchParams.set('sslmode', 'verify-full')
  url.searchParams.set('sslrootcert', sslRootCertPath)
  url.searchParams.set('connect_timeout', '10')
  url.searchParams.set('options', BOUNDED_PGOPTIONS)
  return url.toString()
}

function stripAnsi(value) {
  return String(value || '').replace(ANSI_ESCAPE_RE, '')
}

function plannedMigrationNames(stderr) {
  const lines = stripAnsi(stderr).replaceAll('\r', '').split('\n')
  const headers = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === 'Would push these migrations:') {
      headers.push(index)
    }
  }
  if (headers.length !== 1) return []

  const names = []
  let index = headers[0] + 1
  while (index < lines.length && !lines[index].trim()) index += 1
  while (index < lines.length) {
    const match = lines[index].match(/^\s*•\s+([A-Za-z0-9_.-]+\.sql)\s*$/)
    if (!match) break
    names.push(match[1].replace(/\.sql$/, ''))
    index += 1
  }
  return names
}

export function pendingMigrationNames(output) {
  if (typeof output === 'string') return plannedMigrationNames(output)
  return plannedMigrationNames(output?.stderr)
}

export function assertExactDryRun(result) {
  const stderr = stripAnsi(result?.stderr)
  const stdout = stripAnsi(result?.stdout)
  if (!stderr.includes('DRY RUN: migrations will *not* be pushed to the database.')) {
    throw new Error('dry_run_marker_missing')
  }
  if (stderr.includes('Skipping migrations because it is disabled')) {
    throw new Error('dry_run_migrations_disabled')
  }
  const pending = plannedMigrationNames(stderr)
  const finished = stdout.split(/\r?\n/)
    .some(line => line.trim() === 'Finished supabase db push.')
  const upToDate = stdout.split(/\r?\n/)
    .some(line => line.trim() === 'Remote database is up to date.')
  let state
  if (
    pending.length === 2 &&
    pending[0] === MIGRATION_BASENAME &&
    pending[1] === CONVERGENCE_MIGRATION_BASENAME &&
    finished &&
    !upToDate
  ) {
    state = 'baseline'
  } else if (
    pending.length === 1 &&
    pending[0] === CONVERGENCE_MIGRATION_BASENAME &&
    finished &&
    !upToDate
  ) {
    state = 'intermediate'
  } else if (pending.length === 0 && upToDate && !finished) {
    state = 'final'
  } else {
    throw new Error(
      `dry_run_retirement_state_unrecognized:${pending.join(',') || 'none'}`,
    )
  }
  return Object.freeze({ state, pending: Object.freeze([...pending]) })
}

export function assertExactApply(result, expectedPending) {
  const stderr = stripAnsi(result?.stderr)
  const stdout = stripAnsi(result?.stdout)
  const applying = stderr.split(/\r?\n/)
    .map(line => /^\s*Applying migration ([A-Za-z0-9_.-]+\.sql)\.\.\.\s*$/.exec(line)?.[1])
    .filter(Boolean)
  const expectedFiles = (expectedPending || []).map(name => `${name}.sql`)
  if (
    expectedFiles.length === 0 ||
    JSON.stringify(applying) !== JSON.stringify(expectedFiles)
  ) {
    throw new Error('apply_markers_do_not_match_retirement_state')
  }
  if (!stdout.split(/\r?\n/).some(line => line.trim() === 'Finished supabase db push.')) {
    throw new Error('apply_completion_marker_missing')
  }
  return Object.freeze([...applying])
}

export function parseArguments(argv) {
  let apply = false
  let confirmation = ''
  let privilegedFreezeConfirmation = ''
  let projectRef = ''
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (![
      '--apply', '--confirm', '--confirm-privileged-freeze', '--project-ref',
    ].includes(argument)) {
      throw new Error('unknown_argument')
    }
    if (seen.has(argument)) throw new Error(`duplicate_argument:${argument}`)
    seen.add(argument)
    if (argument === '--apply') {
      apply = true
    } else if (argument === '--confirm') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) {
        throw new Error('missing_argument_value:--confirm')
      }
      confirmation = value
    } else if (argument === '--confirm-privileged-freeze') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) {
        throw new Error(
          'missing_argument_value:--confirm-privileged-freeze',
        )
      }
      privilegedFreezeConfirmation = value
    } else {
      const value = argv[++index]
      if (!value || value.startsWith('--')) {
        throw new Error('missing_argument_value:--project-ref')
      }
      projectRef = value
    }
  }
  if (projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error('exact_production_project_ref_required')
  }
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(`apply_requires_confirmation:${APPLY_CONFIRMATION}`)
  }
  if (
    apply &&
    privilegedFreezeConfirmation !== PRIVILEGED_FREEZE_CONFIRMATION
  ) {
    throw new Error(
      `apply_requires_privileged_freeze_confirmation:${PRIVILEGED_FREEZE_CONFIRMATION}`,
    )
  }
  if (!apply && confirmation) throw new Error('confirmation_without_apply')
  if (!apply && privilegedFreezeConfirmation) {
    throw new Error('privileged_freeze_confirmation_without_apply')
  }
  return { apply, projectRef }
}

function parseManifest(manifest) {
  const entries = new Map()
  for (const line of manifest.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9_.-]+\.sql)$/)
    if (!match || entries.has(match[2])) {
      throw new Error('migration_manifest_invalid')
    }
    entries.set(match[2], match[1])
  }
  return entries
}

async function assertRegularFile(path, errorCode) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(errorCode)
  return metadata
}

async function certificateSnapshot(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath || !isAbsolute(rawPath)) {
    throw new Error('SUPABASE_DB_SSLROOTCERT_absolute_path_required')
  }
  const path = resolve(rawPath)
  const metadata = await assertRegularFile(
    path,
    'supabase_ca_is_not_regular_file',
  )
  if (metadata.size < 256 || metadata.size > 64 * 1024) {
    throw new Error('supabase_ca_size_invalid')
  }
  if ((metadata.mode & 0o022) !== 0) {
    throw new Error('supabase_ca_is_group_or_world_writable')
  }
  const pem = await readFile(path, 'utf8')
  if ((pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length !== 1) {
    throw new Error('supabase_ca_must_contain_exactly_one_certificate')
  }
  let certificate
  try {
    certificate = new X509Certificate(pem)
  } catch {
    throw new Error('supabase_ca_certificate_invalid')
  }
  const now = Date.now()
  if (
    !certificate.ca ||
    !Number.isFinite(Date.parse(certificate.validFrom)) ||
    !Number.isFinite(Date.parse(certificate.validTo)) ||
    now < Date.parse(certificate.validFrom) ||
    now >= Date.parse(certificate.validTo)
  ) {
    throw new Error('supabase_ca_certificate_not_current_ca')
  }
  return {
    path,
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: metadata.mode,
    size: metadata.size,
    digest: sha256(pem),
    fingerprint256: certificate.fingerprint256,
  }
}

async function readMigrationSet(directory, expectedNames) {
  const names = (await readdir(directory))
    .filter(name => name.endsWith('.sql'))
    .sort()
  if (JSON.stringify(names) !== JSON.stringify([...expectedNames].sort())) {
    throw new Error('migration_directory_manifest_mismatch')
  }
  const entries = []
  for (const name of names) {
    const path = join(directory, name)
    await assertRegularFile(path, 'migration_is_not_regular_file')
    entries.push([name, sha256(await readFile(path))])
  }
  return entries
}

function migrationSetDigest(entries) {
  return sha256(entries.map(([name, digest]) => `${digest}  ${name}\n`).join(''))
}

async function repositorySnapshot() {
  const migrationDirectory = fileURLToPath(new URL('supabase/migrations/', ROOT))
  const manifestPath = fileURLToPath(
    new URL('supabase/migrations/manifest.sha256', ROOT),
  )
  const linkedRefPath = fileURLToPath(new URL('supabase/.temp/project-ref', ROOT))
  const poolerUrlPath = fileURLToPath(new URL('supabase/.temp/pooler-url', ROOT))
  await Promise.all([
    assertRegularFile(manifestPath, 'migration_manifest_is_not_regular_file'),
    assertRegularFile(linkedRefPath, 'linked_project_ref_is_not_regular_file'),
    assertRegularFile(poolerUrlPath, 'pooler_url_is_not_regular_file'),
  ])

  const [manifest, linkedRef, poolerUrl] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(linkedRefPath, 'utf8'),
    readFile(poolerUrlPath, 'utf8'),
  ])
  const manifestEntries = parseManifest(manifest)
  if (
    sha256(manifest) !== EXPECTED_MANIFEST_DIGEST ||
    manifestEntries.size !== EXPECTED_MIGRATION_COUNT
  ) {
    throw new Error('reviewed_migration_manifest_set_mismatch')
  }
  const migrationEntries = await readMigrationSet(
    migrationDirectory,
    manifestEntries.keys(),
  )
  for (const [name, digest] of migrationEntries) {
    if (manifestEntries.get(name) !== digest) {
      throw new Error(`migration_manifest_mismatch:${name}`)
    }
  }
  if (manifestEntries.get(MIGRATION_FILE) !== EXPECTED_MIGRATION_DIGEST) {
    throw new Error('retirement_migration_reviewed_digest_mismatch')
  }
  if (
    manifestEntries.get(CONVERGENCE_MIGRATION_FILE) !==
    EXPECTED_CONVERGENCE_MIGRATION_DIGEST
  ) {
    throw new Error('convergence_migration_reviewed_digest_mismatch')
  }
  if (linkedRef.trim() !== PRODUCTION_PROJECT_REF) {
    throw new Error('linked_project_is_not_reviewed_production')
  }
  const projectedMigrations = productionLedgerProjection(migrationEntries)
  const executionEntries = projectedMigrations.map(({ canonicalName, name }) => [
    name,
    canonicalName === MIGRATION_FILE
      ? EXPECTED_GUARDED_EXECUTION_DIGEST
      : canonicalName === CONVERGENCE_MIGRATION_FILE
        ? EXPECTED_CONVERGENCE_MIGRATION_DIGEST
      : sha256(historicalExecutionGuard(name)),
  ])
  const executionSetDigest = migrationSetDigest(executionEntries)
  if (executionSetDigest !== EXPECTED_EXECUTION_SET_DIGEST) {
    throw new Error('reviewed_execution_projection_mismatch')
  }
  return {
    rawPoolerUrl: poolerUrl,
    migrationEntries,
    migrationSetDigest: migrationSetDigest(migrationEntries),
    projectedMigrations,
    executionEntries,
    executionSetDigest,
  }
}

async function isolatedWorkspaceSnapshot(workdir, expectedNames) {
  const supabaseDir = join(workdir, 'supabase')
  const configPath = join(supabaseDir, 'config.toml')
  const migrationsDir = join(supabaseDir, 'migrations')
  await assertRegularFile(configPath, 'isolated_config_is_not_regular_file')
  const configDigest = sha256(await readFile(configPath))
  if (configDigest !== MINIMAL_CONFIG_DIGEST) {
    throw new Error('isolated_config_changed')
  }
  const entries = await readMigrationSet(migrationsDir, expectedNames)
  return { configDigest, migrationSetDigest: migrationSetDigest(entries) }
}

async function isolatedMigrationWorkspace(repository) {
  let workdir = ''
  try {
    workdir = await mkdtemp(join(tmpdir(), 'caaci-wechat-retirement-'))
    const supabaseDir = join(workdir, 'supabase')
    const migrationsDir = join(supabaseDir, 'migrations')
    await mkdir(migrationsDir, { recursive: true, mode: 0o700 })
    await writeFile(join(supabaseDir, 'config.toml'), MINIMAL_CONFIG, {
      encoding: 'utf8',
      mode: 0o400,
      flag: 'wx',
    })
    for (const { canonicalName, name } of repository.projectedMigrations) {
      const destination = join(migrationsDir, name)
      if (canonicalName === MIGRATION_FILE) {
        const source = fileURLToPath(new URL(`supabase/migrations/${canonicalName}`, ROOT))
        await writeFile(
          destination,
          productionGuardedRetirementMigration(
            await readFile(source),
            repository.projectedMigrations,
          ),
          { mode: 0o400, flag: 'wx' },
        )
      } else if (canonicalName === CONVERGENCE_MIGRATION_FILE) {
        const source = fileURLToPath(
          new URL(`supabase/migrations/${canonicalName}`, ROOT),
        )
        const body = await readFile(source)
        if (sha256(body) !== EXPECTED_CONVERGENCE_MIGRATION_DIGEST) {
          throw new Error('convergence_migration_reviewed_digest_mismatch')
        }
        await writeFile(destination, body, { mode: 0o400, flag: 'wx' })
      } else {
        await writeFile(destination, historicalExecutionGuard(name), {
          mode: 0o400,
          flag: 'wx',
        })
      }
      await chmod(destination, 0o400)
    }
    const snapshot = await isolatedWorkspaceSnapshot(
      workdir,
      repository.executionEntries.map(([name]) => name),
    )
    if (
      snapshot.migrationSetDigest !==
      migrationSetDigest(repository.executionEntries)
    ) {
      throw new Error('isolated_migration_set_changed_during_copy')
    }
    return { workdir, snapshot }
  } catch (error) {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function cliFingerprint(cliPath) {
  const metadata = await assertRegularFile(cliPath, 'supabase_cli_is_not_regular_file')
  return {
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: metadata.mode,
    size: metadata.size,
    digest: sha256(await readFile(cliPath)),
  }
}

function assertSameFingerprint(actual, expected, errorCode) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(errorCode)
}

export function redactCliOutput(value, secret) {
  let output = String(value || '')
  for (const candidate of [secret, secret ? encodeURIComponent(secret) : '']) {
    if (candidate) output = output.replaceAll(candidate, '[REDACTED]')
  }
  return output
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/([?&]password=)[^&\s]*/gi, '$1[REDACTED]')
}

async function runSupabase(cliPath, arguments_, env, workdir, timeoutMs) {
  try {
    return await execFileAsync(cliPath, arguments_, {
      cwd: workdir,
      env,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    })
  } catch (error) {
    const wrapped = new Error(`supabase_cli_failed:${error?.code ?? 'unknown'}`)
    wrapped.stdout = error?.stdout || ''
    wrapped.stderr = error?.stderr || ''
    throw wrapped
  }
}

function writeCliResult(result, io, secret) {
  if (result?.stdout) io.stdout(redactCliOutput(result.stdout, secret))
  if (result?.stderr) io.stderr(redactCliOutput(result.stderr, secret))
}

export async function executeRelease(
  argv,
  {
    baseEnv = process.env,
    cliPath = PINNED_CLI_PATH,
    expectedCliDigest = PINNED_CLI_DIGEST,
    expectedCliVersion = PINNED_CLI_VERSION,
    expectedCaFingerprint256 = PINNED_PRODUCTION_CA_FINGERPRINT256,
    io = {
      stdout: value => process.stdout.write(value),
      stderr: value => process.stderr.write(value),
    },
  } = {},
) {
  const { apply } = parseArguments(argv)
  const repository = await repositorySnapshot()
  const secret = baseEnv.SUPABASE_DB_PASSWORD || ''
  if (!secret) throw new Error('SUPABASE_DB_PASSWORD_required_in_operator_shell')
  const initialCa = await certificateSnapshot(
    baseEnv.SUPABASE_DB_SSLROOTCERT || '',
  )
  if (!expectedCaFingerprint256) {
    throw new Error('supabase_ca_fingerprint_not_pinned')
  }
  if (initialCa.fingerprint256 !== expectedCaFingerprint256) {
    throw new Error('supabase_ca_fingerprint_mismatch')
  }
  const boundedDbUrl = boundedDatabaseUrl(
    repository.rawPoolerUrl,
    initialCa.path,
  )

  const initialCli = await cliFingerprint(cliPath)
  if (initialCli.digest !== expectedCliDigest) {
    throw new Error('supabase_cli_reviewed_digest_mismatch')
  }
  // The content hash identifies the reviewed 2.95.4 artifact. Do not invoke
  // `--version`: that code path performs an update-network check and may emit a
  // current-version notice even though the pinned binary itself is correct.
  io.stdout(`Supabase CLI: ${expectedCliVersion}\n`)
  io.stdout('Target transaction contract: lock_timeout=5s, statement_timeout=2min\n')
  io.stdout(`Source migration SHA-256: ${EXPECTED_MIGRATION_DIGEST}\n`)
  io.stdout(`Normalized body SHA-256: ${EXPECTED_NORMALIZED_MIGRATION_DIGEST}\n`)
  io.stdout(`Guarded execution SHA-256: ${EXPECTED_GUARDED_EXECUTION_DIGEST}\n`)
  io.stdout(`Convergence migration SHA-256: ${EXPECTED_CONVERGENCE_MIGRATION_DIGEST}\n`)
  io.stdout(`Execution-set SHA-256: ${EXPECTED_EXECUTION_SET_DIGEST}\n`)

  const isolated = await isolatedMigrationWorkspace(repository)
  let primaryError
  try {
    const verifyLocalArtifacts = async () => {
      assertSameFingerprint(
        await cliFingerprint(cliPath),
        initialCli,
        'supabase_cli_changed_during_release',
      )
      const currentRepository = await repositorySnapshot()
      if (
        currentRepository.rawPoolerUrl !== repository.rawPoolerUrl ||
        currentRepository.migrationSetDigest !== repository.migrationSetDigest
      ) {
        throw new Error('repository_changed_during_release')
      }
      assertSameFingerprint(
        await certificateSnapshot(initialCa.path),
        initialCa,
        'supabase_ca_changed_during_release',
      )
      const currentIsolated = await isolatedWorkspaceSnapshot(
        isolated.workdir,
        repository.executionEntries.map(([name]) => name),
      )
      if (
        currentIsolated.configDigest !== isolated.snapshot.configDigest ||
        currentIsolated.migrationSetDigest !== isolated.snapshot.migrationSetDigest
      ) {
        throw new Error('isolated_workspace_changed_during_release')
      }
    }

    await verifyLocalArtifacts()
    const env = boundedChildEnv(baseEnv, {
      temporaryDirectory: isolated.workdir,
    })
    let dryRun
    try {
      dryRun = await runSupabase(
        cliPath,
        [
          'db', 'push', '--db-url', boundedDbUrl,
          '--include-all', '--dry-run',
        ],
        env,
        isolated.workdir,
        CLI_TIMEOUT_MS,
      )
    } catch (error) {
      writeCliResult(error, io, secret)
      throw error
    }
    const initialState = assertExactDryRun(dryRun)
    writeCliResult(dryRun, io, secret)

    if (!apply) {
      io.stdout('DRY RUN ONLY: no migration was applied.\n')
      io.stdout(
        `Reviewed remote retirement state: ${initialState.state}; pending=${initialState.pending.join(',') || 'none'}\n`,
      )
      io.stdout(
        `Apply only after all external gates are signed off: --apply --confirm ${APPLY_CONFIRMATION} --confirm-privileged-freeze ${PRIVILEGED_FREEZE_CONFIRMATION}\n`,
      )
      return {
        applied: false,
        sourceDigest: EXPECTED_MIGRATION_DIGEST,
        normalizedDigest: EXPECTED_NORMALIZED_MIGRATION_DIGEST,
        executionDigest: EXPECTED_GUARDED_EXECUTION_DIGEST,
        convergenceDigest: EXPECTED_CONVERGENCE_MIGRATION_DIGEST,
        executionSetDigest: EXPECTED_EXECUTION_SET_DIGEST,
        state: initialState.state,
        pending: initialState.pending,
      }
    }

    await verifyLocalArtifacts()
    // Re-read the remote ledger immediately before apply. This cannot remove
    // the network-sized TOCTOU window, so every non-target local history file
    // is also an execution-deny guard: unexpected ledger drift aborts instead
    // of replaying historical schema.
    let finalDryRun
    try {
      finalDryRun = await runSupabase(
        cliPath,
        [
          'db', 'push', '--db-url', boundedDbUrl,
          '--include-all', '--dry-run',
        ],
        env,
        isolated.workdir,
        CLI_TIMEOUT_MS,
      )
    } catch (error) {
      writeCliResult(error, io, secret)
      throw error
    }
    const finalDryRunState = assertExactDryRun(finalDryRun)
    writeCliResult(finalDryRun, io, secret)
    if (
      finalDryRunState.state !== initialState.state ||
      JSON.stringify(finalDryRunState.pending) !==
        JSON.stringify(initialState.pending)
    ) {
      throw new Error('remote_retirement_state_changed_between_dry_runs')
    }
    await verifyLocalArtifacts()
    io.stdout(
      `FINAL DRY RUN: ${finalDryRunState.state} state reconfirmed exactly.\n`,
    )
    if (finalDryRunState.state === 'final') {
      io.stdout(
        'ALREADY CONVERGED: no apply command was run; run the read-only VERIFY.\n',
      )
      return {
        applied: false,
        alreadyFinal: true,
        sourceDigest: EXPECTED_MIGRATION_DIGEST,
        normalizedDigest: EXPECTED_NORMALIZED_MIGRATION_DIGEST,
        executionDigest: EXPECTED_GUARDED_EXECUTION_DIGEST,
        convergenceDigest: EXPECTED_CONVERGENCE_MIGRATION_DIGEST,
        executionSetDigest: EXPECTED_EXECUTION_SET_DIGEST,
        state: 'final',
        pending: [],
      }
    }
    let applied
    try {
      applied = await runSupabase(
        cliPath,
        [
          'db', 'push', '--db-url', boundedDbUrl,
          '--include-all', '--yes',
        ],
        env,
        isolated.workdir,
        CLI_TIMEOUT_MS,
      )
    } catch (error) {
      writeCliResult(error, io, secret)
      throw error
    }
    assertExactApply(applied, finalDryRunState.pending)
    writeCliResult(applied, io, secret)
    await verifyLocalArtifacts()
    let postApplyDryRun
    try {
      postApplyDryRun = await runSupabase(
        cliPath,
        [
          'db', 'push', '--db-url', boundedDbUrl,
          '--include-all', '--dry-run',
        ],
        env,
        isolated.workdir,
        CLI_TIMEOUT_MS,
      )
    } catch (error) {
      writeCliResult(error, io, secret)
      throw error
    }
    const postApplyState = assertExactDryRun(postApplyDryRun)
    writeCliResult(postApplyDryRun, io, secret)
    if (postApplyState.state !== 'final') {
      throw new Error('post_apply_retirement_state_not_final')
    }
    await verifyLocalArtifacts()
    io.stdout(
      'APPLY COMMAND COMPLETED AND FINAL STATE RECONFIRMED: run the read-only VERIFY immediately.\n',
    )
    return {
      applied: true,
      sourceDigest: EXPECTED_MIGRATION_DIGEST,
      normalizedDigest: EXPECTED_NORMALIZED_MIGRATION_DIGEST,
      executionDigest: EXPECTED_GUARDED_EXECUTION_DIGEST,
      convergenceDigest: EXPECTED_CONVERGENCE_MIGRATION_DIGEST,
      executionSetDigest: EXPECTED_EXECUTION_SET_DIGEST,
      state: 'final',
      previousState: finalDryRunState.state,
      pending: [],
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      await rm(isolated.workdir, { recursive: true, force: true })
    } catch {
      if (!primaryError) throw new Error('isolated_workspace_cleanup_failed')
      io.stderr('WARNING: isolated workspace cleanup failed after the primary error.\n')
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  return executeRelease(argv)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(
      `WeChat retirement migration executor stopped: ${error?.message || 'unknown_error'}`,
    )
    if (process.argv.includes('--apply')) {
      console.error(
        'Apply outcome may be unknown: run the read-only ledger and VERIFY reconciliation before any retry.',
      )
    }
    process.exitCode = 1
  })
}
