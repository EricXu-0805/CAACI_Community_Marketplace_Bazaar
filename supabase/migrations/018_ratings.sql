-- ============================================
-- 018 Two-way ratings (buyer <-> seller)
-- ============================================
-- After an item is marked sold, both the buyer and the seller can
-- rate each other once per item, 1–5 stars + optional text. The
-- aggregate (avg_rating, rating_count) is maintained on profiles
-- via an AFTER INSERT/UPDATE/DELETE trigger so the seller profile
-- can display it without an aggregate query per render.
--
-- Rating rules enforced at DB level:
--   1. conversation_id must reference a conversation between rater
--      and ratee (no rating random users).
--   2. The ratee's item must have status = 'sold' OR the rater is
--      the seller and the ratee is the buyer (edge case: seller
--      reports the buyer after a no-show). Keep simple: require sold.
--   3. Exactly one rating per (rater, ratee, item).
-- ============================================

CREATE TABLE IF NOT EXISTS public.ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rater_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ratee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id  UUID NOT NULL REFERENCES public.items(id)    ON DELETE CASCADE,
  stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (rater_id <> ratee_id),
  UNIQUE (rater_id, ratee_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_ratee
  ON public.ratings(ratee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_rater
  ON public.ratings(rater_id, created_at DESC);

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view ratings" ON public.ratings;
CREATE POLICY "Anyone can view ratings"
  ON public.ratings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Participants can rate sold items" ON public.ratings;
CREATE POLICY "Participants can rate sold items"
  ON public.ratings FOR INSERT
  WITH CHECK (
    auth.uid() = rater_id
    AND EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.id = item_id
        AND i.status = 'sold'
        AND (i.user_id = rater_id OR i.user_id = ratee_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.item_id = item_id
        AND (
          (c.buyer_id = rater_id AND c.seller_id = ratee_id)
          OR (c.buyer_id = ratee_id AND c.seller_id = rater_id)
        )
    )
  );

DROP POLICY IF EXISTS "Raters can delete own rating" ON public.ratings;
CREATE POLICY "Raters can delete own rating"
  ON public.ratings FOR DELETE
  USING (auth.uid() = rater_id);

-- Maintain aggregate on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recompute_profile_rating(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c INT;
  a NUMERIC(3,2);
BEGIN
  SELECT COUNT(*), ROUND(AVG(stars)::numeric, 2)
    INTO c, a
    FROM public.ratings
    WHERE ratee_id = p_user;
  UPDATE public.profiles
    SET avg_rating = COALESCE(a, 0),
        rating_count = COALESCE(c, 0)
    WHERE id = p_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.ratings_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_profile_rating(OLD.ratee_id);
  ELSE
    PERFORM public.recompute_profile_rating(NEW.ratee_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ratings_after_change ON public.ratings;
CREATE TRIGGER trg_ratings_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.ratings_after_change();

-- Expose aggregate columns to clients (they were added to the
-- existing profiles SELECT grant via a separate GRANT call).
DO $$
BEGIN
  BEGIN
    EXECUTE 'GRANT SELECT (id, nickname, avatar_url, bio, location, is_illini_verified, created_at, updated_at, uid, avg_rating, rating_count) ON public.profiles TO anon, authenticated';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'grant on profiles failed: %', SQLERRM;
  END;
END $$;

-- Verification
--   SELECT id, nickname, avg_rating, rating_count FROM public.profiles ORDER BY rating_count DESC LIMIT 5;
-- ============================================
