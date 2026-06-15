-- ============================================
-- 065 Notify favoritors on reserved->sold too (QA4 B13)
-- ============================================
-- 006 only fired on active->sold. A seller commonly reserves an item for a
-- buyer (active->reserved) then marks it sold (reserved->sold) — the detail
-- page Mark-Sold button is shown for any non-sold status — and favoritors got
-- no 'sold' notification. Widen both the trigger WHEN clause and the in-body
-- guard to any (active|reserved)->sold edge. Audience is unchanged (favoritors
-- minus the seller). Function stays SECURITY DEFINER + EXECUTE-revoked (057);
-- it only ever runs in trigger context, so no GRANT is added.

CREATE OR REPLACE FUNCTION public.notify_item_sold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('active', 'reserved') AND NEW.status = 'sold' THEN
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
  WHEN (OLD.status IN ('active', 'reserved') AND NEW.status = 'sold')
  EXECUTE FUNCTION public.notify_item_sold();
