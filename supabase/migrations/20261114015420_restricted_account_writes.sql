-- D-49: an account under an active posting restriction (canonical level 2-5)
-- can read and tidy up, but cannot publish, edit, contact or transact.
-- Apply to production and pass VERIFY before any client that lets level 2-4
-- accounts browse is released; older clients keep working and simply receive
-- the refusal below on a refused write.
--
-- Every refusal is the existing one from public.trg_enforce_actor():
--   SQLSTATE P0001, suspension_active:<level>:<UTC seconds or permanent>
-- The decision is moderation_private.current_profile_state(), the active rows
-- of public.suspensions. The cached profiles.suspension_level column is never
-- read here. Expired, lifted and not-yet-started restrictions do not refuse.
--
-- Already refused and left as they are: new posts, replies, listings and
-- messages (public.trg_enforce_actor on INSERT). No table or column grant
-- changes; the one new EXECUTE grant lets an RLS policy call its own check.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Reissue only what the local full replay measured (PRECHECK repeats this for
-- the hosted database). A different body means the function was changed
-- outside this repository and the edit below must be reviewed against it.
DO $guard$
DECLARE
  expected record;
  stored text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.make_offer(uuid,numeric,uuid,text)', 'eee96bd736e5e44d28404fb5ffe2e42f'),
    ('public.respond_to_offer(uuid,text,uuid,numeric,text)', 'eedd35bdc442a1555de118ec9db12b54'),
    ('public.propose_meetup(uuid,text,timestamptz,uuid,text)', '63858426acbe8afa26138e97d8be06c3'),
    ('public.respond_to_meetup(uuid,text,uuid,text,timestamptz,text)', '4441017e1efe799192671e4f10f7e473'),
    ('public.reschedule_accepted_meetup(uuid,text,timestamptz,uuid,text)', '6f76780627aae2944da4af8ea57081ee'),
    ('public.submit_transaction_rating(uuid,uuid,integer,text,uuid)', '28afadd43500f64e6e481917239875df'),
    ('public.enforce_chat_block_boundary()', '8feb985943e203fb4a9b1f6f5bf6a506'),
    ('private.chat_media_access(text,boolean)', 'e6ff430f3706418b337508bcb7ae013c'),
    ('moderation_private.current_profile_state(uuid)', '9c0b020a7ecdaa83372062a1cc85edc6'),
    ('public.is_posting_allowed(uuid)', 'f572629404dca4e2f487fb437cd1b12d')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(routine.prosrc) INTO stored
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'restricted_account_writes_function_drift:%:%',
        expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;
END
$guard$;

-- The one refusal, kept in the exact shape of public.trg_enforce_actor().
CREATE FUNCTION moderation_private.assert_posting_allowed(profile_id_in uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_state record;
BEGIN
  SELECT *
  INTO STRICT current_state
  FROM moderation_private.current_profile_state(profile_id_in);

  IF current_state.suspension_level >= 2 THEN
    RAISE EXCEPTION 'suspension_active:%:%',
      current_state.suspension_level,
      CASE
        WHEN current_state.suspended_until IS NULL
          OR current_state.suspended_until = 'infinity'::timestamptz
          THEN 'permanent'
        ELSE pg_catalog.to_char(
          current_state.suspended_until AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
      END;
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION moderation_private.assert_posting_allowed(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION moderation_private.assert_posting_allowed(uuid) IS
  'Raises suspension_active:<level>:<until> (P0001) when the profile is under an active level 2-5 restriction. Internal: called by trusted triggers and RPC bodies only, never granted to API roles.';

-- Caller-bound form for RLS: true, or the refusal above. It takes no
-- argument, so it cannot be used to probe another account. A request without
-- a user claim gets false and therefore the ordinary RLS denial.
CREATE FUNCTION private.assert_current_account_posting_allowed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RETURN false;
  END IF;
  PERFORM moderation_private.assert_posting_allowed(actor_id);
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION private.assert_current_account_posting_allowed()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.assert_current_account_posting_allowed()
  TO authenticated;

-- One row trigger for the direct table writes. It refuses a statement only
-- when the caller actually adds a row or changes an authored value, so
-- deletes, sale completion, reservation, counters, consent, read flags and
-- no-op saves are untouched.
CREATE FUNCTION private.enforce_restricted_account_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  guarded boolean := false;
BEGIN
  -- The actor is the caller, never the owner of the row. Without an end-user
  -- claim this is service-role or worker maintenance: translations, counters,
  -- moderation and Storage bookkeeping still reach a restricted owner's rows.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_SCHEMA = 'storage' THEN
    guarded := NEW.bucket_id IN ('item-images', 'chat-media');
  ELSIF TG_OP = 'INSERT' THEN
    -- conversations, follows, post_likes, post_comment_likes, post_items
    guarded := true;
  ELSIF TG_TABLE_NAME = 'items' THEN
    -- Sale, reservation and counters stay open; only authored content and a
    -- return to active are refused. A supplied street receipt counts as
    -- content: apply_street_location_check clears it later in this statement.
    guarded := (
        NEW.title, NEW.description, NEW.price, NEW.images, NEW.image_dimensions,
        NEW.location, NEW.category, NEW.listing_details, NEW.negotiable,
        NEW.condition, NEW.title_i18n, NEW.description_i18n, NEW.source_lang,
        NEW.location_check_token
      ) IS DISTINCT FROM (
        OLD.title, OLD.description, OLD.price, OLD.images, OLD.image_dimensions,
        OLD.location, OLD.category, OLD.listing_details, OLD.negotiable,
        OLD.condition, OLD.title_i18n, OLD.description_i18n, OLD.source_lang,
        OLD.location_check_token
      )
      OR (
        NEW.status = 'active'::public.item_status
        AND OLD.status IS DISTINCT FROM NEW.status
      );
  ELSIF TG_TABLE_NAME = 'posts' THEN
    guarded := (
        NEW.content, NEW.title, NEW.category, NEW.images, NEW.image_dimensions,
        NEW.content_i18n, NEW.source_lang
      ) IS DISTINCT FROM (
        OLD.content, OLD.title, OLD.category, OLD.images, OLD.image_dimensions,
        OLD.content_i18n, OLD.source_lang
      );
  ELSIF TG_TABLE_NAME = 'post_comments' THEN
    guarded := (NEW.content, NEW.content_i18n)
      IS DISTINCT FROM (OLD.content, OLD.content_i18n);
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    guarded := (
        NEW.nickname, NEW.avatar_url, NEW.bio, NEW.location, NEW.status_text,
        NEW.status_emoji
      ) IS DISTINCT FROM (
        OLD.nickname, OLD.avatar_url, OLD.bio, OLD.location, OLD.status_text,
        OLD.status_emoji
      );
  ELSE
    RAISE EXCEPTION 'restricted_account_write: unsupported attachment %.%',
      TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  IF guarded THEN
    PERFORM moderation_private.assert_posting_allowed(actor_id);
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.enforce_restricted_account_write()
  FROM PUBLIC, anon, authenticated, service_role;

-- The name sorts ahead of every other BEFORE ROW trigger on these tables
-- (VERIFY checks the order), so a restricted account is told why before any
-- payload, rate-limit or quota rule runs.
CREATE TRIGGER aa_restricted_account_write
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();
CREATE TRIGGER aa_restricted_account_write
  BEFORE INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();
CREATE TRIGGER aa_restricted_account_write
  BEFORE INSERT ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();
CREATE TRIGGER aa_restricted_account_write
  BEFORE INSERT ON public.post_comment_likes
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();
CREATE TRIGGER aa_restricted_account_write
  BEFORE INSERT ON public.post_items
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();

-- Column lists keep the trigger off statements that cannot edit content:
-- view and favorite counters, read flags, consent, fingerprints. They name
-- every authored column, not only the ones a client may write today, so a
-- later column grant cannot open an edit path for restricted accounts.
CREATE TRIGGER aa_restricted_account_write
  BEFORE UPDATE OF title, description, price, images, image_dimensions, location,
    category, listing_details, negotiable, condition, title_i18n,
    description_i18n, source_lang, location_check_token, status
  ON public.items
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();
CREATE TRIGGER aa_restricted_account_write
  BEFORE UPDATE OF content, title, category, images, image_dimensions,
    content_i18n, source_lang
  ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();
CREATE TRIGGER aa_restricted_account_write
  BEFORE UPDATE OF content, content_i18n
  ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();
CREATE TRIGGER aa_restricted_account_write
  BEFORE UPDATE OF nickname, avatar_url, bio, location, status_text, status_emoji
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();

-- Uploads to the two user buckets. Storage tests an upload with the caller's
-- own claims before it accepts any bytes; the later service write that records
-- the finished object carries no user claim and is not touched.
CREATE TRIGGER aa_restricted_account_write
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION private.enforce_restricted_account_write();

-- The same rule at the authorization boundary. RESTRICTIVE policies are ANDed
-- with every current and future permissive Storage policy. CASE keeps the
-- check away from other buckets. No SELECT, DELETE or UPDATE USING rule is
-- added: reading and removing existing files stays open.
CREATE POLICY restricted_account_blocks_upload_insert
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    CASE
      WHEN bucket_id IN ('item-images', 'chat-media')
        THEN private.assert_current_account_posting_allowed()
      ELSE true
    END
  );
CREATE POLICY restricted_account_blocks_upload_update
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    CASE
      WHEN bucket_id IN ('item-images', 'chat-media')
        THEN private.assert_current_account_posting_allowed()
      ELSE true
    END
  );

-- Offers, meetups and ratings are written only through these six RPCs. Each
-- body is the stored one plus the check right after the caller is identified.
-- Signatures, defaults, owner and grants are unchanged.
CREATE OR REPLACE FUNCTION public.make_offer(
  p_conversation_id uuid,
  p_price numeric,
  expected_user_id_in uuid,
  p_note text DEFAULT NULL
) RETURNS public.offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_to uuid;
  v_offer public.offers;
  v_item_status public.item_status;
  v_negotiable boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  -- D-49: an account under an active posting restriction is refused here,
  -- before anything is read, locked or written.
  PERFORM moderation_private.assert_posting_allowed(v_uid);

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_conv.id IS NULL
     OR NOT private.current_user_can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status, item.negotiable
    INTO v_item_status, v_negotiable
  FROM public.items AS item
  WHERE item.id = v_conv.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status)
     OR v_negotiable IS NOT TRUE THEN
    RAISE EXCEPTION 'item_unavailable_for_offer' USING ERRCODE = '55000';
  END IF;

  -- Structured offers must be strictly positive even though the storage
  -- constraint is intentionally broader for historical rows.
  IF p_price IS NULL OR p_price <= 0 OR p_price > 1000000 THEN
    RAISE EXCEPTION 'invalid price' USING ERRCODE = '22023';
  END IF;

  v_to := CASE
    WHEN v_uid = v_conv.buyer_id THEN v_conv.seller_id
    ELSE v_conv.buyer_id
  END;

  INSERT INTO public.offers (
    conversation_id, item_id, from_user, to_user, price, note
  ) VALUES (
    p_conversation_id,
    v_conv.item_id,
    v_uid,
    v_to,
    pg_catalog.round(p_price, 2),
    NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '')
  )
  RETURNING * INTO v_offer;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = p_conversation_id;

  INSERT INTO public.notifications (
    user_id, type, title, body, item_id, conversation_id
  )
  VALUES (
    v_to,
    'offer',
    '新报价 · New offer',
    '$' || pg_catalog.trim_scale(pg_catalog.round(p_price, 2))::text,
    v_conv.item_id,
    p_conversation_id
  );

  RETURN v_offer;
END
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_offer(
  p_offer_id uuid,
  p_action text,
  expected_user_id_in uuid,
  p_counter_price numeric DEFAULT NULL,
  p_counter_note text DEFAULT NULL
) RETURNS public.offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_offer public.offers;
  v_new public.offers;
  v_item_status public.item_status;
  v_negotiable boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  -- D-49: an account under an active posting restriction is refused here,
  -- before anything is read, locked or written.
  PERFORM moderation_private.assert_posting_allowed(v_uid);

  SELECT * INTO v_offer
  FROM public.offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF v_offer.id IS NULL
     OR v_uid <> v_offer.to_user
     OR NOT private.current_user_can_access_conversation(v_offer.conversation_id) THEN
    RAISE EXCEPTION 'offer_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status, item.negotiable
    INTO v_item_status, v_negotiable
  FROM public.items AS item
  WHERE item.id = v_offer.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status)
     OR v_negotiable IS NOT TRUE THEN
    RAISE EXCEPTION 'item_unavailable_for_offer' USING ERRCODE = '55000';
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'offer is no longer pending' USING ERRCODE = '55000';
  END IF;

  IF v_offer.expires_at <= pg_catalog.now() THEN
    UPDATE public.offers
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = p_offer_id
    RETURNING * INTO v_offer;

    -- Do not RAISE after the UPDATE: an exception would roll the state change
    -- back and leave this already-expired row permanently marked pending. The
    -- RPC already returns public.offers, so returning the expired row preserves
    -- the client contract and lets the caller refetch/render the terminal state.
    RETURN v_offer;
  END IF;

  IF p_action = 'accept' THEN
    UPDATE public.offers
    SET status = 'accepted', updated_at = pg_catalog.now()
    WHERE id = p_offer_id
    RETURNING * INTO v_offer;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_offer.from_user,
      'offer',
      '报价被接受 · Offer accepted',
      '$' || pg_catalog.trim_scale(v_offer.price)::text,
      v_offer.item_id,
      v_offer.conversation_id
    );

    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_offer.conversation_id;
    RETURN v_offer;

  ELSIF p_action = 'decline' THEN
    UPDATE public.offers
    SET status = 'declined', updated_at = pg_catalog.now()
    WHERE id = p_offer_id
    RETURNING * INTO v_offer;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_offer.from_user,
      'offer',
      '报价被拒绝 · Offer declined',
      '$' || pg_catalog.trim_scale(v_offer.price)::text,
      v_offer.item_id,
      v_offer.conversation_id
    );
    RETURN v_offer;

  ELSIF p_action = 'counter' THEN
    IF p_counter_price IS NULL OR p_counter_price <= 0 OR p_counter_price > 1000000 THEN
      RAISE EXCEPTION 'invalid counter price' USING ERRCODE = '22023';
    END IF;

    UPDATE public.offers
    SET status = 'countered', updated_at = pg_catalog.now()
    WHERE id = p_offer_id;

    INSERT INTO public.offers (
      conversation_id, item_id, from_user, to_user, price, note, parent_offer_id
    ) VALUES (
      v_offer.conversation_id,
      v_offer.item_id,
      v_uid,
      v_offer.from_user,
      pg_catalog.round(p_counter_price, 2),
      NULLIF(pg_catalog.btrim(COALESCE(p_counter_note, '')), ''),
      v_offer.id
    )
    RETURNING * INTO v_new;

    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_offer.conversation_id;

    INSERT INTO public.notifications (
      user_id, type, title, body, item_id, conversation_id
    )
    VALUES (
      v_offer.from_user,
      'offer',
      '收到还价 · Counter-offer',
      '$' || pg_catalog.trim_scale(pg_catalog.round(p_counter_price, 2))::text,
      v_offer.item_id,
      v_offer.conversation_id
    );
    RETURN v_new;

  ELSE
    RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.propose_meetup(
  p_conversation_id uuid,
  p_spot text,
  p_meet_at timestamptz,
  expected_user_id_in uuid,
  p_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_to uuid;
  v_spot text;
  v_meetup public.meetups;
  v_item_status public.item_status;
  v_notification_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  -- D-49: an account under an active posting restriction is refused here,
  -- before anything is read, locked or written.
  PERFORM moderation_private.assert_posting_allowed(v_uid);

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id;

  IF v_conv.id IS NULL
     OR NOT private.current_user_can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_conv.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_conversation_id::text)::bigint
  );

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = p_conversation_id
      AND status = 'pending'
      AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup proposal is already pending' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = p_conversation_id
      AND status = 'accepted'
      AND meet_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup is already confirmed; reschedule it instead'
      USING ERRCODE = '55000';
  END IF;

  v_spot := pg_catalog.btrim(COALESCE(p_spot, ''));
  IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
    RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
  END IF;
  IF p_meet_at IS NULL
     OR p_meet_at < pg_catalog.now() - interval '2 hours'
     OR p_meet_at > pg_catalog.now() + interval '90 days' THEN
    RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
  END IF;

  v_to := CASE
    WHEN v_uid = v_conv.buyer_id THEN v_conv.seller_id
    ELSE v_conv.buyer_id
  END;

  INSERT INTO public.meetups (
    conversation_id, item_id, from_user, to_user, spot, meet_at, note
  ) VALUES (
    p_conversation_id,
    v_conv.item_id,
    v_uid,
    v_to,
    v_spot,
    p_meet_at,
    NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '')
  )
  RETURNING * INTO v_meetup;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = p_conversation_id;

  v_notification_id := private.enqueue_meetup_event_notification(
    v_meetup.id,
    'pending',
    v_to,
    '见面提议 · Meetup proposed',
    v_spot,
    v_conv.item_id,
    p_conversation_id
  );
  IF v_notification_id IS NULL THEN
    RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
  END IF;
  RETURN v_meetup;
END
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_meetup(
  p_meetup_id uuid,
  p_action text,
  expected_user_id_in uuid,
  p_new_spot text DEFAULT NULL,
  p_new_meet_at timestamptz DEFAULT NULL,
  p_new_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_meetup public.meetups;
  v_new public.meetups;
  v_spot text;
  v_item_status public.item_status;
  v_notification_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  -- D-49: an account under an active posting restriction is refused here,
  -- before anything is read, locked or written.
  PERFORM moderation_private.assert_posting_allowed(v_uid);

  SELECT * INTO v_meetup
  FROM public.meetups
  WHERE id = p_meetup_id
  FOR UPDATE;

  IF v_meetup.id IS NULL
     OR v_uid <> v_meetup.to_user
     OR NOT private.current_user_can_access_conversation(v_meetup.conversation_id) THEN
    RAISE EXCEPTION 'meetup_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_meetup.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  IF v_meetup.status <> 'pending' THEN
    RAISE EXCEPTION 'meetup is no longer pending' USING ERRCODE = '55000';
  END IF;
  IF v_meetup.expires_at <= pg_catalog.now() THEN
    UPDATE public.meetups
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;
    RETURN v_meetup;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_meetup.conversation_id::text)::bigint
  );

  IF p_action = 'accept' THEN
    IF EXISTS (
      SELECT 1 FROM public.meetups
      WHERE conversation_id = v_meetup.conversation_id
        AND status = 'accepted'
        AND meet_at > pg_catalog.now()
        AND id <> p_meetup_id
    ) THEN
      RAISE EXCEPTION 'another meetup is already confirmed' USING ERRCODE = '55000';
    END IF;

    UPDATE public.meetups
    SET status = 'accepted', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;

    v_notification_id := private.enqueue_meetup_event_notification(
      v_meetup.id,
      'accepted',
      v_meetup.from_user,
      '约定已确认 · Meetup confirmed',
      v_meetup.spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    IF v_notification_id IS NULL THEN
      RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
    END IF;
    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_meetup.conversation_id;
    RETURN v_meetup;

  ELSIF p_action = 'decline' THEN
    UPDATE public.meetups
    SET status = 'declined', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id
    RETURNING * INTO v_meetup;

    v_notification_id := private.enqueue_meetup_event_notification(
      v_meetup.id,
      'declined',
      v_meetup.from_user,
      '约定被婉拒 · Meetup declined',
      v_meetup.spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    IF v_notification_id IS NULL THEN
      RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
    END IF;
    RETURN v_meetup;

  ELSIF p_action = 'reschedule' THEN
    v_spot := pg_catalog.btrim(COALESCE(p_new_spot, ''));
    IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
      RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
    END IF;
    IF p_new_meet_at IS NULL
       OR p_new_meet_at < pg_catalog.now() - interval '2 hours'
       OR p_new_meet_at > pg_catalog.now() + interval '90 days' THEN
      RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
    END IF;

    UPDATE public.meetups
    SET status = 'rescheduled', updated_at = pg_catalog.now()
    WHERE id = p_meetup_id;

    INSERT INTO public.meetups (
      conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id
    ) VALUES (
      v_meetup.conversation_id,
      v_meetup.item_id,
      v_uid,
      v_meetup.from_user,
      v_spot,
      p_new_meet_at,
      NULLIF(pg_catalog.btrim(COALESCE(p_new_note, '')), ''),
      v_meetup.id
    )
    RETURNING * INTO v_new;

    UPDATE public.conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_meetup.conversation_id;

    v_notification_id := private.enqueue_meetup_event_notification(
      v_new.id,
      'pending',
      v_meetup.from_user,
      '新的见面提议 · Meetup updated',
      v_spot,
      v_meetup.item_id,
      v_meetup.conversation_id
    );
    IF v_notification_id IS NULL THEN
      RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
    END IF;
    RETURN v_new;

  ELSE
    RAISE EXCEPTION 'unknown action' USING ERRCODE = '22023';
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_accepted_meetup(
  p_meetup_id uuid,
  p_new_spot text,
  p_new_meet_at timestamptz,
  expected_user_id_in uuid,
  p_new_note text DEFAULT NULL
) RETURNS public.meetups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_meetup public.meetups;
  v_new public.meetups;
  v_spot text;
  v_other uuid;
  v_item_status public.item_status;
  v_notification_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  -- D-49: an account under an active posting restriction is refused here,
  -- before anything is read, locked or written.
  PERFORM moderation_private.assert_posting_allowed(v_uid);

  SELECT * INTO v_meetup
  FROM public.meetups
  WHERE id = p_meetup_id
  FOR UPDATE;

  IF v_meetup.id IS NULL
     OR v_uid NOT IN (v_meetup.from_user, v_meetup.to_user)
     OR NOT private.current_user_can_access_conversation(v_meetup.conversation_id) THEN
    RAISE EXCEPTION 'meetup_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT item.status INTO v_item_status
  FROM public.items AS item
  WHERE item.id = v_meetup.item_id;

  IF v_item_status IS NULL
     OR v_item_status IN ('sold'::public.item_status, 'deleted'::public.item_status) THEN
    RAISE EXCEPTION 'item_unavailable_for_meetup' USING ERRCODE = '55000';
  END IF;

  IF v_meetup.status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted meetup can be rescheduled' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_meetup.conversation_id::text)::bigint
  );

  IF EXISTS (
    SELECT 1 FROM public.meetups
    WHERE conversation_id = v_meetup.conversation_id
      AND status = 'pending'
      AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'a meetup proposal is already pending' USING ERRCODE = '55000';
  END IF;

  v_spot := pg_catalog.btrim(COALESCE(p_new_spot, ''));
  IF pg_catalog.char_length(v_spot) = 0 OR pg_catalog.char_length(v_spot) > 120 THEN
    RAISE EXCEPTION 'invalid spot' USING ERRCODE = '22023';
  END IF;
  IF p_new_meet_at IS NULL
     OR p_new_meet_at < pg_catalog.now() - interval '2 hours'
     OR p_new_meet_at > pg_catalog.now() + interval '90 days' THEN
    RAISE EXCEPTION 'invalid meet time' USING ERRCODE = '22023';
  END IF;

  v_other := CASE
    WHEN v_uid = v_meetup.from_user THEN v_meetup.to_user
    ELSE v_meetup.from_user
  END;

  UPDATE public.meetups
  SET status = 'rescheduled', updated_at = pg_catalog.now()
  WHERE id = p_meetup_id;

  INSERT INTO public.meetups (
    conversation_id, item_id, from_user, to_user, spot, meet_at, note, parent_meetup_id
  ) VALUES (
    v_meetup.conversation_id,
    v_meetup.item_id,
    v_uid,
    v_other,
    v_spot,
    p_new_meet_at,
    NULLIF(pg_catalog.btrim(COALESCE(p_new_note, '')), ''),
    v_meetup.id
  )
  RETURNING * INTO v_new;

  UPDATE public.conversations
  SET last_message_at = pg_catalog.now()
  WHERE id = v_meetup.conversation_id;

  v_notification_id := private.enqueue_meetup_event_notification(
    v_new.id,
    'pending',
    v_other,
    '改约请求 · Meetup change requested',
    v_spot,
    v_meetup.item_id,
    v_meetup.conversation_id
  );
  IF v_notification_id IS NULL THEN
    RAISE EXCEPTION 'meetup_notification_not_created' USING ERRCODE = '23514';
  END IF;
  RETURN v_new;
END
$function$;

CREATE OR REPLACE FUNCTION public.submit_transaction_rating(
  p_item_id uuid,
  p_ratee_id uuid,
  p_stars integer,
  p_comment text,
  expected_user_id_in uuid
)
RETURNS public.ratings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  item_state public.item_status;
  deal_owner_id uuid;
  deal_counterparty_id uuid;
  expected_ratee_id uuid;
  cleaned_comment text;
  existing_rating public.ratings;
  created_rating public.ratings;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF expected_user_id_in IS DISTINCT FROM caller_id THEN
    RAISE EXCEPTION 'account_changed' USING ERRCODE = '42501';
  END IF;
  -- D-49: an account under an active posting restriction is refused here,
  -- before anything is read, locked or written.
  PERFORM moderation_private.assert_posting_allowed(caller_id);
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'invalid_rating_stars' USING ERRCODE = '22023';
  END IF;

  cleaned_comment := NULLIF(pg_catalog.btrim(COALESCE(p_comment, '')), '');
  IF cleaned_comment IS NOT NULL AND pg_catalog.length(cleaned_comment) > 500 THEN
    RAISE EXCEPTION 'rating_comment_too_long' USING ERRCODE = '22023';
  END IF;

  -- The item lock serializes two tabs submitting the same direction. This lets
  -- a response-lost retry return the identical row while rejecting an attempt
  -- to rewrite stars/comment under the original unique key.
  SELECT item.status, deal.owner_id, deal.counterparty_id
    INTO item_state, deal_owner_id, deal_counterparty_id
  FROM public.items AS item
  INNER JOIN private.item_deals AS deal ON deal.item_id = item.id
  WHERE item.id = p_item_id
  FOR UPDATE OF item;

  IF item_state IS DISTINCT FROM 'sold'::public.item_status
     OR deal_owner_id IS NULL
     OR deal_counterparty_id IS NULL
     OR caller_id NOT IN (deal_owner_id, deal_counterparty_id) THEN
    RAISE EXCEPTION 'rating_not_permitted' USING ERRCODE = '42501';
  END IF;

  expected_ratee_id := CASE
    WHEN caller_id = deal_owner_id THEN deal_counterparty_id
    ELSE deal_owner_id
  END;
  IF p_ratee_id IS DISTINCT FROM expected_ratee_id THEN
    RAISE EXCEPTION 'rating_not_permitted' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing_rating
  FROM public.ratings AS rating
  WHERE rating.item_id = p_item_id
    AND rating.rater_id = caller_id
    AND rating.ratee_id = expected_ratee_id;

  IF existing_rating.id IS NOT NULL THEN
    IF existing_rating.stars = p_stars
       AND existing_rating.comment IS NOT DISTINCT FROM cleaned_comment THEN
      RETURN existing_rating;
    END IF;
    RAISE EXCEPTION 'rating_already_submitted' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.ratings (
    rater_id, ratee_id, item_id, stars, comment
  ) VALUES (
    caller_id, expected_ratee_id, p_item_id, p_stars, cleaned_comment
  )
  RETURNING * INTO created_rating;

  RETURN created_rating;
END
$function$;

-- Starting a conversation. The trigger above refuses a restricted caller for
-- listing and direct threads alike. The existing rule that both people in a
-- direct thread must be unrestricted now reads the action log as well.
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
        -- Both people must exist and be free of an active posting restriction.
        -- The answer comes from the action log, not the cached profile columns,
        -- and stays inside this non-callable trigger: the caller learns nothing
        -- about the other person's state (D-49).
        IF (SELECT count(*) FROM public.profiles p
            WHERE p.id IN (buyer, seller)
              AND public.is_posting_allowed(p.id)) <> 2 THEN
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

-- Private chat attachments: reading and removing an unsent draft no longer
-- depend on the posting restriction.
CREATE OR REPLACE FUNCTION private.chat_media_access(object_name text, for_write boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE c public.conversations; actor uuid := auth.uid();
BEGIN
  IF object_name IS NULL OR EXISTS(SELECT 1 FROM private.chat_media_gc WHERE name=object_name) THEN RETURN false; END IF;
  IF actor IS NULL OR object_name !~ '^items/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|mp4|mov|webm)$' THEN RETURN false; END IF;
  SELECT * INTO c FROM public.conversations WHERE id=split_part(object_name,'/',3)::uuid;
  IF NOT FOUND OR split_part(object_name,'/',2) NOT IN(c.buyer_id::text,c.seller_id::text)
    OR NOT private.current_user_can_access_pair(c.buyer_id,c.seller_id)
    OR NOT private.current_account_storage_writes_allowed() THEN RETURN false; END IF;
  -- D-49: a posting restriction no longer hides attachments a participant may
  -- already read, or stops the owner removing an unsent draft. New uploads are
  -- refused by the restricted-account trigger and policy on storage.objects,
  -- and new messages by the actor trigger on public.messages.
  IF for_write THEN RETURN split_part(object_name,'/',2)=actor::text; END IF;
  -- The sender may inspect an upload before sending; the recipient cannot list
  -- abandoned drafts. A committed message grants recipient access.
  RETURN split_part(object_name,'/',2)=actor::text OR EXISTS (
    SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id
      AND m.message_type IN ('image','video') AND m.content=object_name
  );
END $function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
