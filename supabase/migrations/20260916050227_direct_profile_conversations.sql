-- Expand before deploying the client. Existing listing and deleted-listing
-- threads keep is_direct=false; never merge their evidence into private DMs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $precheck$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.enforce_chat_block_boundary()'::regprocedure)
       IS DISTINCT FROM 'e552c3dddbde8c67512d89c10bf167d7'
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.conversations'::regclass)
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND cmd='INSERT') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversations' AND policyname='Unblocked buyers can create conversations' AND cmd='INSERT') THEN
    RAISE EXCEPTION 'direct_conversation_precheck_failed: chat boundary drift';
  END IF;
END
$precheck$;
ALTER TABLE public.conversations ADD COLUMN is_direct boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_direct_shape
  CHECK (NOT is_direct OR (item_id IS NULL AND buyer_id <> seller_id));
CREATE UNIQUE INDEX conversations_direct_pair_unique
  ON public.conversations (LEAST(buyer_id, seller_id), GREATEST(buyer_id, seller_id))
  WHERE is_direct;
CREATE INDEX conversations_direct_starts
  ON public.conversations (buyer_id, created_at) WHERE is_direct;
GRANT SELECT (is_direct), INSERT (is_direct) ON public.conversations TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_chat_block_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller uuid := auth.uid();
  buyer uuid;
  seller uuid;
  conversation_id_value uuid;
  item_owner uuid;
BEGIN
  IF caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'conversations' THEN
    buyer := NEW.buyer_id;
    seller := NEW.seller_id;

    IF TG_OP = 'UPDATE' AND NEW.is_direct IS DISTINCT FROM OLD.is_direct THEN
      RAISE EXCEPTION 'immutable_participant_fields' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_direct THEN
        IF NEW.item_id IS NOT NULL OR buyer = seller OR caller <> buyer THEN
          RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
        END IF;
        -- This lookup stays inside the existing non-callable trigger: private
        -- suspension fields must not be granted to browsers to start a chat.
        IF (SELECT count(*) FROM public.profiles p
            WHERE p.id IN (buyer, seller)
              AND NOT (p.suspension_level >= 2 AND (p.suspended_until IS NULL OR p.suspended_until > now()))) <> 2 THEN
          RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
        END IF;
      ELSE
        SELECT item.user_id INTO item_owner
        FROM public.items AS item
        WHERE item.id = NEW.item_id AND item.status <> 'deleted'::public.item_status;
        IF NEW.item_id IS NULL OR item_owner IS NULL OR item_owner <> seller THEN
          RAISE EXCEPTION 'invalid_conversation_item' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  ELSE
    conversation_id_value := NEW.conversation_id;
    SELECT conversation.buyer_id, conversation.seller_id
      INTO buyer, seller
    FROM public.conversations AS conversation
    WHERE conversation.id = conversation_id_value;
  END IF;

  IF buyer IS NULL OR seller IS NULL OR caller NOT IN (buyer, seller) THEN
    RAISE EXCEPTION 'conversation_unavailable'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      LEAST(buyer::text, seller::text) || ':' ||
      GREATEST(buyer::text, seller::text),
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.blocks AS block_relation
    WHERE (block_relation.blocker_id = buyer AND block_relation.blocked_id = seller)
       OR (block_relation.blocker_id = seller AND block_relation.blocked_id = buyer)
  ) THEN
    -- One generic error deliberately hides block direction from the caller.
    RAISE EXCEPTION 'conversation_unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'conversations' AND TG_OP = 'INSERT' THEN
    IF NEW.is_direct THEN
      -- Serialize starts across different peers as well as on the pair.
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('direct-start:' || caller::text, 0));
      IF (SELECT count(*) FROM public.conversations c WHERE c.is_direct AND c.buyer_id = caller AND c.created_at > now() - interval '1 minute') >= 10
         OR (SELECT count(*) FROM public.conversations c WHERE c.is_direct AND c.buyer_id = caller AND c.created_at > now() - interval '1 day') >= 100 THEN
        RAISE EXCEPTION 'rate_limit_conversations' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_chat_block_boundary()
  FROM PUBLIC, anon, authenticated, service_role;


-- Preserve the established participant-only SELECT/UPDATE and bilateral block
-- policies for all messages, media, realtime, flags and archives.
ALTER POLICY "Unblocked buyers can create conversations" ON public.conversations
  WITH CHECK (
    (SELECT auth.uid()) = buyer_id AND buyer_id <> seller_id
    AND private.current_user_can_access_pair(buyer_id, seller_id)
    AND (
      (is_direct AND item_id IS NULL)
      OR (NOT is_direct AND item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.items AS conversation_item
        WHERE conversation_item.id = conversations.item_id
          AND conversation_item.user_id = conversations.seller_id
          AND conversation_item.status <> 'deleted'::public.item_status
      ))
    )
  );
NOTIFY pgrst, 'reload schema';
COMMIT;
