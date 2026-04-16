-- ============================================
-- 005 Notifications + price drop alerts
-- ============================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('price_drop', 'system', 'sold')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  item_id UUID REFERENCES public.items(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications(user_id, is_read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own notifications" ON public.notifications;
CREATE POLICY "Users delete own notifications"
  ON public.notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger: when item price drops, notify all users who favorited it
CREATE OR REPLACE FUNCTION public.notify_price_drop()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.price < OLD.price AND NEW.status = 'active' THEN
    INSERT INTO public.notifications (user_id, type, title, body, item_id)
    SELECT
      f.user_id,
      'price_drop',
      NEW.title,
      '$' || OLD.price::text || ' → $' || NEW.price::text,
      NEW.id
    FROM public.favorites f
    WHERE f.item_id = NEW.id
      AND f.user_id <> NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_item_price_drop ON public.items;
CREATE TRIGGER on_item_price_drop
  AFTER UPDATE OF price ON public.items
  FOR EACH ROW
  WHEN (NEW.price < OLD.price)
  EXECUTE FUNCTION public.notify_price_drop();
