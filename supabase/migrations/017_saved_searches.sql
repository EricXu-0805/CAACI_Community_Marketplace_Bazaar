-- ============================================
-- 017 Saved searches + match fan-out
-- ============================================
-- Users save a named query (keyword + optional category + price range).
-- When a new item is listed matching the query, fan out a notification
-- to the subscriber. Matching is intentionally simple (ILIKE on
-- title + description, plus exact category and BETWEEN price) so it
-- runs cheap inside an INSERT trigger.
-- ============================================

CREATE TABLE IF NOT EXISTS public.saved_searches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL CHECK (length(trim(keyword)) BETWEEN 1 AND 60),
  category item_category,
  price_min NUMERIC(10,2),
  price_max NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at TIMESTAMPTZ,
  CHECK (price_min IS NULL OR price_max IS NULL OR price_min <= price_max)
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON public.saved_searches(user_id, created_at DESC);

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own saved searches" ON public.saved_searches;
CREATE POLICY "Users read own saved searches"
  ON public.saved_searches FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create own saved searches" ON public.saved_searches;
CREATE POLICY "Users create own saved searches"
  ON public.saved_searches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own saved searches" ON public.saved_searches;
CREATE POLICY "Users delete own saved searches"
  ON public.saved_searches FOR DELETE
  USING (auth.uid() = user_id);

-- Rate limit: 20 saved searches per user, enforced at INSERT
CREATE OR REPLACE FUNCTION public.rl_saved_searches_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.saved_searches WHERE user_id = NEW.user_id;
  IF n >= 20 THEN
    RAISE EXCEPTION 'saved_searches_limit'
      USING HINT = 'Maximum 20 saved searches per account. Delete one first.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_saved_searches_before_insert ON public.saved_searches;
CREATE TRIGGER trg_rl_saved_searches_before_insert
  BEFORE INSERT ON public.saved_searches
  FOR EACH ROW EXECUTE FUNCTION public.rl_saved_searches_before_insert();

-- Match trigger: on new active item, find matching saved searches and
-- insert one notification per subscriber. Excludes the seller themself.
-- Updates last_notified_at for throttling (one match per search per day max).
CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm_haystack TEXT;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  norm_haystack := LOWER(COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, ''));

  WITH matching AS (
    SELECT ss.id AS ss_id, ss.user_id AS subscriber
    FROM public.saved_searches ss
    WHERE ss.user_id <> NEW.user_id
      AND (ss.last_notified_at IS NULL
           OR ss.last_notified_at < NOW() - INTERVAL '24 hours')
      AND norm_haystack LIKE '%' || LOWER(ss.keyword) || '%'
      AND (ss.category  IS NULL OR ss.category = NEW.category)
      AND (ss.price_min IS NULL OR NEW.price >= ss.price_min)
      AND (ss.price_max IS NULL OR NEW.price <= ss.price_max)
  ),
  inserted AS (
    INSERT INTO public.notifications (user_id, type, title, body, item_id)
    SELECT subscriber, 'system', NEW.title, 'saved_search_match', NEW.id
    FROM matching
    RETURNING user_id
  )
  UPDATE public.saved_searches
  SET last_notified_at = NOW()
  WHERE id IN (SELECT ss_id FROM matching);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_saved_search_matches ON public.items;
CREATE TRIGGER trg_notify_saved_search_matches
  AFTER INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.notify_saved_search_matches();

-- Verification
--   INSERT INTO public.saved_searches (user_id, keyword, category)
--     VALUES (auth.uid(), 'econ 101', 'books');
--   -- Later, when someone lists a book matching 'econ 101', the
--   -- subscriber receives a notification.
-- ============================================
