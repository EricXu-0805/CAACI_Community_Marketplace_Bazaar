-- Isolated/local behavioral regression for rolling submit_appeal account/row
-- intent compatibility. NEVER run against production. All fixtures roll back.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('9a000000-0000-0000-0000-000000000001', 'appeal-a@example.test', '{}'::jsonb),
  ('9a000000-0000-0000-0000-000000000002', 'appeal-b@example.test', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, nickname) VALUES
  ('9a000000-0000-0000-0000-000000000001', 'Appeal A'),
  ('9a000000-0000-0000-0000-000000000002', 'Appeal B')
ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname;

INSERT INTO public.suspensions (
  id, profile_id, level, reason, category, created_at, lifted_at, appeal_note
) VALUES
  (
    '9a100000-0000-0000-0000-000000000001',
    '9a000000-0000-0000-0000-000000000001',
    2, 'older exact target', 'regression', pg_catalog.now() - interval '2 days', NULL, NULL
  ),
  (
    '9a100000-0000-0000-0000-000000000002',
    '9a000000-0000-0000-0000-000000000001',
    3, 'newest legacy target', 'regression', pg_catalog.now() - interval '1 day', NULL, NULL
  ),
  (
    '9a100000-0000-0000-0000-000000000003',
    '9a000000-0000-0000-0000-000000000002',
    2, 'B valid target', 'regression', pg_catalog.now(), NULL, NULL
  ),
  (
    '9a100000-0000-0000-0000-000000000004',
    '9a000000-0000-0000-0000-000000000001',
    2, 'lifted target', 'regression', pg_catalog.now(), pg_catalog.now(), NULL
  ),
  (
    '9a100000-0000-0000-0000-000000000005',
    '9a000000-0000-0000-0000-000000000001',
    1, 'old active row must not receive retry', 'regression',
    pg_catalog.now() - interval '3 days', NULL, NULL
  );

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-0000-0000-000000000001',
  true
);

-- New clients bind both account and exact suspension.
SELECT public.submit_appeal(
  'This is account A first immutable exact appeal.',
  '9a000000-0000-0000-0000-000000000001',
  '9a100000-0000-0000-0000-000000000001'
);

DO $intent_boundaries$
DECLARE
  stored_note text;
BEGIN
  SELECT appeal_note INTO stored_note
  FROM public.suspensions
  WHERE id = '9a100000-0000-0000-0000-000000000001';
  IF stored_note IS DISTINCT FROM
       'This is account A first immutable exact appeal.' THEN
    RAISE EXCEPTION 'correct suspension did not receive exact appeal';
  END IF;

  BEGIN
    PERFORM public.submit_appeal(
      'A second exact submission must never overwrite.',
      '9a000000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'second exact appeal overwrote the first';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'appeal_unavailable' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.submit_appeal(
      'Wrong owner rows are not appealable.',
      '9a000000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'A appealed B suspension';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'appeal_unavailable' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.submit_appeal(
      'Lifted rows are not appealable here.',
      '9a000000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000004'
    );
    RAISE EXCEPTION 'lifted suspension accepted an appeal';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'appeal_unavailable' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.submit_appeal(
      'short',
      '9a000000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000002'
    );
    RAISE EXCEPTION 'exact appeal accepted an invalid note';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_appeal_length' THEN RAISE; END IF;
  END;
END
$intent_boundaries$;

-- Old clients remain operational. The legacy overload derives A from the JWT
-- and atomically targets A's newest active row, id=...002.
SELECT public.submit_appeal(
  'Legacy account A first immutable appeal.'::text
);

DO $legacy_first_writer$
BEGIN
  IF (SELECT appeal_note FROM public.suspensions
      WHERE id = '9a100000-0000-0000-0000-000000000002')
       IS DISTINCT FROM 'Legacy account A first immutable appeal.' THEN
    RAISE EXCEPTION 'legacy appeal did not target newest active suspension';
  END IF;

  BEGIN
    PERFORM public.submit_appeal(
      'Legacy retry must not fall back to an older suspension.'::text
    );
    RAISE EXCEPTION 'legacy retry overwrote/fell back after first writer';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'appeal_unavailable' THEN RAISE; END IF;
  END;

  IF (SELECT appeal_note FROM public.suspensions
      WHERE id = '9a100000-0000-0000-0000-000000000005') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy retry fell back to an older active suspension';
  END IF;

  BEGIN
    PERFORM public.submit_appeal('short'::text);
    RAISE EXCEPTION 'legacy appeal accepted an invalid note';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_appeal_length' THEN RAISE; END IF;
  END;
END
$legacy_first_writer$;

-- Simulate A capturing the exact form, then the browser session changing to B.
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  '9a000000-0000-0000-0000-000000000002',
  true
);

DO $account_switch$
BEGIN
  BEGIN
    PERFORM public.submit_appeal(
      'This text was captured for account A.',
      '9a000000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'A intent executed under B JWT';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'account_changed' THEN RAISE; END IF;
  END;

  IF (SELECT appeal_note FROM public.suspensions
      WHERE id = '9a100000-0000-0000-0000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'account-switch rejection wrote B appeal_note';
  END IF;
END
$account_switch$;

-- The old bundle under B's JWT can still submit B's own appeal.
SELECT public.submit_appeal(
  'Legacy account B owns this appeal and may submit it.'::text
);

DO $legacy_b_scope$
BEGIN
  IF (SELECT appeal_note FROM public.suspensions
      WHERE id = '9a100000-0000-0000-0000-000000000003')
       IS DISTINCT FROM
       'Legacy account B owns this appeal and may submit it.' THEN
    RAISE EXCEPTION 'legacy overload did not derive B from auth.uid';
  END IF;
END
$legacy_b_scope$;

RESET ROLE;

SET LOCAL ROLE anon;
DO $anon_acl$
BEGIN
  BEGIN
    PERFORM public.submit_appeal(
      'Anon must never submit through the legacy overload.'::text
    );
    RAISE EXCEPTION 'anon executed legacy submit_appeal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_appeal(
      'Anon must never submit through the intent overload.',
      '9a000000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000005'
    );
    RAISE EXCEPTION 'anon executed intent submit_appeal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$anon_acl$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $service_acl$
BEGIN
  BEGIN
    PERFORM public.submit_appeal(
      'Service role must use a separate trusted admin path.'::text
    );
    RAISE EXCEPTION 'service_role executed legacy submit_appeal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_appeal(
      'Service role must not impersonate the intent overload.',
      '9a000000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000005'
    );
    RAISE EXCEPTION 'service_role executed intent submit_appeal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$service_acl$;
RESET ROLE;

ROLLBACK;
