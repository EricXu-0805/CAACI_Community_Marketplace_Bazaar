-- ============================================
-- 006 Notify favoritors when item is sold
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_item_sold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'sold' THEN
    INSERT INTO public.notifications (user_id, type, title, body, item_id)
    SELECT
      f.user_id,
      'sold',
      NEW.title,
      '$' || NEW.price::text,
      NEW.id
    FROM public.favorites f
    WHERE f.item_id = NEW.id
      AND f.user_id <> NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_item_sold ON public.items;
CREATE TRIGGER on_item_sold
  AFTER UPDATE OF status ON public.items
  FOR EACH ROW
  WHEN (OLD.status = 'active' AND NEW.status = 'sold')
  EXECUTE FUNCTION public.notify_item_sold();
