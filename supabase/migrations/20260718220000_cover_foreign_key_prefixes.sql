-- Cover every advisor-visible foreign key left without a usable leading
-- btree index after the 20260718210000 candidate. Existing valid prefix
-- indexes (including the narrow IS NOT NULL indexes already used for nullable
-- foreign keys) are deliberately reused rather than duplicated.

-- These are ordinary (transactional) indexes so the migration remains
-- replayable by the standard Supabase migration runner. Production precheck
-- must reject large/busy relations; these deadlines ensure an unexpected lock
-- or scan fails the deployment instead of silently blocking writes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

CREATE INDEX IF NOT EXISTS item_deals_conversation_id_idx
  ON private.item_deals (conversation_id);
CREATE INDEX IF NOT EXISTS item_deals_owner_id_idx
  ON private.item_deals (owner_id);
CREATE INDEX IF NOT EXISTS item_deals_counterparty_id_idx
  ON private.item_deals (counterparty_id);

CREATE INDEX IF NOT EXISTS admin_banner_uploads_actor_id_idx
  ON public.admin_banner_uploads (actor_id);
CREATE INDEX IF NOT EXISTS admin_tokens_created_by_idx
  ON public.admin_tokens (created_by);

CREATE INDEX IF NOT EXISTS meetups_from_user_idx
  ON public.meetups (from_user);
CREATE INDEX IF NOT EXISTS meetups_item_id_idx
  ON public.meetups (item_id);
CREATE INDEX IF NOT EXISTS meetups_parent_meetup_id_idx
  ON public.meetups (parent_meetup_id);
CREATE INDEX IF NOT EXISTS meetups_to_user_idx
  ON public.meetups (to_user);

CREATE INDEX IF NOT EXISTS notifications_item_id_idx
  ON public.notifications (item_id);

CREATE INDEX IF NOT EXISTS offers_from_user_idx
  ON public.offers (from_user);
CREATE INDEX IF NOT EXISTS offers_item_id_idx
  ON public.offers (item_id);
CREATE INDEX IF NOT EXISTS offers_parent_offer_id_idx
  ON public.offers (parent_offer_id);
CREATE INDEX IF NOT EXISTS offers_to_user_idx
  ON public.offers (to_user);

CREATE INDEX IF NOT EXISTS post_comments_parent_comment_id_idx
  ON public.post_comments (parent_comment_id);
CREATE INDEX IF NOT EXISTS post_comments_user_id_idx
  ON public.post_comments (user_id);

CREATE INDEX IF NOT EXISTS ratings_item_id_idx
  ON public.ratings (item_id);
CREATE INDEX IF NOT EXISTS wechat_media_checks_user_id_idx
  ON public.wechat_media_checks (user_id);

COMMIT;
