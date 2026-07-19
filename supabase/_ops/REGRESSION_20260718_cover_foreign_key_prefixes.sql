-- Local/isolated planner regression for FK prefix indexes. Never run against
-- production: this test changes planner settings inside a rolled-back txn.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL enable_seqscan = off;

DO $regression$
DECLARE
  target record;
  plan_json json;
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
    EXECUTE pg_catalog.format(
      'EXPLAIN (FORMAT JSON, COSTS OFF) SELECT 1 FROM %I.%I WHERE %I = $1',
      target.schema_name,
      target.table_name,
      target.column_name
    )
    INTO plan_json
    USING '00000000-0000-0000-0000-000000000000'::uuid;

    IF pg_catalog.strpos(plan_json::text, target.index_name) = 0 THEN
      RAISE EXCEPTION 'regression_failed: planner did not use %.% for %.%.%',
        target.schema_name,
        target.index_name,
        target.schema_name,
        target.table_name,
        target.column_name;
    END IF;
  END LOOP;
END
$regression$;

ROLLBACK;
