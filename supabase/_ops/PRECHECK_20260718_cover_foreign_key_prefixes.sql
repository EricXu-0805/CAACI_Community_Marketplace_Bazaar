-- Read-only deployment gate for 20260718220000_cover_foreign_key_prefixes.sql.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $precheck$
DECLARE
  target record;
  table_oid oid;
  column_attnum smallint;
  existing_index oid;
  unexpected_missing text;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('private', 'item_deals', 'conversation_id', 'item_deals_conversation_id_fkey', 'item_deals_conversation_id_idx'),
      ('private', 'item_deals', 'owner_id', 'item_deals_owner_id_fkey', 'item_deals_owner_id_idx'),
      ('private', 'item_deals', 'counterparty_id', 'item_deals_counterparty_id_fkey', 'item_deals_counterparty_id_idx'),
      ('public', 'admin_banner_uploads', 'actor_id', 'admin_banner_uploads_actor_id_fkey', 'admin_banner_uploads_actor_id_idx'),
      ('public', 'admin_tokens', 'created_by', 'admin_tokens_created_by_fkey', 'admin_tokens_created_by_idx'),
      ('public', 'meetups', 'from_user', 'meetups_from_user_fkey', 'meetups_from_user_idx'),
      ('public', 'meetups', 'item_id', 'meetups_item_id_fkey', 'meetups_item_id_idx'),
      ('public', 'meetups', 'parent_meetup_id', 'meetups_parent_meetup_id_fkey', 'meetups_parent_meetup_id_idx'),
      ('public', 'meetups', 'to_user', 'meetups_to_user_fkey', 'meetups_to_user_idx'),
      ('public', 'notifications', 'item_id', 'notifications_item_id_fkey', 'notifications_item_id_idx'),
      ('public', 'offers', 'from_user', 'offers_from_user_fkey', 'offers_from_user_idx'),
      ('public', 'offers', 'item_id', 'offers_item_id_fkey', 'offers_item_id_idx'),
      ('public', 'offers', 'parent_offer_id', 'offers_parent_offer_id_fkey', 'offers_parent_offer_id_idx'),
      ('public', 'offers', 'to_user', 'offers_to_user_fkey', 'offers_to_user_idx'),
      ('public', 'post_comments', 'parent_comment_id', 'post_comments_parent_comment_id_fkey', 'post_comments_parent_comment_id_idx'),
      ('public', 'post_comments', 'user_id', 'post_comments_user_id_fkey', 'post_comments_user_id_idx'),
      ('public', 'ratings', 'item_id', 'ratings_item_id_fkey', 'ratings_item_id_idx'),
      ('public', 'wechat_media_checks', 'user_id', 'wechat_media_checks_user_id_fkey', 'wechat_media_checks_user_id_idx')
    ) AS required(
      schema_name,
      table_name,
      column_name,
      constraint_name,
      index_name
    )
  LOOP
    table_oid := pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', target.schema_name, target.table_name)
    );
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing %.%',
        target.schema_name, target.table_name;
    END IF;

    SELECT attribute.attnum
      INTO column_attnum
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = table_oid
      AND attribute.attname = target.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;
    IF column_attnum IS NULL THEN
      RAISE EXCEPTION 'precheck_failed: missing %.%.%',
        target.schema_name, target.table_name, target.column_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS foreign_key
      WHERE foreign_key.conrelid = table_oid
        AND foreign_key.conname = target.constraint_name
        AND foreign_key.contype = 'f'
        AND foreign_key.convalidated
        AND foreign_key.conkey = ARRAY[column_attnum]::smallint[]
    ) THEN
      RAISE EXCEPTION 'precheck_failed: foreign key %.%.% drifted',
        target.schema_name, target.table_name, target.constraint_name;
    END IF;

    existing_index := pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', target.schema_name, target.index_name)
    );
    IF existing_index IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE index_row.indexrelid = existing_index
        AND index_row.indrelid = table_oid
        AND index_row.indisvalid
        AND index_row.indisready
        AND index_row.indislive
        AND NOT index_row.indisunique
        AND index_row.indnkeyatts = 1
        AND index_row.indnatts = 1
        AND index_row.indpred IS NULL
        AND index_row.indexprs IS NULL
        AND access_method.amname = 'btree'
        AND (index_row.indkey::smallint[])[0] = column_attnum
    ) THEN
      RAISE EXCEPTION 'precheck_failed: index name %.% already has an incompatible definition',
        target.schema_name, target.index_name;
    END IF;
  END LOOP;

  WITH foreign_keys AS (
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      foreign_key.conname AS constraint_name,
      foreign_key.conrelid,
      foreign_key.conkey
    FROM pg_catalog.pg_constraint AS foreign_key
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = foreign_key.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE foreign_key.contype = 'f'
      AND namespace.nspname IN ('public', 'private')
  ), uncovered AS (
    SELECT foreign_key.*
    FROM foreign_keys AS foreign_key
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE index_row.indrelid = foreign_key.conrelid
        AND index_row.indisvalid
        AND index_row.indisready
        AND index_row.indislive
        AND access_method.amname = 'btree'
        AND index_row.indnkeyatts >= pg_catalog.cardinality(foreign_key.conkey)
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.generate_subscripts(
            foreign_key.conkey,
            1
          ) AS position
          WHERE (index_row.indkey::smallint[])[position - 1]
                <> foreign_key.conkey[position]
        )
    )
  )
  SELECT pg_catalog.string_agg(
           pg_catalog.format(
             '%I.%I.%I',
             uncovered.schema_name,
             uncovered.table_name,
             uncovered.constraint_name
           ),
           ', '
           ORDER BY uncovered.schema_name,
                    uncovered.table_name,
                    uncovered.constraint_name
         )
    INTO unexpected_missing
  FROM uncovered
  WHERE NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('private', 'item_deals', 'item_deals_conversation_id_fkey'),
      ('private', 'item_deals', 'item_deals_owner_id_fkey'),
      ('private', 'item_deals', 'item_deals_counterparty_id_fkey'),
      ('public', 'admin_banner_uploads', 'admin_banner_uploads_actor_id_fkey'),
      ('public', 'admin_tokens', 'admin_tokens_created_by_fkey'),
      ('public', 'meetups', 'meetups_from_user_fkey'),
      ('public', 'meetups', 'meetups_item_id_fkey'),
      ('public', 'meetups', 'meetups_parent_meetup_id_fkey'),
      ('public', 'meetups', 'meetups_to_user_fkey'),
      ('public', 'notifications', 'notifications_item_id_fkey'),
      ('public', 'offers', 'offers_from_user_fkey'),
      ('public', 'offers', 'offers_item_id_fkey'),
      ('public', 'offers', 'offers_parent_offer_id_fkey'),
      ('public', 'offers', 'offers_to_user_fkey'),
      ('public', 'post_comments', 'post_comments_parent_comment_id_fkey'),
      ('public', 'post_comments', 'post_comments_user_id_fkey'),
      ('public', 'ratings', 'ratings_item_id_fkey'),
      ('public', 'wechat_media_checks', 'wechat_media_checks_user_id_fkey')
    ) AS planned(schema_name, table_name, constraint_name)
    WHERE planned.schema_name = uncovered.schema_name
      AND planned.table_name = uncovered.table_name
      AND planned.constraint_name = uncovered.constraint_name
  );

  IF unexpected_missing IS NOT NULL THEN
    RAISE EXCEPTION 'precheck_failed: unplanned uncovered foreign keys: %',
      unexpected_missing;
  END IF;
END
$precheck$;

WITH planned AS (
  SELECT *
  FROM (VALUES
    ('private', 'item_deals', 'conversation_id'),
    ('private', 'item_deals', 'owner_id'),
    ('private', 'item_deals', 'counterparty_id'),
    ('public', 'admin_banner_uploads', 'actor_id'),
    ('public', 'admin_tokens', 'created_by'),
    ('public', 'meetups', 'from_user'),
    ('public', 'meetups', 'item_id'),
    ('public', 'meetups', 'parent_meetup_id'),
    ('public', 'meetups', 'to_user'),
    ('public', 'notifications', 'item_id'),
    ('public', 'offers', 'from_user'),
    ('public', 'offers', 'item_id'),
    ('public', 'offers', 'parent_offer_id'),
    ('public', 'offers', 'to_user'),
    ('public', 'post_comments', 'parent_comment_id'),
    ('public', 'post_comments', 'user_id'),
    ('public', 'ratings', 'item_id'),
    ('public', 'wechat_media_checks', 'user_id')
  ) AS target(schema_name, table_name, column_name)
)
SELECT pg_catalog.count(*) AS planned_index_count
FROM planned;

-- Production rollout evidence. The standard migration intentionally uses
-- transactional CREATE INDEX, so a relation above 64 MiB must be handled in a
-- separately reviewed maintenance window (or with CREATE INDEX CONCURRENTLY),
-- not pushed blindly through this file.
WITH planned_relations(schema_name, table_name) AS (
  VALUES
    ('private', 'item_deals'),
    ('public', 'admin_banner_uploads'),
    ('public', 'admin_tokens'),
    ('public', 'meetups'),
    ('public', 'notifications'),
    ('public', 'offers'),
    ('public', 'post_comments'),
    ('public', 'ratings'),
    ('public', 'wechat_media_checks')
), relation_sizes AS (
  SELECT
    planned.schema_name,
    planned.table_name,
    pg_catalog.pg_total_relation_size(
      pg_catalog.format('%I.%I', planned.schema_name, planned.table_name)::regclass
    ) AS total_bytes
  FROM planned_relations AS planned
)
SELECT
  schema_name,
  table_name,
  total_bytes,
  pg_catalog.pg_size_pretty(total_bytes) AS total_size,
  total_bytes <= 64 * 1024 * 1024 AS safe_for_transactional_index
FROM relation_sizes
ORDER BY total_bytes DESC;

DO $deployment_capacity$
DECLARE
  oversized text;
  conflicting_sessions text;
BEGIN
  WITH planned_relations(schema_name, table_name) AS (
    VALUES
      ('private', 'item_deals'),
      ('public', 'admin_banner_uploads'),
      ('public', 'admin_tokens'),
      ('public', 'meetups'),
      ('public', 'notifications'),
      ('public', 'offers'),
      ('public', 'post_comments'),
      ('public', 'ratings'),
      ('public', 'wechat_media_checks')
  )
  SELECT pg_catalog.string_agg(
           pg_catalog.format('%I.%I=%s', schema_name, table_name,
             pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(
               pg_catalog.format('%I.%I', schema_name, table_name)::regclass))),
           ', '
         )
    INTO oversized
  FROM planned_relations
  WHERE pg_catalog.pg_total_relation_size(
          pg_catalog.format('%I.%I', schema_name, table_name)::regclass
        ) > 64 * 1024 * 1024;

  IF oversized IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: transactional index tables exceed 64 MiB; use reviewed concurrent maintenance: %',
      oversized;
  END IF;

  WITH planned_oids AS (
    SELECT pg_catalog.format('%I.%I', schema_name, table_name)::regclass::oid AS oid
    FROM (VALUES
      ('private', 'item_deals'),
      ('public', 'admin_banner_uploads'),
      ('public', 'admin_tokens'),
      ('public', 'meetups'),
      ('public', 'notifications'),
      ('public', 'offers'),
      ('public', 'post_comments'),
      ('public', 'ratings'),
      ('public', 'wechat_media_checks')
    ) AS planned(schema_name, table_name)
  )
  SELECT pg_catalog.string_agg(DISTINCT activity.pid::text, ', ')
    INTO conflicting_sessions
  FROM pg_catalog.pg_locks AS held
  JOIN planned_oids ON planned_oids.oid = held.relation
  JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid = held.pid
  WHERE held.granted
    AND held.pid <> pg_catalog.pg_backend_pid()
    AND activity.xact_start IS NOT NULL
    AND pg_catalog.now() - activity.xact_start > interval '30 seconds'
    AND held.mode IN (
      'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareRowExclusiveLock',
      'ExclusiveLock', 'AccessExclusiveLock'
    );

  IF conflicting_sessions IS NOT NULL THEN
    RAISE EXCEPTION
      'precheck_failed: long target-table transactions must drain before index rollout (pids %)',
      conflicting_sessions;
  END IF;
END
$deployment_capacity$;

ROLLBACK;
