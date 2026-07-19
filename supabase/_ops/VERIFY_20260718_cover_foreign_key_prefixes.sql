-- Read-only post-deploy verification for FK prefix indexes.

\set ON_ERROR_STOP on

BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  target record;
  table_oid oid;
  column_attnum smallint;
  uncovered_count integer;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('private', 'item_deals', 'conversation_id', 'item_deals_conversation_id_idx'),
      ('private', 'item_deals', 'owner_id', 'item_deals_owner_id_idx'),
      ('private', 'item_deals', 'counterparty_id', 'item_deals_counterparty_id_idx'),
      ('public', 'admin_banner_uploads', 'actor_id', 'admin_banner_uploads_actor_id_idx'),
      ('public', 'admin_tokens', 'created_by', 'admin_tokens_created_by_idx'),
      ('public', 'meetups', 'from_user', 'meetups_from_user_idx'),
      ('public', 'meetups', 'item_id', 'meetups_item_id_idx'),
      ('public', 'meetups', 'parent_meetup_id', 'meetups_parent_meetup_id_idx'),
      ('public', 'meetups', 'to_user', 'meetups_to_user_idx'),
      ('public', 'notifications', 'item_id', 'notifications_item_id_idx'),
      ('public', 'offers', 'from_user', 'offers_from_user_idx'),
      ('public', 'offers', 'item_id', 'offers_item_id_idx'),
      ('public', 'offers', 'parent_offer_id', 'offers_parent_offer_id_idx'),
      ('public', 'offers', 'to_user', 'offers_to_user_idx'),
      ('public', 'post_comments', 'parent_comment_id', 'post_comments_parent_comment_id_idx'),
      ('public', 'post_comments', 'user_id', 'post_comments_user_id_idx'),
      ('public', 'ratings', 'item_id', 'ratings_item_id_idx'),
      ('public', 'wechat_media_checks', 'user_id', 'wechat_media_checks_user_id_idx')
    ) AS required(schema_name, table_name, column_name, index_name)
  LOOP
    table_oid := pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', target.schema_name, target.table_name)
    );
    SELECT attribute.attnum
      INTO column_attnum
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = table_oid
      AND attribute.attname = target.column_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF table_oid IS NULL OR column_attnum IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation
        ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_namespace AS index_namespace
        ON index_namespace.oid = index_relation.relnamespace
      JOIN pg_catalog.pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE index_namespace.nspname = target.schema_name
        AND index_relation.relname = target.index_name
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
      RAISE EXCEPTION 'verify_failed: index %.% does not exactly cover %.%.%',
        target.schema_name,
        target.index_name,
        target.schema_name,
        target.table_name,
        target.column_name;
    END IF;
  END LOOP;

  WITH foreign_keys AS (
    SELECT foreign_key.conrelid, foreign_key.conkey
    FROM pg_catalog.pg_constraint AS foreign_key
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = foreign_key.conrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE foreign_key.contype = 'f'
      AND namespace.nspname IN ('public', 'private')
  )
  SELECT pg_catalog.count(*)::integer
    INTO uncovered_count
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
  );

  IF uncovered_count <> 0 THEN
    RAISE EXCEPTION 'verify_failed: % foreign keys remain without a btree prefix index',
      uncovered_count;
  END IF;
END
$verify$;

SELECT
  index_namespace.nspname AS schema_name,
  index_relation.relname AS index_name,
  pg_catalog.pg_get_indexdef(index_relation.oid) AS definition
FROM pg_catalog.pg_class AS index_relation
JOIN pg_catalog.pg_namespace AS index_namespace
  ON index_namespace.oid = index_relation.relnamespace
WHERE (index_namespace.nspname, index_relation.relname) IN (
  ('private', 'item_deals_conversation_id_idx'),
  ('private', 'item_deals_owner_id_idx'),
  ('private', 'item_deals_counterparty_id_idx'),
  ('public', 'admin_banner_uploads_actor_id_idx'),
  ('public', 'admin_tokens_created_by_idx'),
  ('public', 'meetups_from_user_idx'),
  ('public', 'meetups_item_id_idx'),
  ('public', 'meetups_parent_meetup_id_idx'),
  ('public', 'meetups_to_user_idx'),
  ('public', 'notifications_item_id_idx'),
  ('public', 'offers_from_user_idx'),
  ('public', 'offers_item_id_idx'),
  ('public', 'offers_parent_offer_id_idx'),
  ('public', 'offers_to_user_idx'),
  ('public', 'post_comments_parent_comment_id_idx'),
  ('public', 'post_comments_user_id_idx'),
  ('public', 'ratings_item_id_idx'),
  ('public', 'wechat_media_checks_user_id_idx')
)
ORDER BY index_namespace.nspname, index_relation.relname;

ROLLBACK;
