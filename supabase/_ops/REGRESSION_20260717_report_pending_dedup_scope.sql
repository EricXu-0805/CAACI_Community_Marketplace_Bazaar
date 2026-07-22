-- Isolated/local behavioral regression for migration 20260717143030.
-- NEVER run against production. Every fixture mutation is rolled back.

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
(
  '95000000-0000-0000-0000-000000000001',
  'report-dedup-regression@example.test',
  '{}'::jsonb
),
(
  '95000000-0000-0000-0000-000000000002',
  'report-dedup-target@example.test',
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
(
  '95000000-0000-0000-0000-000000000001',
  'Report Dedup Regression'
),
(
  '95000000-0000-0000-0000-000000000002',
  'Report Dedup Target'
)
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

-- The later evidence-retention migration rejects nonexistent/self/hidden
-- report targets. Keep this earlier dedup regression valid in the final chain
-- by reporting a real visible item owned by another account.
INSERT INTO public.items (
  id, user_id, title, description, price, status
) VALUES (
  '96000000-0000-0000-0000-000000000001',
  '95000000-0000-0000-0000-000000000002',
  'Report dedup target item',
  'Visible fixture for pending-report uniqueness',
  10,
  'active'
);

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '95000000-0000-0000-0000-000000000001',
  true
);

DO $test$
DECLARE
  reporter_id_value constant uuid :=
    '95000000-0000-0000-0000-000000000001';
  target_id_value constant uuid :=
    '96000000-0000-0000-0000-000000000001';
  first_report_id uuid;
  second_report_id uuid;
  third_report_id uuid;
  violation_name text;
  resolved_count integer;
  dismissed_count integer;
  pending_count integer;
BEGIN
  INSERT INTO public.reports (
    reporter_id, target_type, target_id, reason, status
  ) VALUES (
    reporter_id_value, 'item', target_id_value, 'first incident', 'pending'
  )
  RETURNING id INTO first_report_id;

  UPDATE public.reports
  SET status = 'resolved'
  WHERE id = first_report_id;

  -- A resolved report must not permanently suppress a later incident.
  INSERT INTO public.reports (
    reporter_id, target_type, target_id, reason, status
  ) VALUES (
    reporter_id_value, 'item', target_id_value, 'second incident', 'pending'
  )
  RETURNING id INTO second_report_id;

  UPDATE public.reports
  SET status = 'dismissed'
  WHERE id = second_report_id;

  -- A dismissed report must not permanently suppress a later incident either.
  INSERT INTO public.reports (
    reporter_id, target_type, target_id, reason, status
  ) VALUES (
    reporter_id_value, 'item', target_id_value, 'third incident', 'pending'
  )
  RETURNING id INTO third_report_id;

  -- While the third report remains pending, a duplicate pending report must be
  -- rejected by the partial unique index.
  BEGIN
    INSERT INTO public.reports (
      reporter_id, target_type, target_id, reason, status
    ) VALUES (
      reporter_id_value, 'item', target_id_value, 'duplicate pending', 'pending'
    );
    RAISE EXCEPTION 'expected duplicate pending report to fail';
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS violation_name = CONSTRAINT_NAME;
      IF violation_name <> 'uq_reports_pending_per_reporter_target' THEN
        RAISE EXCEPTION
          'duplicate pending report failed on unexpected constraint/index: %',
          violation_name;
      END IF;
  END;

  SELECT
    count(*) FILTER (WHERE status = 'resolved'),
    count(*) FILTER (WHERE status = 'dismissed'),
    count(*) FILTER (WHERE status = 'pending')
  INTO resolved_count, dismissed_count, pending_count
  FROM public.reports
  WHERE reporter_id = reporter_id_value
    AND target_type = 'item'
    AND target_id = target_id_value;

  IF resolved_count <> 1 OR dismissed_count <> 1 OR pending_count <> 1 THEN
    RAISE EXCEPTION
      'unexpected report state counts: resolved %, dismissed %, pending %',
      resolved_count, dismissed_count, pending_count;
  END IF;

  IF third_report_id IS NULL THEN
    RAISE EXCEPTION 'third report insert did not return an id';
  END IF;
END
$test$;

ROLLBACK;
