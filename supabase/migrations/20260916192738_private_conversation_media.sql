SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
-- Private attachments: immutable owner/conversation/message paths, no public URLs.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('chat-media','chat-media',false,20971520,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm']);

CREATE INDEX messages_private_media_content_idx ON public.messages(content) WHERE message_type IN ('image','video');
-- Hosted storage tables are service-owned. Use the supplied bucket/name
-- prefix index instead of requiring managed-table ownership for custom indexes.

-- A claimed orphan can never be attached while the worker deletes its file.
CREATE TABLE private.chat_media_gc(name text PRIMARY KEY, attempted_at timestamptz);
ALTER TABLE private.chat_media_gc ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.chat_media_gc FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.chat_media_access(object_name text, for_write boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.conversations; actor uuid := auth.uid();
BEGIN
  IF object_name IS NULL OR EXISTS(SELECT 1 FROM private.chat_media_gc WHERE name=object_name) THEN RETURN false; END IF;
  IF actor IS NULL OR object_name !~ '^items/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|mp4|mov|webm)$' THEN RETURN false; END IF;
  SELECT * INTO c FROM public.conversations WHERE id=split_part(object_name,'/',3)::uuid;
  IF NOT FOUND OR split_part(object_name,'/',2) NOT IN(c.buyer_id::text,c.seller_id::text)
    OR NOT private.current_user_can_access_pair(c.buyer_id,c.seller_id)
    OR NOT private.current_account_storage_writes_allowed()
    OR NOT coalesce(public.is_posting_allowed(actor),false) THEN RETURN false; END IF;
  IF for_write THEN RETURN split_part(object_name,'/',2)=actor::text; END IF;
  -- The sender may inspect an upload before sending; the recipient cannot list
  -- abandoned drafts. A committed message grants recipient access.
  RETURN split_part(object_name,'/',2)=actor::text OR EXISTS (
    SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id
      AND m.message_type IN ('image','video') AND m.content=object_name
  );
END $$;
REVOKE ALL ON FUNCTION private.chat_media_access(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.chat_media_access(text,boolean) TO authenticated;

CREATE POLICY chat_media_participant_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='chat-media' AND private.chat_media_access(name,false));
CREATE POLICY chat_media_sender_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='chat-media' AND private.chat_media_access(name,true));
-- No UPDATE policy: an already-delivered attachment cannot be replaced.
CREATE POLICY chat_media_unlinked_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='chat-media' AND private.chat_media_access(name,true) AND NOT EXISTS (
   SELECT 1 FROM public.messages m WHERE m.content=name AND m.message_type IN ('image','video')
 ));

CREATE FUNCTION private.enforce_chat_media_upload() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bytes bigint; total_bytes bigint; object_count bigint; recent_count bigint; mime text;
BEGIN
 IF NEW.bucket_id<>'chat-media' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.name<>OLD.name OR NEW.bucket_id<>OLD.bucket_id OR NEW.metadata IS DISTINCT FROM OLD.metadata) THEN
   RAISE EXCEPTION 'chat_media_immutable' USING ERRCODE='22023';
 END IF;
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF NOT private.chat_media_access(NEW.name,true) THEN RAISE EXCEPTION 'chat_media_access_denied' USING ERRCODE='42501'; END IF;
 mime:=lower(NEW.metadata->>'mimetype');
 IF (NEW.metadata->>'size') IS NULL OR (NEW.metadata->>'size') !~ '^[1-9][0-9]{0,7}$' THEN
   RAISE EXCEPTION 'chat_media_invalid_size' USING ERRCODE='22023'; END IF;
 bytes:=(NEW.metadata->>'size')::bigint;
 IF mime IS NULL OR NOT ((mime='image/jpeg' AND NEW.name LIKE '%.jpg')
   OR (mime='image/png' AND NEW.name LIKE '%.png') OR (mime='image/webp' AND NEW.name LIKE '%.webp')
   OR (mime='image/gif' AND NEW.name LIKE '%.gif') OR (mime='video/mp4' AND NEW.name LIKE '%.mp4')
   OR (mime='video/quicktime' AND NEW.name LIKE '%.mov') OR (mime='video/webm' AND NEW.name LIKE '%.webm'))
   OR bytes>(CASE WHEN mime LIKE 'image/%' THEN 5242880 ELSE 20971520 END) THEN
   RAISE EXCEPTION 'chat_media_invalid_file' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,192738));
 SELECT count(*),count(*) FILTER(WHERE created_at>=now()-interval '1 hour'),
   coalesce(sum(CASE WHEN metadata->>'size' ~ '^[0-9]{1,8}$' THEN (metadata->>'size')::bigint ELSE 0 END),0)
 INTO object_count,recent_count,total_bytes FROM storage.objects
 WHERE bucket_id='chat-media'
   AND name COLLATE "C" >= ('items/'||auth.uid()::text||'/') COLLATE "C"
   AND name COLLATE "C" < ('items/'||auth.uid()::text||'0') COLLATE "C" AND id<>NEW.id;
 IF object_count>=500 OR total_bytes+bytes>524288000 OR (TG_OP='INSERT' AND recent_count>=30) THEN
   RAISE EXCEPTION 'chat_media_quota' USING ERRCODE='54000'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_chat_media_upload() FROM PUBLIC;
CREATE TRIGGER enforce_chat_media_upload BEFORE INSERT OR UPDATE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION private.enforce_chat_media_upload();

CREATE FUNCTION private.enforce_message_content_boundary() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  exact_stickers constant text[] := ARRAY[
    '[sticker:smile]',
    '[sticker:laugh]',
    '[sticker:love]',
    '[sticker:thumbs-up]',
    '[sticker:thumbs-down]',
    '[sticker:clap]',
    '[sticker:pray]',
    '[sticker:cry]',
    '[sticker:surprise]',
    '[sticker:sparkle]',
    '[sticker:fire]',
    '[sticker:question]',
    '[sticker:obo]',
    '[sticker:verified-pickup]',
    '[sticker:study-group]'
  ];
BEGIN
 IF TG_OP='UPDATE' AND NEW.content IS NOT DISTINCT FROM OLD.content AND NEW.message_type IS NOT DISTINCT FROM OLD.message_type THEN RETURN NEW; END IF;
 PERFORM private.assert_text_boundary(NEW.content,'message_content',1,2000,8000,false);
 IF NEW.message_type='text' THEN
   IF NEW.content=ANY(exact_stickers) THEN NULL;
   ELSIF NEW.content ~ '^\[sticker:[a-z-]+\]$' THEN RAISE EXCEPTION 'public_write_boundary:invalid_sticker' USING ERRCODE='22023';
   ELSE PERFORM private.assert_moderated_text(NEW.content,'message_content'); END IF;
 ELSE
   -- Serialize attachment against the orphan collector; a fresh snapshot after
   -- the lock sees a claim that won first and fails closed.
   PERFORM 1 FROM storage.objects WHERE bucket_id='chat-media' AND name=NEW.content FOR SHARE;
   IF NEW.message_type NOT IN ('image','video')
     OR NOT private.chat_media_access(NEW.content,true)
     OR split_part(NEW.content,'/',2)<>NEW.sender_id::text
     OR split_part(NEW.content,'/',3)<>NEW.conversation_id::text
     OR split_part(split_part(NEW.content,'/',4),'.',1)<>NEW.id::text
     OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='chat-media' AND o.name=NEW.content
       AND (o.metadata->>'mimetype') LIKE (NEW.message_type||'/%')) THEN
     RAISE EXCEPTION 'chat_media_invalid_reference' USING ERRCODE='22023';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_message_content_boundary() FROM PUBLIC;
DROP TRIGGER authoritative_public_write_boundary ON public.messages;
CREATE TRIGGER authoritative_public_write_boundary BEFORE INSERT OR UPDATE ON public.messages
 FOR EACH ROW EXECUTE FUNCTION private.enforce_message_content_boundary();
NOTIFY pgrst,'reload schema';

CREATE FUNCTION public.claim_chat_media_orphan() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate storage.objects; pending private.chat_media_gc;
BEGIN
 PERFORM pg_advisory_xact_lock(19273891);
 SELECT * INTO pending FROM private.chat_media_gc
 WHERE attempted_at<now()-interval '5 minutes' ORDER BY attempted_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF FOUND THEN
   UPDATE private.chat_media_gc SET attempted_at=now() WHERE name=pending.name;
   RETURN jsonb_build_object('name',pending.name);
 END IF;
 FOR candidate IN SELECT * FROM storage.objects o
   WHERE o.bucket_id='chat-media' AND o.created_at<now()-interval '24 hours'
     AND NOT EXISTS(SELECT 1 FROM private.chat_media_gc g WHERE g.name=o.name)
     AND NOT EXISTS(SELECT 1 FROM public.messages m WHERE m.content=o.name AND m.message_type IN('image','video'))
   ORDER BY o.created_at LIMIT 20 FOR UPDATE OF o SKIP LOCKED
 LOOP
   IF EXISTS(SELECT 1 FROM public.messages WHERE content=candidate.name AND message_type IN('image','video')) THEN CONTINUE; END IF;
   INSERT INTO private.chat_media_gc VALUES(candidate.name,now());
   RETURN jsonb_build_object('name',candidate.name);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION public.finish_chat_media_orphan(name_in text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='chat-media' AND name=name_in) THEN RETURN false; END IF;
 DELETE FROM private.chat_media_gc WHERE name=name_in;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_chat_media_orphan(),public.finish_chat_media_orphan(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_media_orphan(),public.finish_chat_media_orphan(text) TO service_role;
