-- Staging-only, rollback-only integration probe. All three identities are
-- synthetic, no Auth login/email delivery, and no existing user is contacted.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
INSERT INTO auth.users(id,email,aud,role,raw_user_meta_data)
SELECT ('caac0916-2026-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       'direct-probe-'||n||'@example.invalid', 'authenticated','authenticated',
       '{"nickname":"Synthetic UI probe"}'::jsonb FROM generate_series(901,903) n;
SET LOCAL request.jwt.claim.sub = 'caac0916-2026-4000-8000-000000000901';
SET LOCAL ROLE authenticated;
WITH created AS (
  INSERT INTO public.conversations(buyer_id,seller_id,is_direct)
  VALUES(auth.uid(),'caac0916-2026-4000-8000-000000000902',true) RETURNING id
) SELECT set_config('direct_probe.conversation',id::text,true) FROM created;
INSERT INTO public.messages(conversation_id,sender_id,content,message_type)
VALUES(current_setting('direct_probe.conversation')::uuid,auth.uid(),'Hello from the synthetic direct conversation probe.','text');
DO $check$ BEGIN
  IF (SELECT count(*) FROM public.conversations WHERE id=current_setting('direct_probe.conversation')::uuid AND is_direct AND item_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'direct probe: creator cannot read direct conversation';
  END IF;
END $check$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'caac0916-2026-4000-8000-000000000902';
SET LOCAL ROLE authenticated;
DO $check$ BEGIN
  IF (SELECT count(*) FROM public.messages WHERE conversation_id=current_setting('direct_probe.conversation')::uuid) <> 1 THEN
    RAISE EXCEPTION 'direct probe: recipient cannot read';
  END IF;
  BEGIN
    INSERT INTO public.conversations(buyer_id,seller_id,is_direct)
    VALUES(auth.uid(),'caac0916-2026-4000-8000-000000000901',true);
    RAISE EXCEPTION 'direct probe: reversed pair duplicated';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $check$;
INSERT INTO public.blocks(blocker_id,blocked_id)
VALUES(auth.uid(),'caac0916-2026-4000-8000-000000000901');
DO $check$ BEGIN
  IF EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=current_setting('direct_probe.conversation')::uuid) THEN
    RAISE EXCEPTION 'direct probe: blocked messages still readable';
  END IF;
END $check$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'caac0916-2026-4000-8000-000000000901';
SET LOCAL ROLE authenticated;
DO $check$ BEGIN
  IF EXISTS(SELECT 1 FROM public.conversations WHERE id=current_setting('direct_probe.conversation')::uuid) THEN
    RAISE EXCEPTION 'direct probe: block not bilateral';
  END IF;
  BEGIN
    INSERT INTO public.messages(conversation_id,sender_id,content,message_type)
    VALUES(current_setting('direct_probe.conversation')::uuid,auth.uid(),'This blocked probe must be rejected.','text');
    RAISE EXCEPTION 'direct probe: blocked write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $check$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'caac0916-2026-4000-8000-000000000903';
SET LOCAL ROLE authenticated;
DO $check$ BEGIN
  IF EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=current_setting('direct_probe.conversation')::uuid) THEN
    RAISE EXCEPTION 'direct probe: third party read allowed';
  END IF;
END $check$;
SELECT 'PASS: hosted RLS, message triggers, reverse-pair uniqueness and bilateral block; rolling back synthetic transaction' AS result;
ROLLBACK;
