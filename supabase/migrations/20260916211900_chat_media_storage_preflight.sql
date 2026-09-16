-- Supabase Storage uploader.canUpload uses a rolled-back version=1 insert.
-- https://github.com/supabase/storage/blob/master/src/storage/uploader.ts
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION private.enforce_chat_media_upload() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bytes bigint; total_bytes bigint; object_count bigint; recent_count bigint; mime text; size_text text;
BEGIN
 IF NEW.bucket_id<>'chat-media' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.name<>OLD.name OR NEW.bucket_id<>OLD.bucket_id OR NEW.metadata IS DISTINCT FROM OLD.metadata) THEN
   RAISE EXCEPTION 'chat_media_immutable' USING ERRCODE='22023';
 END IF;
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF NOT private.chat_media_access(NEW.name,true) THEN RAISE EXCEPTION 'chat_media_access_denied' USING ERRCODE='42501'; END IF;
 mime:=lower(NEW.metadata->>'mimetype');
 -- Storage's permission preflight uses version '1' and contentLength, not
 -- finalized size, inside an always-rolled-back transaction. Final objects
 -- carry a UUID version and must still supply a measured size.
 size_text:=NEW.metadata->>'size';
 IF size_text IS NULL AND TG_OP='INSERT' AND NEW.version='1' THEN
   size_text:=coalesce(NEW.metadata->>'contentLength', CASE WHEN mime LIKE 'image/%' THEN '5242880' ELSE '20971520' END);
 END IF;
 IF size_text IS NULL OR size_text !~ '^[1-9][0-9]{0,7}$' THEN
   RAISE EXCEPTION 'chat_media_invalid_size' USING ERRCODE='22023'; END IF;
 bytes:=size_text::bigint;
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
CREATE OR REPLACE FUNCTION private.enforce_message_content_boundary() RETURNS trigger
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
       AND coalesce(o.metadata->>'size','') ~ '^[1-9][0-9]{0,7}$'
       AND (o.metadata->>'mimetype') LIKE (NEW.message_type||'/%')) THEN
     RAISE EXCEPTION 'chat_media_invalid_reference' USING ERRCODE='22023';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_message_content_boundary() FROM PUBLIC;
