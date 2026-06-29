-- 075_admin_takedown_comments.sql
--
-- gaps-1 follow-up from the 2026-06-29 admin review. m073 gave the admin a
-- per-content takedown for items and posts, but post_comments had RLS
-- `USING (true)` and no status column, so comment takedowns were deferred.
--
-- Comments ARE reportable today (plaza onCommentLongPress → promptReport
-- ('comment', c.id), useModeration ReportTarget includes 'comment'), so reported
-- comments already reach the admin queue — they just couldn't be actioned. This
-- closes the loop, mirroring the posts soft-hide so the live read path stays
-- simple:
--   · add a status column ('active' default, 'hidden' for taken-down),
--   · flip the SELECT policy to status = 'active' (was USING (true)),
--   · extend admin_takedown_content to handle 'comment'.
--
-- The client never selects `status` (POST_COMMENT_FIELDS is an explicit list),
-- so the RLS predicate alone hides taken-down comments with no client change.
-- Owners cannot edit comments through the app (the comment action sheet is
-- reply/delete only), so the existing owner UPDATE policy is left untouched.

-- 1. Soft-hide column (mirrors posts.status: 'active' by default).
ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'hidden'));

-- 2. Hide non-active comments from the read path (was USING (true)).
DROP POLICY IF EXISTS "Anyone can view comments" ON public.post_comments;
CREATE POLICY "Anyone can view comments"
  ON public.post_comments FOR SELECT USING (status = 'active');

-- 3. Extend the takedown RPC. For a comment we also decrement the post's
--    comment_count: the count trigger (010) only fires on INSERT/DELETE, so a
--    soft-hide would otherwise leave the post's comment badge one too high.
CREATE OR REPLACE FUNCTION public.admin_takedown_content(
  target_type_in text,
  target_id_in   uuid,
  reason_in      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected  int  := 0;
  post_id_v uuid;
BEGIN
  IF target_type_in = 'item' THEN
    UPDATE public.items SET status = 'deleted'
     WHERE id = target_id_in AND status <> 'deleted';
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF target_type_in = 'post' THEN
    UPDATE public.posts SET status = 'hidden'
     WHERE id = target_id_in AND status = 'active';
    GET DIAGNOSTICS affected = ROW_COUNT;
  ELSIF target_type_in = 'comment' THEN
    UPDATE public.post_comments SET status = 'hidden'
     WHERE id = target_id_in AND status = 'active'
     RETURNING post_id INTO post_id_v;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN
      UPDATE public.posts
         SET comment_count = GREATEST(0, comment_count - 1)
       WHERE id = post_id_v;
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_target_type: %', target_type_in
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object('ok', true, 'affected', affected);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_takedown_content(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_takedown_content(text, uuid, text) TO service_role;
