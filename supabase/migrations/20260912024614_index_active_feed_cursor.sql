-- With 10,001 hosted fixtures the feed scanned/sorted 9,501 visible rows
-- before LIMIT 20. Index the complete deterministic cursor, including its
-- UUID tie-break, so public feed reads can stop after one page. No policy,
-- function privilege or business row changes.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX items_active_feed_cursor_idx
  ON public.items (listing_type, created_at DESC, id DESC)
  WHERE status = 'active';
