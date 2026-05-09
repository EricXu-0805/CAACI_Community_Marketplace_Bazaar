-- =============================================================================
-- 041 Plaza posts: multi-item attachments via join table
-- =============================================================================
-- Replaces posts.attached_item_id (single FK from mig 015) with public.post_items
-- (1:N join), capped at 3 items per post enforced server-side via trigger.
--
-- Locked product decisions (chat session 2026-05-08):
--   * Cap = 3 attached items per post (enforced via trigger; CHECK has no upper
--     bound so future cap changes only need trigger update)
--   * Order preserved via display_order INT (no drag-reorder in V1)
--   * ON DELETE CASCADE both FKs (item delete = chip row gone, no tombstone)
--   * Same item ALLOWED across multiple posts (composite PK only, no UNIQUE on item_id)
--   * Ownership invariant preserved: a user may only attach THEIR OWN items
--   * No realtime publication (write-once-read-many, no broadcast use case)
--   * No edit-post flow in V1 (no UPDATE policy needed)
--
-- Note: Step 0 (DROP VIEW posts_visible) + Step 6 (rebuild view without
-- attached_item_id) are required because posts_visible (mig 010 +
-- shadow-ban hardening 011/027) had explicit dependency on the dropped column.
--
-- Pre-launch only — soft beta has test data only, DROP COLUMN is safe.
-- =============================================================================


-- Step 0 — Drop dependent view (rebuilt at Step 6)
DROP VIEW IF EXISTS public.posts_visible;


-- Step 1 — Drop old single-FK column + its dependents
DROP TRIGGER  IF EXISTS trg_post_attached_item_ownership ON public.posts;
DROP FUNCTION IF EXISTS public.enforce_post_attached_item_ownership();
DROP INDEX    IF EXISTS public.idx_posts_attached_item;

ALTER TABLE public.posts
  DROP COLUMN IF EXISTS attached_item_id;


-- Step 2 — Create join table public.post_items
CREATE TABLE IF NOT EXISTS public.post_items (
  post_id       UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  item_id       UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  display_order INT  NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, item_id)
);


-- Step 3 — Indexes
CREATE INDEX IF NOT EXISTS idx_post_items_by_post
  ON public.post_items(post_id, display_order);

CREATE INDEX IF NOT EXISTS idx_post_items_by_item
  ON public.post_items(item_id);


-- Step 4 — Row-Level Security
ALTER TABLE public.post_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view post items" ON public.post_items;
CREATE POLICY "Anyone can view post items"
  ON public.post_items FOR SELECT USING (true);

DROP POLICY IF EXISTS "Post owner can attach own items" ON public.post_items;
CREATE POLICY "Post owner can attach own items"
  ON public.post_items FOR INSERT
  WITH CHECK (
    auth.uid() = (SELECT user_id FROM public.posts WHERE id = post_id)
    AND
    auth.uid() = (SELECT user_id FROM public.items WHERE id = item_id)
  );

DROP POLICY IF EXISTS "Post owner can detach items" ON public.post_items;
CREATE POLICY "Post owner can detach items"
  ON public.post_items FOR DELETE
  USING (auth.uid() = (SELECT user_id FROM public.posts WHERE id = post_id));

DROP POLICY IF EXISTS "No updates to post_items" ON public.post_items;
CREATE POLICY "No updates to post_items"
  ON public.post_items FOR UPDATE
  USING (false) WITH CHECK (false);


-- Step 5 — Cap-of-3 enforcement trigger
CREATE OR REPLACE FUNCTION public.enforce_post_items_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count INT;
BEGIN
  SELECT COUNT(*) INTO current_count
    FROM public.post_items
   WHERE post_id = NEW.post_id;

  IF current_count >= 3 THEN
    RAISE EXCEPTION 'post_items_cap_exceeded'
      USING HINT = 'A post may attach at most 3 items.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_post_items_cap ON public.post_items;
CREATE TRIGGER trg_enforce_post_items_cap
  BEFORE INSERT ON public.post_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_post_items_cap();


-- Step 6 — Rebuild posts_visible WITHOUT attached_item_id
-- Original definition preserved verbatim minus the dropped column.
CREATE VIEW public.posts_visible AS
  SELECT po.id,
         po.user_id,
         po.content,
         po.images,
         po.is_official,
         po.is_pinned,
         po.like_count,
         po.comment_count,
         po.status,
         po.created_at,
         po.updated_at
    FROM posts po
    JOIN profiles p ON p.id = po.user_id
   WHERE p.shadow_banned = false OR po.user_id = auth.uid();

GRANT SELECT ON public.posts_visible TO anon;
GRANT SELECT ON public.posts_visible TO authenticated;
GRANT SELECT ON public.posts_visible TO service_role;
