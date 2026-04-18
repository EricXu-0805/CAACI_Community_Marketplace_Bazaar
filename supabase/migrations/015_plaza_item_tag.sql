-- ============================================
-- 015 Plaza posts can tag one marketplace item
-- ============================================
-- Inspired by Xiaohongshu's in-post product cards. A plaza post can
-- optionally reference a single item_id. The client renders the
-- attached item as a compact card at the bottom of the post. Tapping
-- the card navigates to /pages/detail.
--
-- Enforcement:
--   - attached_item_id nullable, FK with ON DELETE SET NULL so if the
--     item is deleted the post remains but the card disappears.
--   - Users can only tag THEIR OWN items (matches marketplace trust
--     model: no fake product recommendations of other people's listings).
-- ============================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS attached_item_id UUID
    REFERENCES public.items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_attached_item
  ON public.posts(attached_item_id)
  WHERE attached_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_post_attached_item_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item_owner UUID;
BEGIN
  IF NEW.attached_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO item_owner
    FROM public.items
    WHERE id = NEW.attached_item_id;

  IF item_owner IS NULL THEN
    RAISE EXCEPTION 'attached_item_not_found';
  END IF;

  IF item_owner <> NEW.user_id THEN
    RAISE EXCEPTION 'can_only_tag_own_items'
      USING HINT = 'You can only attach one of your own listings to a post.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_attached_item_ownership ON public.posts;
CREATE TRIGGER trg_post_attached_item_ownership
  BEFORE INSERT OR UPDATE OF attached_item_id ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_attached_item_ownership();

-- Verification
--   INSERT INTO public.posts (user_id, content, attached_item_id)
--     VALUES (auth.uid(), 'test', '<someone-elses-item-id>');
--   -- should raise can_only_tag_own_items
-- ============================================
