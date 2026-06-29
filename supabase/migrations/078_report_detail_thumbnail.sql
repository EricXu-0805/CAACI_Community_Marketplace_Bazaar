-- 078_report_detail_thumbnail.sql
--
-- gaps-7 from the 2026-06-29 admin review: a reported item/post showed only a
-- text preview, so image-only scams ("see photo, Venmo me") were invisible to
-- the moderator. This extends admin_get_report_detail to also return the first
-- image of the reported item/post (target_image) so the console can render a
-- thumbnail inline.
--
-- items.images and posts.images are TEXT[] of full public URLs (item-images
-- bucket is public), so element [1] is render-ready as-is. messages/comments/
-- users have no image and return NULL.
--
-- This is a faithful rebuild of the 029 body with one added column; the
-- RETURNS TABLE order and the final SELECT order are kept in lockstep
-- (target_image inserted right after target_preview). Adding a column changes
-- the OUT-parameter row type, which CREATE OR REPLACE cannot do, so DROP first
-- (no SQL object depends on it — only the edge fn calls it via PostgREST) and
-- re-assert the 050 lockdown (service_role only) after recreating.

DROP FUNCTION IF EXISTS public.admin_get_report_detail(uuid);

CREATE FUNCTION public.admin_get_report_detail(
  report_id_in uuid
)
RETURNS TABLE (
  id                    uuid,
  reporter_id           uuid,
  reporter_nickname     text,
  reporter_email        text,
  target_type           text,
  target_id             uuid,
  target_user_id        uuid,
  target_user_nickname  text,
  target_preview        text,
  target_image          text,
  reason                text,
  note                  text,
  status                text,
  created_at            timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH resolved AS (
    SELECT
      r.id,
      r.reporter_id,
      r.target_type,
      r.target_id,
      r.reason,
      r.note,
      r.status,
      r.created_at,
      CASE r.target_type
        WHEN 'user'    THEN r.target_id
        WHEN 'item'    THEN (SELECT i.user_id   FROM public.items         i WHERE i.id = r.target_id)
        WHEN 'post'    THEN (SELECT po.user_id  FROM public.posts         po WHERE po.id = r.target_id)
        WHEN 'message' THEN (SELECT m.sender_id FROM public.messages      m WHERE m.id = r.target_id)
        WHEN 'comment' THEN (SELECT c.user_id   FROM public.post_comments c WHERE c.id = r.target_id)
      END AS resolved_user_id,
      CASE r.target_type
        WHEN 'item'    THEN (SELECT left(i.title,    120) FROM public.items         i WHERE i.id = r.target_id)
        WHEN 'post'    THEN (SELECT left(po.content, 120) FROM public.posts         po WHERE po.id = r.target_id)
        WHEN 'message' THEN (SELECT left(m.content,  120) FROM public.messages      m WHERE m.id = r.target_id)
        WHEN 'comment' THEN (SELECT left(c.content,  120) FROM public.post_comments c WHERE c.id = r.target_id)
        ELSE NULL
      END AS resolved_preview,
      CASE r.target_type
        WHEN 'item' THEN (SELECT (i.images)[1]  FROM public.items i  WHERE i.id  = r.target_id)
        WHEN 'post' THEN (SELECT (po.images)[1] FROM public.posts po WHERE po.id = r.target_id)
        ELSE NULL
      END AS resolved_image
    FROM public.reports r
    WHERE r.id = report_id_in
  )
  SELECT
    r.id,
    r.reporter_id, rp.nickname, rp.email,
    r.target_type, r.target_id,
    r.resolved_user_id,
    tp.nickname,
    r.resolved_preview,
    r.resolved_image,
    r.reason, r.note, r.status, r.created_at
  FROM resolved r
  JOIN public.profiles rp      ON rp.id = r.reporter_id
  LEFT JOIN public.profiles tp ON tp.id = r.resolved_user_id;
$$;

REVOKE ALL ON FUNCTION public.admin_get_report_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_report_detail(uuid) TO service_role;
