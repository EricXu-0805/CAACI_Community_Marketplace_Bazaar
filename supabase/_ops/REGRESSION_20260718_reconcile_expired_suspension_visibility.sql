-- Isolated/local behavioral regression for
-- 20260718160000_reconcile_expired_suspension_visibility.sql.
-- NEVER run against production. Every fixture mutation is rolled back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'expired-l3@example.test', '{}'),
  ('e6000000-0000-4000-8000-000000000002', 'active-l3@example.test', '{}'),
  ('e6000000-0000-4000-8000-000000000003', 'active-l2@example.test', '{}'),
  ('e6000000-0000-4000-8000-000000000004', 'active-l5@example.test', '{}'),
  ('e6000000-0000-4000-8000-000000000005', 'lifted-l5@example.test', '{}'),
  ('e6000000-0000-4000-8000-000000000006', 'future-l3@example.test', '{}'),
  ('e6000000-0000-4000-8000-000000000007', 'viewer@example.test', '{}'),
  ('e6000000-0000-4000-8000-000000000008', 'overlap@example.test', '{}')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO public.profiles (id, nickname, email, created_at) VALUES
  ('e6000000-0000-4000-8000-000000000001', 'Expired L3', 'expired-l3@example.test', '2026-01-01 00:00:00+00'),
  ('e6000000-0000-4000-8000-000000000002', 'Active L3', 'active-l3@example.test', '2026-01-01 00:00:00+00'),
  ('e6000000-0000-4000-8000-000000000003', 'Active L2', 'active-l2@example.test', '2026-01-01 00:00:00+00'),
  ('e6000000-0000-4000-8000-000000000004', 'Active L5', 'active-l5@example.test', '2026-01-01 00:00:00+00'),
  ('e6000000-0000-4000-8000-000000000005', 'Lifted L5', 'lifted-l5@example.test', '2026-01-01 00:00:00+00'),
  ('e6000000-0000-4000-8000-000000000006', 'Future L3', 'future-l3@example.test', '2026-01-01 00:00:00+00'),
  ('e6000000-0000-4000-8000-000000000007', 'Viewer', 'viewer@example.test', '2026-01-01 00:00:00+00'),
  ('e6000000-0000-4000-8000-000000000008', 'Overlap', 'overlap@example.test', '2026-01-01 00:00:00+00')
ON CONFLICT (id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email,
  created_at = EXCLUDED.created_at;

INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, status
) VALUES
  ('e6200000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'expired item', '', 1, 'other', 'good', 'active'),
  ('e6200000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000002', 'active l3 item', '', 1, 'other', 'good', 'active'),
  ('e6200000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000003', 'active l2 item', '', 1, 'other', 'good', 'active'),
  ('e6200000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000004', 'active l5 item', '', 1, 'other', 'good', 'active'),
  ('e6200000-0000-4000-8000-000000000005', 'e6000000-0000-4000-8000-000000000005', 'lifted item', '', 1, 'other', 'good', 'active'),
  ('e6200000-0000-4000-8000-000000000006', 'e6000000-0000-4000-8000-000000000006', 'future item', '', 1, 'other', 'good', 'active'),
  ('e6200000-0000-4000-8000-000000000008', 'e6000000-0000-4000-8000-000000000008', 'overlap item', '', 1, 'other', 'good', 'active'),
  ('e6200000-0000-4000-8000-000000000009', 'e6000000-0000-4000-8000-000000000007', 'deleted item', '', 1, 'other', 'good', 'deleted');

INSERT INTO public.posts (id, user_id, content, status) VALUES
  ('e6300000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'expired post', 'active'),
  ('e6300000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000002', 'active l3 post', 'active'),
  ('e6300000-0000-4000-8000-000000000003', 'e6000000-0000-4000-8000-000000000003', 'active l2 post', 'active'),
  ('e6300000-0000-4000-8000-000000000004', 'e6000000-0000-4000-8000-000000000004', 'active l5 post', 'active'),
  ('e6300000-0000-4000-8000-000000000005', 'e6000000-0000-4000-8000-000000000005', 'lifted post', 'active'),
  ('e6300000-0000-4000-8000-000000000006', 'e6000000-0000-4000-8000-000000000006', 'future post', 'active'),
  ('e6300000-0000-4000-8000-000000000008', 'e6000000-0000-4000-8000-000000000008', 'overlap post', 'active'),
  ('e6300000-0000-4000-8000-000000000009', 'e6000000-0000-4000-8000-000000000007', 'hidden post', 'hidden'),
  ('e6300000-0000-4000-8000-000000000010', 'e6000000-0000-4000-8000-000000000007', 'deleted post', 'deleted');

INSERT INTO public.suspensions (
  id, profile_id, level, reason, category,
  started_at, ends_at, lifted_at, appeal_note, created_at
) VALUES
  (
    'e6100000-0000-4000-8000-000000000001',
    'e6000000-0000-4000-8000-000000000001',
    3, 'expired l3', 'regression',
    pg_catalog.now() - interval '10 days',
    pg_catalog.now() - interval '1 day',
    NULL, 'expired appeal remains in the human review queue',
    pg_catalog.now() - interval '10 days'
  ),
  (
    'e6100000-0000-4000-8000-000000000002',
    'e6000000-0000-4000-8000-000000000002',
    3, 'active l3', 'regression',
    pg_catalog.now() - interval '1 day',
    pg_catalog.now() + interval '7 days',
    NULL, 'active appeal should remain pending',
    pg_catalog.now() - interval '1 day'
  ),
  (
    'e6100000-0000-4000-8000-000000000003',
    'e6000000-0000-4000-8000-000000000003',
    2, 'active l2', 'regression',
    pg_catalog.now() - interval '1 day',
    pg_catalog.now() + interval '2 days',
    NULL, NULL, pg_catalog.now() - interval '1 day'
  ),
  (
    'e6100000-0000-4000-8000-000000000004',
    'e6000000-0000-4000-8000-000000000004',
    5, 'active permanent l5', 'regression',
    pg_catalog.now() - interval '1 day',
    'infinity'::timestamptz,
    NULL, NULL, pg_catalog.now() - interval '1 day'
  ),
  (
    'e6100000-0000-4000-8000-000000000005',
    'e6000000-0000-4000-8000-000000000005',
    5, 'lifted l5', 'regression',
    pg_catalog.now() - interval '1 day',
    'infinity'::timestamptz,
    pg_catalog.now() - interval '12 hours',
    NULL, pg_catalog.now() - interval '1 day'
  ),
  (
    'e6100000-0000-4000-8000-000000000006',
    'e6000000-0000-4000-8000-000000000006',
    3, 'future l3', 'regression',
    pg_catalog.now() + interval '1 day',
    pg_catalog.now() + interval '8 days',
    NULL, NULL, pg_catalog.now()
  ),
  (
    'e6100000-0000-4000-8000-000000000007',
    'e6000000-0000-4000-8000-000000000008',
    4, 'expired overlapping l4', 'regression',
    pg_catalog.now() - interval '40 days',
    pg_catalog.now() - interval '10 days',
    NULL, NULL, pg_catalog.now() - interval '40 days'
  ),
  (
    'e6100000-0000-4000-8000-000000000008',
    'e6000000-0000-4000-8000-000000000008',
    2, 'active overlapping l2', 'regression',
    pg_catalog.now() - interval '1 day',
    pg_catalog.now() + interval '2 days',
    NULL, NULL, pg_catalog.now() - interval '1 day'
  );

-- One attachment is publicly visible; the other belongs to an active L3
-- author and must disappear with its parent post. These rows also prove the
-- nested Plaza relation follows the same moderation boundary as posts/items.
INSERT INTO public.post_items (post_id, item_id, display_order) VALUES
  (
    'e6300000-0000-4000-8000-000000000001',
    'e6200000-0000-4000-8000-000000000001',
    0
  ),
  (
    'e6300000-0000-4000-8000-000000000002',
    'e6200000-0000-4000-8000-000000000002',
    0
  );

-- Deliberately invert the compatibility caches.  Every assertion below must
-- continue to follow suspensions, not these stale values.
UPDATE public.profiles
SET suspension_level = CASE id
      WHEN 'e6000000-0000-4000-8000-000000000001' THEN 3
      WHEN 'e6000000-0000-4000-8000-000000000005' THEN 5
      WHEN 'e6000000-0000-4000-8000-000000000006' THEN 3
      WHEN 'e6000000-0000-4000-8000-000000000008' THEN 4
      ELSE 0
    END,
    suspended_until = CASE id
      WHEN 'e6000000-0000-4000-8000-000000000001'
        THEN pg_catalog.now() - interval '1 day'
      WHEN 'e6000000-0000-4000-8000-000000000005'
        THEN 'infinity'::timestamptz
      WHEN 'e6000000-0000-4000-8000-000000000006'
        THEN pg_catalog.now() + interval '8 days'
      WHEN 'e6000000-0000-4000-8000-000000000008'
        THEN pg_catalog.now() - interval '10 days'
      ELSE NULL
    END,
    shadow_banned = id IN (
      'e6000000-0000-4000-8000-000000000001',
      'e6000000-0000-4000-8000-000000000005',
      'e6000000-0000-4000-8000-000000000006',
      'e6000000-0000-4000-8000-000000000008'
    ),
    trust_score = CASE
      WHEN id IN (
        'e6000000-0000-4000-8000-000000000001',
        'e6000000-0000-4000-8000-000000000005',
        'e6000000-0000-4000-8000-000000000006',
        'e6000000-0000-4000-8000-000000000008'
      ) THEN 0
      ELSE 100
    END
WHERE id::text LIKE 'e6000000-0000-4000-8000-%';

DO $canonical_state$
DECLARE
  state record;
BEGIN
  SELECT * INTO STRICT state
  FROM moderation_private.current_profile_state(
    'e6000000-0000-4000-8000-000000000001'
  );
  IF state.suspension_level <> 0
     OR state.suspended_until IS NOT NULL
     OR state.shadow_banned THEN
    RAISE EXCEPTION 'regression_failed: expired L3 remained active';
  END IF;

  SELECT * INTO STRICT state
  FROM moderation_private.current_profile_state(
    'e6000000-0000-4000-8000-000000000002'
  );
  IF state.suspension_level <> 3 OR NOT state.shadow_banned THEN
    RAISE EXCEPTION 'regression_failed: active L3 not shadow-active';
  END IF;

  SELECT * INTO STRICT state
  FROM moderation_private.current_profile_state(
    'e6000000-0000-4000-8000-000000000003'
  );
  IF state.suspension_level <> 2 OR state.shadow_banned THEN
    RAISE EXCEPTION 'regression_failed: active L2 visibility state';
  END IF;

  SELECT * INTO STRICT state
  FROM moderation_private.current_profile_state(
    'e6000000-0000-4000-8000-000000000004'
  );
  IF state.suspension_level <> 5
     OR state.suspended_until <> 'infinity'::timestamptz
     OR NOT state.shadow_banned THEN
    RAISE EXCEPTION 'regression_failed: permanent L5 was not preserved';
  END IF;

  SELECT * INTO STRICT state
  FROM moderation_private.current_profile_state(
    'e6000000-0000-4000-8000-000000000005'
  );
  IF state.suspension_level <> 0 OR state.shadow_banned THEN
    RAISE EXCEPTION 'regression_failed: lifted L5 remained active';
  END IF;

  SELECT * INTO STRICT state
  FROM moderation_private.current_profile_state(
    'e6000000-0000-4000-8000-000000000006'
  );
  IF state.suspension_level <> 0 OR state.shadow_banned THEN
    RAISE EXCEPTION 'regression_failed: future L3 activated early';
  END IF;

  SELECT * INTO STRICT state
  FROM moderation_private.current_profile_state(
    'e6000000-0000-4000-8000-000000000008'
  );
  IF state.suspension_level <> 2 OR state.shadow_banned THEN
    RAISE EXCEPTION
      'regression_failed: expired L4 overrode current overlapping L2';
  END IF;
END
$canonical_state$;

DO $trust_score$
DECLARE
  active_l3_score smallint;
  active_l3_toggled_score smallint;
  active_l2_score smallint;
  expired_score smallint;
  expired_toggled_score smallint;
BEGIN
  active_l3_score := public.compute_trust_score(
    'e6000000-0000-4000-8000-000000000002'
  );
  active_l2_score := public.compute_trust_score(
    'e6000000-0000-4000-8000-000000000003'
  );
  IF active_l3_score <> active_l2_score - 10 THEN
    RAISE EXCEPTION
      'regression_failed: active L3 shadow penalty expected % got %',
      active_l2_score - 10,
      active_l3_score;
  END IF;

  UPDATE public.profiles SET shadow_banned = true
  WHERE id = 'e6000000-0000-4000-8000-000000000002';
  active_l3_toggled_score := public.compute_trust_score(
    'e6000000-0000-4000-8000-000000000002'
  );
  IF active_l3_toggled_score <> active_l3_score THEN
    RAISE EXCEPTION 'regression_failed: trust score read active cache boolean';
  END IF;

  expired_score := public.compute_trust_score(
    'e6000000-0000-4000-8000-000000000001'
  );
  UPDATE public.profiles SET shadow_banned = false
  WHERE id = 'e6000000-0000-4000-8000-000000000001';
  expired_toggled_score := public.compute_trust_score(
    'e6000000-0000-4000-8000-000000000001'
  );
  IF expired_toggled_score <> expired_score THEN
    RAISE EXCEPTION 'regression_failed: expired trust score read cache boolean';
  END IF;
END
$trust_score$;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

DO $anonymous_visibility$
DECLARE
  item_count integer;
  post_count integer;
  post_item_count integer;
  item_view_count integer;
  post_view_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO item_count
  FROM public.items
  WHERE id IN (
    'e6200000-0000-4000-8000-000000000001',
    'e6200000-0000-4000-8000-000000000002',
    'e6200000-0000-4000-8000-000000000003',
    'e6200000-0000-4000-8000-000000000004',
    'e6200000-0000-4000-8000-000000000005',
    'e6200000-0000-4000-8000-000000000006',
    'e6200000-0000-4000-8000-000000000008'
  );
  SELECT pg_catalog.count(*)::integer INTO post_count
  FROM public.posts
  WHERE id IN (
    'e6300000-0000-4000-8000-000000000001',
    'e6300000-0000-4000-8000-000000000002',
    'e6300000-0000-4000-8000-000000000003',
    'e6300000-0000-4000-8000-000000000004',
    'e6300000-0000-4000-8000-000000000005',
    'e6300000-0000-4000-8000-000000000006',
    'e6300000-0000-4000-8000-000000000008'
  );
  SELECT pg_catalog.count(*)::integer INTO item_view_count
  FROM public.items_visible
  WHERE id::text LIKE 'e6200000-0000-4000-8000-%';
  SELECT pg_catalog.count(*)::integer INTO post_view_count
  FROM public.posts_visible
  WHERE id::text LIKE 'e6300000-0000-4000-8000-%';
  SELECT pg_catalog.count(*)::integer INTO post_item_count
  FROM public.post_items
  WHERE post_id::text LIKE 'e6300000-0000-4000-8000-%';

  IF item_count <> 5 OR post_count <> 5
     OR item_view_count <> 5 OR post_view_count <> 5
     OR post_item_count <> 1 THEN
    RAISE EXCEPTION
      'regression_failed: anonymous visibility base/view/attachment counts %,%,%,%,%',
      item_count, post_count, item_view_count, post_view_count, post_item_count;
  END IF;
END
$anonymous_visibility$;

DO $anonymous_posting_gate_denied$
BEGIN
  BEGIN
    PERFORM public.is_posting_allowed(
      'e6000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION
      'regression_failed: anonymous caller enumerated posting gate';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$anonymous_posting_gate_denied$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000007',
  true
);

DO $other_user_visibility$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.items
    WHERE id IN (
      'e6200000-0000-4000-8000-000000000002',
      'e6200000-0000-4000-8000-000000000004'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.posts
    WHERE id IN (
      'e6300000-0000-4000-8000-000000000002',
      'e6300000-0000-4000-8000-000000000004'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.post_items
    WHERE post_id = 'e6300000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'regression_failed: other user saw active L3/L5 content';
  END IF;
END
$other_user_visibility$;

DO $other_user_attachment_denied$
BEGIN
  BEGIN
    INSERT INTO public.post_items (post_id, item_id, display_order) VALUES (
      'e6300000-0000-4000-8000-000000000001',
      'e6200000-0000-4000-8000-000000000005',
      1
    );
    RAISE EXCEPTION
      'regression_failed: non-owner attached another user item';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$other_user_attachment_denied$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000002',
  true
);

DO $owner_visibility_and_profile$
DECLARE
  own_item_count integer;
  own_post_count integer;
  profile_row public.profiles;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO own_item_count
  FROM public.items
  WHERE id = 'e6200000-0000-4000-8000-000000000002';
  SELECT pg_catalog.count(*)::integer INTO own_post_count
  FROM public.posts
  WHERE id = 'e6300000-0000-4000-8000-000000000002';
  SELECT * INTO STRICT profile_row
  FROM public.get_my_profile();

  IF own_item_count <> 1 OR own_post_count <> 1 THEN
    RAISE EXCEPTION 'regression_failed: content owner lost own shadow content';
  END IF;
  IF profile_row.suspension_level <> 3
     OR profile_row.suspended_until <= pg_catalog.now()
     OR NOT profile_row.shadow_banned
     OR profile_row.trust_score <> 25 THEN
    RAISE EXCEPTION 'regression_failed: get_my_profile returned stale state';
  END IF;
END
$owner_visibility_and_profile$;

DO $authenticated_posting_gate_denied$
BEGIN
  BEGIN
    -- This UUID belongs to another user and has an active L2 suspension. The
    -- call itself, not merely the boolean result, must be unavailable.
    PERFORM public.is_posting_allowed(
      'e6000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION
      'regression_failed: authenticated caller enumerated posting gate';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$authenticated_posting_gate_denied$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000003',
  true
);

DO $suspended_attachment_denied$
BEGIN
  BEGIN
    INSERT INTO public.post_items (post_id, item_id, display_order) VALUES (
      'e6300000-0000-4000-8000-000000000003',
      'e6200000-0000-4000-8000-000000000003',
      0
    );
    RAISE EXCEPTION
      'regression_failed: active L2 user attached an item';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$suspended_attachment_denied$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000001',
  true
);

DELETE FROM public.post_items
WHERE post_id = 'e6300000-0000-4000-8000-000000000001'
  AND item_id = 'e6200000-0000-4000-8000-000000000001';

INSERT INTO public.post_items (post_id, item_id, display_order) VALUES (
  'e6300000-0000-4000-8000-000000000001',
  'e6200000-0000-4000-8000-000000000001',
  0
);

DO $active_owner_attachment_round_trip$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.post_items
    WHERE post_id = 'e6300000-0000-4000-8000-000000000001'
      AND item_id = 'e6200000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION
      'regression_failed: active owner attachment round-trip failed';
  END IF;
END
$active_owner_attachment_round_trip$;

RESET ROLE;
SET LOCAL ROLE service_role;

DO $service_posting_gate$
BEGIN
  IF public.is_posting_allowed(
       'e6000000-0000-4000-8000-000000000002'
     )
     OR public.is_posting_allowed(
       'e6000000-0000-4000-8000-000000000003'
     )
     OR public.is_posting_allowed(
       'e6000000-0000-4000-8000-000000000004'
     )
     OR public.is_posting_allowed(
       'e6000000-0000-4000-8000-000000000008'
     )
     OR NOT public.is_posting_allowed(
       'e6000000-0000-4000-8000-000000000001'
     )
     OR NOT public.is_posting_allowed(
       'e6000000-0000-4000-8000-000000000005'
     )
     OR NOT public.is_posting_allowed(
       'e6000000-0000-4000-8000-000000000006'
     ) THEN
    RAISE EXCEPTION 'regression_failed: canonical posting gate matrix';
  END IF;
END
$service_posting_gate$;

RESET ROLE;

-- Trigger behavior is tested as the database owner (RLS bypass) with an auth
-- claim, isolating the trigger from unrelated INSERT-policy fixtures.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000001',
  true
);
INSERT INTO public.items (
  id, user_id, title, description, price, category, condition, status
) VALUES (
  'e6200000-0000-4000-8000-000000000099',
  'e6000000-0000-4000-8000-000000000001',
  'expired actor can publish', '', 1, 'other', 'good', 'active'
);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e6000000-0000-4000-8000-000000000003',
  true
);
DO $trigger_blocks_active$
BEGIN
  BEGIN
    INSERT INTO public.items (
      id, user_id, title, description, price, category, condition, status
    ) VALUES (
      'e6200000-0000-4000-8000-000000000100',
      'e6000000-0000-4000-8000-000000000003',
      'active actor must fail', '', 1, 'other', 'good', 'active'
    );
    RAISE EXCEPTION 'active suspension insert unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'suspension_active:2:%' THEN
      RAISE;
    END IF;
  END;
END
$trigger_blocks_active$;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.device_fingerprints (profile_id, fp_hash) VALUES
  ('e6000000-0000-4000-8000-000000000001', pg_catalog.repeat('e', 64)),
  ('e6000000-0000-4000-8000-000000000002', pg_catalog.repeat('e', 64));

-- A real Supabase project grants service_role base-table access and BYPASSRLS.
-- The compact local bootstrap used by this isolated regression does neither;
-- apply both only inside this transaction so the security-invoker view is
-- exercised under the production privilege shape.  ROLLBACK removes them.
GRANT SELECT ON public.items, public.posts TO service_role;
ALTER ROLE service_role BYPASSRLS;
SET LOCAL ROLE service_role;

DO $privileged_view_visibility$
DECLARE
  deleted_item_count integer;
  inactive_post_count integer;
  visible_item_count integer;
  visible_post_count integer;
BEGIN
  -- service_role bypasses base-table RLS.  These assertions prove the view
  -- predicates themselves retain lifecycle and suspension filtering.
  SELECT pg_catalog.count(*)::integer INTO deleted_item_count
  FROM public.items_visible
  WHERE id = 'e6200000-0000-4000-8000-000000000009';

  SELECT pg_catalog.count(*)::integer INTO inactive_post_count
  FROM public.posts_visible
  WHERE id IN (
    'e6300000-0000-4000-8000-000000000009',
    'e6300000-0000-4000-8000-000000000010'
  );

  SELECT pg_catalog.count(*)::integer INTO visible_item_count
  FROM public.items_visible
  WHERE id IN (
    'e6200000-0000-4000-8000-000000000001',
    'e6200000-0000-4000-8000-000000000002',
    'e6200000-0000-4000-8000-000000000003',
    'e6200000-0000-4000-8000-000000000004',
    'e6200000-0000-4000-8000-000000000005',
    'e6200000-0000-4000-8000-000000000006',
    'e6200000-0000-4000-8000-000000000008'
  );

  SELECT pg_catalog.count(*)::integer INTO visible_post_count
  FROM public.posts_visible
  WHERE id::text LIKE 'e6300000-0000-4000-8000-%';

  IF deleted_item_count <> 0
     OR inactive_post_count <> 0
     OR visible_item_count <> 5
     OR visible_post_count <> 5 THEN
    RAISE EXCEPTION
      'regression_failed: service_role view leaked lifecycle/moderation rows %,%,%,%',
      deleted_item_count, inactive_post_count,
      visible_item_count, visible_post_count;
  END IF;
END
$privileged_view_visibility$;

DO $admin_surfaces$
DECLARE
  stats record;
  user_row record;
  linked_row record;
  detail_row record;
  active_count integer;
  appeal_count integer;
  warning_count integer;
BEGIN
  SELECT * INTO STRICT stats FROM public.admin_dashboard_stats();
  IF stats.active_suspensions <> 4
     OR stats.pending_appeals <> 2
     OR stats.shadow_banned <> 2 THEN
    RAISE EXCEPTION
      'regression_failed: admin stats expected 4/2/2 got %/%/%',
      stats.active_suspensions,
      stats.pending_appeals,
      stats.shadow_banned;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO active_count
  FROM public.admin_list_suspensions(100, 0, true)
  WHERE profile_id::text LIKE 'e6000000-0000-4000-8000-%';
  IF active_count <> 4 THEN
    RAISE EXCEPTION
      'regression_failed: active suspension list expected 4 got %',
      active_count;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO appeal_count
  FROM public.admin_list_appeals(100, 0)
  WHERE profile_id::text LIKE 'e6000000-0000-4000-8000-%';
  IF appeal_count <> 2 THEN
    RAISE EXCEPTION
      'regression_failed: appeal evidence list expected 2 got %', appeal_count;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO warning_count
  FROM public.admin_list_warnings(100, 0)
  WHERE profile_id::text LIKE 'e6000000-0000-4000-8000-%';
  IF warning_count <> 4 THEN
    RAISE EXCEPTION
      'regression_failed: warning list expected 4 current actions got %',
      warning_count;
  END IF;

  SELECT * INTO STRICT user_row
  FROM public.admin_search_users('expired-l3@example.test', 10);
  IF user_row.suspension_level <> 0
     OR user_row.suspended_until IS NOT NULL
     OR user_row.shadow_banned
     OR user_row.trust_score <> 42 THEN
    RAISE EXCEPTION 'regression_failed: admin search exposed stale expiry';
  END IF;

  SELECT * INTO STRICT linked_row
  FROM public.admin_get_linked_accounts(
    'e6000000-0000-4000-8000-000000000002'
  )
  WHERE id = 'e6000000-0000-4000-8000-000000000001';
  IF linked_row.suspension_level <> 0 OR linked_row.shadow_banned THEN
    RAISE EXCEPTION 'regression_failed: linked account exposed stale expiry';
  END IF;

  SELECT * INTO STRICT detail_row
  FROM public.admin_get_suspension_detail(
    'e6100000-0000-4000-8000-000000000001'
  );
  IF detail_row.profile_trust_score <> 42 THEN
    RAISE EXCEPTION 'regression_failed: detail exposed cached trust score';
  END IF;
END
$admin_surfaces$;

RESET ROLE;

ROLLBACK;
