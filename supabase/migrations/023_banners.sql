-- Plaza banner carousel: small set of promotional slides rendered at the
-- top of the plaza feed. Anyone can read active banners; only the service
-- role (admin) can write. Fully RLS-guarded.

CREATE TABLE IF NOT EXISTS public.banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url   text NOT NULL,
  target_url  text,                                  -- in-app route or https link, null = non-clickable
  title       text,                                  -- for alt text + a11y
  title_en    text,
  title_zh    text,
  priority    integer NOT NULL DEFAULT 0,            -- higher = earlier in the carousel
  active      boolean NOT NULL DEFAULT true,
  start_at    timestamptz,
  end_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS banners_active_priority_idx
  ON public.banners (active, priority DESC, created_at DESC);

-- Only visible when active AND within the (optional) window.
CREATE OR REPLACE VIEW public.banners_live AS
SELECT id, image_url, target_url, title, title_en, title_zh, priority
FROM public.banners
WHERE active = true
  AND (start_at IS NULL OR start_at <= now())
  AND (end_at   IS NULL OR end_at   >= now())
ORDER BY priority DESC, created_at DESC
LIMIT 8;

GRANT SELECT ON public.banners_live TO anon, authenticated;

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS banners_read_live ON public.banners;
CREATE POLICY banners_read_live ON public.banners
  FOR SELECT
  USING (
    active = true
    AND (start_at IS NULL OR start_at <= now())
    AND (end_at   IS NULL OR end_at   >= now())
  );

-- No INSERT / UPDATE / DELETE policy = only service_role can mutate.

-- Seed a couple of rows so the UI has something to show before an admin
-- panel exists. Safe to re-run: ON CONFLICT keys off a stable marker id.
INSERT INTO public.banners (id, image_url, target_url, title_en, title_zh, priority)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'https://caaci-community-marketplace-bazaar.vercel.app/static/banner-welcome.svg',
    '/pages/plaza/index',
    'Welcome to Illini Market',
    '欢迎来到 Illini 集市',
    100
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'https://caaci-community-marketplace-bazaar.vercel.app/static/banner-safety.svg',
    '/pages/legal/index',
    'Trade safely — tips inside',
    '安全交易小贴士',
    90
  )
ON CONFLICT (id) DO NOTHING;
