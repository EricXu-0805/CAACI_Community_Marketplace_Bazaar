-- ============================================
-- 20260903070000 — In-app notifications for four events that told nobody
-- ============================================
-- Measured against production on 2026-09-02:
--   · submit_transaction_rating (20260718210000) inserts a ratings row and
--     nothing else. The person who was rated is never told.
--   · post_comments / post_likes / post_comment_likes are plain client
--     INSERTs with counter triggers only. Nobody hears about a comment or a
--     like on their own post.
--   · 016 named its trigger notify_followers_on_new_item: it tells a
--     FOLLOWER that the seller they follow listed something. It was never
--     dropped or misaimed — the followee simply has no trigger of their own,
--     so being followed notifies nobody. (The 'new_listing_from_followee'
--     body key that api/notification-digest.js mentions belongs to that other
--     event.)
--   · mark_item_sold defers to notify_item_sold, whose audience is the
--     favoriters. The one person who actually bought the thing is not in it.
--
-- WHY THE ROUTING TARGET RIDES IN body AND NOT IN A NEW COLUMN
-- -----------------------------------------------------------
-- Tapping a plaza notification has to open that post, and tapping a follow
-- has to open that follower — neither id fits item_id (FK to items) or
-- conversation_id (FK to conversations). A post_id/actor_id column would be
-- unreadable by the app until it also appeared in the column-level SELECT
-- grant on public.notifications, and that exact column list is pinned by
-- supabase/_ops/VERIFY_20260718_reconcile_app_table_acl_boundaries.sql, a
-- read-only diagnostic meant to stay runnable against production forever.
-- Widening the grant makes it report drift from then on. body is already a
-- server-owned key rather than copy for two other events ('saved_search_match'
-- and 'new_listing_from_followee', the latter indexed on that literal by
-- notifications_saved_search_unique_per_item), and both readers already
-- translate it — app/src/composables/useNotifications.ts and the digest — so
-- '<key>:<uuid>' extends a contract instead of opening a new one. No user
-- text is copied in: the body is a key, the title is a fixed bilingual
-- literal, and no comment or post excerpt appears anywhere.
--
-- Idempotency and the two rules every one of these obeys are in
-- private.enqueue_activity_notification below.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'price_drop', 'system', 'sold', 'offer', 'meetup', 'unread_message',
    'rating', 'follow', 'post_comment', 'post_like'
  ));

-- The one writer for all of these. It owns the three rules that are easy to
-- get individually right and collectively wrong: never notify yourself, never
-- notify across a block in either direction, and never write the same event
-- twice. The last one is what stops an unlike/relike loop from being a
-- notification cannon: the key is per (post, actor), so the second like is a
-- no-op rather than a second row.
CREATE OR REPLACE FUNCTION private.enqueue_activity_notification(
  recipient_id_in uuid,
  actor_id_in uuid,
  type_in text,
  title_in text,
  body_in text,
  item_id_in uuid,
  source_event_key_in text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF recipient_id_in IS NULL
     OR actor_id_in IS NULL
     OR recipient_id_in = actor_id_in
     OR source_event_key_in IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.blocks AS block_relation
    WHERE (
      block_relation.blocker_id = recipient_id_in
      AND block_relation.blocked_id = actor_id_in
    ) OR (
      block_relation.blocker_id = actor_id_in
      AND block_relation.blocked_id = recipient_id_in
    )
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (
    user_id, type, title, body, item_id, source_event_key
  ) VALUES (
    recipient_id_in, type_in, title_in, body_in, item_id_in, source_event_key_in
  )
  ON CONFLICT (source_event_key) WHERE source_event_key IS NOT NULL
    DO NOTHING;
END
$function$;

REVOKE ALL ON FUNCTION private.enqueue_activity_notification(
  uuid, uuid, text, text, text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

-- 1. Being rated. New ratings are RPC-only (20260718210000 revoked the client
-- INSERT), so the table is the one place both the RPC and any future trusted
-- writer pass through. item_id carries the tap target; the stars and the
-- rater's words stay out of the row.
CREATE OR REPLACE FUNCTION public.notify_transaction_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.enqueue_activity_notification(
    NEW.ratee_id,
    NEW.rater_id,
    'rating',
    '收到新评价 · New rating',
    'transaction_rating_received',
    NEW.item_id,
    pg_catalog.format('rating:%s', NEW.id::text)
  );
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_transaction_rating()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notify_transaction_rating ON public.ratings;
CREATE TRIGGER trg_notify_transaction_rating
  AFTER INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.notify_transaction_rating();

-- 2. Being followed. Keyed per (followee, follower) so unfollow/refollow
-- cannot be used to keep ringing the same person.
CREATE OR REPLACE FUNCTION public.notify_new_follower()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.enqueue_activity_notification(
    NEW.followee_id,
    NEW.follower_id,
    'follow',
    '有人关注了你 · New follower',
    pg_catalog.format('new_follower:%s', NEW.follower_id::text),
    NULL,
    pg_catalog.format(
      'follow:%s:%s', NEW.followee_id::text, NEW.follower_id::text
    )
  );
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_new_follower()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notify_new_follower ON public.follows;
CREATE TRIGGER trg_notify_new_follower
  AFTER INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_follower();

-- 3a. A comment on my post. One row per comment — a second comment is a
-- second event, and rl_post_comments_before_insert already bounds the rate.
CREATE OR REPLACE FUNCTION public.notify_post_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  post_author uuid;
BEGIN
  SELECT post.user_id INTO post_author
  FROM public.posts AS post
  WHERE post.id = NEW.post_id;

  PERFORM private.enqueue_activity_notification(
    post_author,
    NEW.user_id,
    'post_comment',
    '收到新评论 · New comment',
    pg_catalog.format('post_comment:%s', NEW.post_id::text),
    NULL,
    pg_catalog.format('post-comment:%s', NEW.id::text)
  );
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_post_comment()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notify_post_comment ON public.post_comments;
CREATE TRIGGER trg_notify_post_comment
  AFTER INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_comment();

-- 3b. A like on my post.
CREATE OR REPLACE FUNCTION public.notify_post_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  post_author uuid;
BEGIN
  SELECT post.user_id INTO post_author
  FROM public.posts AS post
  WHERE post.id = NEW.post_id;

  PERFORM private.enqueue_activity_notification(
    post_author,
    NEW.user_id,
    'post_like',
    '收到新点赞 · New like',
    pg_catalog.format('post_like:%s', NEW.post_id::text),
    NULL,
    pg_catalog.format('post-like:%s:%s', NEW.post_id::text, NEW.user_id::text)
  );
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_post_like()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notify_post_like ON public.post_likes;
CREATE TRIGGER trg_notify_post_like
  AFTER INSERT ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_like();

-- 3c. A like on my comment. The tap target is still the post, because that is
-- where a comment is readable.
CREATE OR REPLACE FUNCTION public.notify_post_comment_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  comment_author uuid;
  parent_post uuid;
BEGIN
  SELECT comment.user_id, comment.post_id
    INTO comment_author, parent_post
  FROM public.post_comments AS comment
  WHERE comment.id = NEW.comment_id;

  PERFORM private.enqueue_activity_notification(
    comment_author,
    NEW.user_id,
    'post_like',
    '你的评论收到点赞 · Comment liked',
    pg_catalog.format('post_comment_like:%s', parent_post::text),
    NULL,
    pg_catalog.format(
      'comment-like:%s:%s', NEW.comment_id::text, NEW.user_id::text
    )
  );
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_post_comment_like()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notify_post_comment_like ON public.post_comment_likes;
CREATE TRIGGER trg_notify_post_comment_like
  AFTER INSERT ON public.post_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_post_comment_like();

-- 4. The buyer of record. guard_item_sale_attribution refuses the transition
-- unless private.item_deals already holds the row, so the counterparty is
-- known by the time this AFTER trigger runs.
CREATE OR REPLACE FUNCTION public.notify_deal_buyer_on_sold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  buyer_of_record uuid;
BEGIN
  SELECT deal.counterparty_id INTO buyer_of_record
  FROM private.item_deals AS deal
  WHERE deal.item_id = NEW.id;

  PERFORM private.enqueue_activity_notification(
    buyer_of_record,
    NEW.user_id,
    'sold',
    '卖家已标记售出 · Marked sold',
    'deal_marked_sold',
    NEW.id,
    pg_catalog.format('item-sold-buyer:%s', NEW.id::text)
  );
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.notify_deal_buyer_on_sold()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_notify_deal_buyer_on_sold ON public.items;
CREATE TRIGGER trg_notify_deal_buyer_on_sold
  AFTER UPDATE OF status ON public.items
  FOR EACH ROW
  WHEN (OLD.status IN ('active', 'reserved') AND NEW.status = 'sold')
  EXECUTE FUNCTION public.notify_deal_buyer_on_sold();

-- Re-issued from the deployed 065 body with one clause added. A buyer who had
-- also favorited the listing would otherwise get two rows for the one event:
-- the favoriter fan-out above, and the row that is actually about their own
-- purchase. The buyer-specific one is the better of the two, so the fan-out
-- drops them.
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
      AND f.user_id <> NEW.user_id
      AND NOT EXISTS (
        SELECT 1
        FROM private.item_deals d
        WHERE d.item_id = NEW.id
          AND d.counterparty_id = f.user_id
      );
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
