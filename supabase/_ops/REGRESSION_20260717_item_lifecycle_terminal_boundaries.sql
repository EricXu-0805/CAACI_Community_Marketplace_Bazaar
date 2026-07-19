-- Isolated/local behavioral regression for migration 20260717145701.
-- NEVER run against production. All fixture and DDL changes are rolled back.

BEGIN;

-- Exercise trigger behavior independently of row visibility policies. Client
-- table/column privileges still apply, and the RLS state is restored by ROLLBACK.
ALTER TABLE public.items DISABLE ROW LEVEL SECURITY;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('97000000-0000-0000-0000-000000000001', 'lifecycle-owner@example.test', '{}'::jsonb),
  ('97000000-0000-0000-0000-000000000002', 'lifecycle-rater@example.test', '{}'::jsonb),
  ('97000000-0000-0000-0000-000000000003', 'lifecycle-soft-account@example.test', '{}'::jsonb),
  ('97000000-0000-0000-0000-000000000004', 'lifecycle-hard-account@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('97000000-0000-0000-0000-000000000001', 'Lifecycle Owner'),
  ('97000000-0000-0000-0000-000000000002', 'Lifecycle Rater'),
  ('97000000-0000-0000-0000-000000000003', 'Lifecycle Soft Account'),
  ('97000000-0000-0000-0000-000000000004', 'Lifecycle Hard Account')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, status
) VALUES
  ('97100000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', 'Lifecycle active edge', 'fixture', 1, 'other', 'good', 'active'),
  ('97100000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Lifecycle reserved edge', 'fixture', 1, 'other', 'good', 'reserved'),
  ('97100000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', 'Lifecycle protected sold', 'fixture', 1, 'other', 'good', 'sold'),
  ('97100000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000001', 'Lifecycle active delete', 'fixture', 1, 'other', 'good', 'active'),
  ('97100000-0000-0000-0000-000000000005', '97000000-0000-0000-0000-000000000001', 'Lifecycle moderation terminal', 'fixture', 1, 'other', 'good', 'active'),
  ('97100000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000001', 'Lifecycle service bypass', 'fixture', 1, 'other', 'good', 'sold'),
  ('97100000-0000-0000-0000-000000000007', '97000000-0000-0000-0000-000000000001', 'Lifecycle admin bypass', 'fixture', 1, 'other', 'good', 'active'),
  ('97100000-0000-0000-0000-000000000008', '97000000-0000-0000-0000-000000000003', 'Lifecycle soft account', 'fixture', 1, 'other', 'good', 'sold'),
  ('97100000-0000-0000-0000-000000000009', '97000000-0000-0000-0000-000000000004', 'Lifecycle hard account', 'fixture', 1, 'other', 'good', 'sold'),
  ('97100000-0000-0000-0000-000000000010', '97000000-0000-0000-0000-000000000001', 'Lifecycle definer bypass', 'fixture', 1, 'other', 'good', 'sold'),
  ('97100000-0000-0000-0000-000000000011', '97000000-0000-0000-0000-000000000001', 'Lifecycle reserved delete', 'fixture', 1, 'other', 'good', 'reserved');

INSERT INTO public.ratings (id, rater_id, ratee_id, item_id, stars, comment) VALUES
  ('97200000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', '97100000-0000-0000-0000-000000000003', 5, 'must survive rejected client delete'),
  ('97200000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', '97100000-0000-0000-0000-000000000010', 5, 'definer cascade fixture');

-- This rollback-only helper proves that a SECURITY DEFINER owner path keeps
-- working even when invoked by an authenticated client role.
CREATE FUNCTION public._regression_owner_delete_sold_item(item_id_in uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  DELETE FROM public.items WHERE id = item_id_in;
$function$;

REVOKE ALL ON FUNCTION public._regression_owner_delete_sold_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._regression_owner_delete_sold_item(uuid)
  TO authenticated;

DO $test$
DECLARE
  affected integer;
  actual_status text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claim.sub',
    '97000000-0000-0000-0000-000000000001',
    true
  );

  -- Active/reserved same-status content edits and every supported lifecycle
  -- transition must succeed.
  UPDATE public.items
  SET title = 'Lifecycle active edge edited'
  WHERE id = '97100000-0000-0000-0000-000000000001';
  UPDATE public.items
  SET title = 'Lifecycle reserved edge edited'
  WHERE id = '97100000-0000-0000-0000-000000000002';
  UPDATE public.items
  SET status = 'reserved'
  WHERE id = '97100000-0000-0000-0000-000000000001';
  UPDATE public.items
  SET status = 'active'
  WHERE id = '97100000-0000-0000-0000-000000000001';

  -- In the final release state, a sold transition is intentionally narrower
  -- than the original lifecycle migration: every sale must go through
  -- mark_item_sold so it creates durable deal attribution. A stale client
  -- direct UPDATE must fail atomically for both active and reserved rows.
  BEGIN
    UPDATE public.items
    SET status = 'sold'
    WHERE id IN (
      '97100000-0000-0000-0000-000000000001',
      '97100000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'expected unattributed client sale to fail';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mark_item_sold_rpc_required' THEN
      RAISE EXCEPTION 'unexpected direct-sale rejection: %', SQLERRM;
    END IF;
  END;

  -- Non-terminal rows retain the existing owner hard-delete behavior.
  DELETE FROM public.items
  WHERE id IN (
    '97100000-0000-0000-0000-000000000004',
    '97100000-0000-0000-0000-000000000011'
  );
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'expected active/reserved client deletes to remove two rows, got %', affected;
  END IF;

  BEGIN
    UPDATE public.items
    SET status = 'active'
    WHERE id = '97100000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'expected sold to active transition to fail';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'terminal_item_update_forbidden:sold' THEN
        RAISE EXCEPTION 'unexpected sold restore error: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'unexpected sold restore SQLSTATE %: %', SQLSTATE, SQLERRM;
  END;

  BEGIN
    UPDATE public.items
    SET title = 'client rewrote sold evidence'
    WHERE id = '97100000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'expected sold content update to fail';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'terminal_item_update_forbidden:sold' THEN
        RAISE EXCEPTION 'unexpected sold content-update error: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'unexpected sold content-update SQLSTATE %: %', SQLSTATE, SQLERRM;
  END;

  BEGIN
    DELETE FROM public.items
    WHERE id = '97100000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'expected sold item delete to fail';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'terminal_item_delete_forbidden:sold' THEN
        RAISE EXCEPTION 'unexpected sold delete error: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'unexpected sold delete SQLSTATE %: %', SQLSTATE, SQLERRM;
  END;

  -- Inspect preservation as the migration owner; ratings intentionally have
  -- no public SELECT policy, so an authenticated assertion would confuse RLS
  -- invisibility with a cascade delete.
  RESET ROLE;
  IF NOT EXISTS (
    SELECT 1 FROM public.items
    WHERE id = '97100000-0000-0000-0000-000000000003'
      AND status = 'sold'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.ratings
    WHERE id = '97200000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'rejected sold delete did not preserve item and rating';
  END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claim.sub',
    '97000000-0000-0000-0000-000000000001',
    true
  );

  BEGIN
    UPDATE public.items
    SET status = 'deleted'
    WHERE id = '97100000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'expected active to deleted client transition to fail';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'invalid_item_status_transition:active->deleted' THEN
        RAISE EXCEPTION 'unexpected client takedown error: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'unexpected client takedown SQLSTATE %: %', SQLSTATE, SQLERRM;
  END;

  RESET ROLE;
  UPDATE public.items
  SET status = 'deleted'
  WHERE id = '97100000-0000-0000-0000-000000000005';

  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claim.sub',
    '97000000-0000-0000-0000-000000000001',
    true
  );

  BEGIN
    UPDATE public.items
    SET title = 'client rewrote removed evidence'
    WHERE id = '97100000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'expected moderator-deleted content update to fail';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'terminal_item_update_forbidden:deleted' THEN
        RAISE EXCEPTION 'unexpected deleted content-update error: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'unexpected deleted content-update SQLSTATE %: %', SQLSTATE, SQLERRM;
  END;

  BEGIN
    UPDATE public.items
    SET status = 'active'
    WHERE id = '97100000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'expected moderator-deleted restore to fail';
  EXCEPTION
    WHEN raise_exception THEN
      IF position('moderator-managed' in SQLERRM) = 0 THEN
        RAISE EXCEPTION 'unexpected moderator restore error: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'unexpected moderator restore SQLSTATE %: %', SQLSTATE, SQLERRM;
  END;

  BEGIN
    DELETE FROM public.items
    WHERE id = '97100000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'expected moderator-deleted hard delete to fail';
  EXCEPTION
    WHEN object_not_in_prerequisite_state THEN
      IF SQLERRM <> 'terminal_item_delete_forbidden:deleted' THEN
        RAISE EXCEPTION 'unexpected deleted hard-delete error: %', SQLERRM;
      END IF;
    WHEN OTHERS THEN
      RAISE EXCEPTION 'unexpected deleted hard-delete SQLSTATE %: %', SQLSTATE, SQLERRM;
  END;

  -- A SECURITY DEFINER function changes current_user to its owner, so the sold
  -- item and its rating are intentionally deleted by this maintenance path.
  PERFORM public._regression_owner_delete_sold_item(
    '97100000-0000-0000-0000-000000000010'
  );

  IF EXISTS (
    SELECT 1 FROM public.items
    WHERE id = '97100000-0000-0000-0000-000000000010'
  ) OR EXISTS (
    SELECT 1 FROM public.ratings
    WHERE id = '97200000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION 'SECURITY DEFINER owner delete did not cascade as expected';
  END IF;

  -- The old soft account-deletion RPC is retired by the durable deletion saga.
  -- A stale browser call must fail and leave terminal evidence untouched.
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config(
    'request.jwt.claim.sub',
    '97000000-0000-0000-0000-000000000003',
    true
  );
  BEGIN
    PERFORM public.delete_my_account();
    RAISE EXCEPTION 'retired delete_my_account unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
    NULL;
  END;
  RESET ROLE;

  SELECT status::text
  INTO actual_status
  FROM public.items
  WHERE id = '97100000-0000-0000-0000-000000000008';
  IF actual_status <> 'sold' THEN
    RAISE EXCEPTION
      'rejected legacy account deletion changed sold item to %', actual_status;
  END IF;

  -- Direct service-role maintenance bypasses client terminal-content
  -- restrictions, but it still cannot fabricate an unattributed sale.
  SET LOCAL ROLE service_role;
  UPDATE public.items
  SET title = 'Lifecycle service bypass edited'
  WHERE id = '97100000-0000-0000-0000-000000000006';
  UPDATE public.items
  SET status = 'active'
  WHERE id = '97100000-0000-0000-0000-000000000006';
  BEGIN
    UPDATE public.items
    SET status = 'sold'
    WHERE id = '97100000-0000-0000-0000-000000000006';
    RAISE EXCEPTION 'expected unattributed service sale to fail';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'item_sale_attribution_required' THEN
      RAISE EXCEPTION 'unexpected service direct-sale rejection: %', SQLERRM;
    END IF;
  WHEN insufficient_privilege THEN
    -- The private ledger intentionally grants no direct visibility to
    -- service_role. In that stricter deployment shape, the trigger fails
    -- closed before it can test attribution and the definer RPC remains the
    -- only supported sale-finalization path.
    IF SQLERRM <> 'permission denied for schema private' THEN
      RAISE EXCEPTION 'unexpected service direct-sale privilege failure: %', SQLERRM;
    END IF;
  END;
  DELETE FROM public.items
  WHERE id = '97100000-0000-0000-0000-000000000006';
  RESET ROLE;

  IF EXISTS (
    SELECT 1 FROM public.items
    WHERE id = '97100000-0000-0000-0000-000000000006'
  ) THEN
    RAISE EXCEPTION 'service-role maintenance delete was unexpectedly blocked';
  END IF;

  -- The actual admin takedown RPC must still perform active -> deleted.
  SET LOCAL ROLE service_role;
  PERFORM public.admin_takedown_content(
    'item',
    '97100000-0000-0000-0000-000000000007',
    'lifecycle regression'
  );
  RESET ROLE;

  SELECT status::text
  INTO actual_status
  FROM public.items
  WHERE id = '97100000-0000-0000-0000-000000000007';
  IF actual_status <> 'deleted' THEN
    RAISE EXCEPTION 'admin takedown left item in status %', actual_status;
  END IF;

  -- The hard account deletion used by the API deletes auth.users and relies on
  -- FK cascades. Its sold item must still be removable under the admin owner.
  DELETE FROM auth.users
  WHERE id = '97000000-0000-0000-0000-000000000004';

  IF EXISTS (
    SELECT 1 FROM public.items
    WHERE id = '97100000-0000-0000-0000-000000000009'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '97000000-0000-0000-0000-000000000004'
  ) THEN
    RAISE EXCEPTION 'hard account deletion cascade was unexpectedly blocked';
  END IF;
END
$test$;

ROLLBACK;
