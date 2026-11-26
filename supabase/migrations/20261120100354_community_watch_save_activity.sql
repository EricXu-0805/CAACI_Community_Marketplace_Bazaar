-- P3: watching and saving topics, activity ordering, reply notifications and
-- the community governance actions (BACKLOG P3.1, P3.3, P3.4, P3.5). P3 has
-- one migration, so the read functions P3.5's console and P3.6's views need
-- are here as well. Everything is additive, with one thing every reader of
-- replies has to know: post_comments gains a column that no API role may
-- SELECT (reply_to_comment_id). PostgREST reads every column for `select=*`,
-- so from this migration on that request is refused with 42501 for anon and
-- authenticated. Clients must list the columns they read;
-- scripts/app-direct-table-acl-boundary.test.mjs holds app/ and api/ to that.
--
-- Release order (D-54 2c):
--   1. PRECHECK, this migration, VERIFY. The two new reply notices are behind
--      private.community_reply_notice_config, which this migration creates
--      switched off, so applying it writes no notification that an installed
--      client or the digest job cannot read.
--   2. Deploy the P3 Edge API and the P3 H5 client and release the P3 Mini
--      Program. They read the comment_reply and followed_post_reply keys and
--      keep both out of the digest mail.
--   3. Only then turn the switch on, on staging and on production separately.
--      That is a write to a hosted database: the release owner does it, or
--      somebody the release owner approves by name for this step. The
--      statement and the checks are in RUNBOOK.md, "Reply notice switch".
-- What is already deployed keeps working from step 1 on:
--   * old clients ignore the new columns and get two more fields from the
--     search function. A search sorted by 'hot' returns only topics from the
--     last 14 days from step 1 on; the hot list of a client from before P3
--     has no such limit until step 2;
--   * the Edge API in production compares the capability list from
--     admin_token_authorization_v2 with its own, exactly. That projection is
--     frozen to the vocabulary it has always reported, so the five new
--     actions do not lock every administrator out until the new API ships;
--   * while the switch is off a reply writes the one post_comment notice to
--     the topic author that it always has, and nothing else.
--
-- D-49 classification of the new write paths:
--   post_bookmarks  a save. Only its owner reads it and nobody is notified,
--                   so a restricted account (level 2-5) keeps it, as it keeps
--                   favorites.
--   post_follows    a watch. Private to its owner and notifies nobody: kept.
--   Nothing else here is client-writable, except that a member writing a
--   reply may name the reply it answers (post_comments.reply_to_comment_id,
--   INSERT only). A reply is still refused by public.trg_enforce_actor, which
--   fires before the new lock rule and the reply target check, and the five
--   administrator actions run only through the service-role dispatcher.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Reissue only what the local full replay measured (PRECHECK repeats this for
-- the hosted database). A different body or vocabulary means the object was
-- changed outside this repository and the edits below must be reviewed
-- against it.
DO $guard$
DECLARE
  expected record;
  stored text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.update_post_comment_count()', 'a524f02212c525205f59103e2e1f6bdc'),
    ('public.search_community_posts(text[],text,integer,integer,text,text)', '1dfd91b93a4d7979d7f9e9dd121295b8'),
    ('public.admin_execute_mutation(text,uuid,text,text,jsonb)', 'a30b6224c23ab4ebdef61b54eb37af5a'),
    ('public.admin_token_authorization(text)', '67d3ce854d107b7ff701edf8542f4ff6'),
    ('public.admin_token_authorization_v2(text)', '720c6f6cb2e550107a9f9cba88aa7ec9'),
    ('public.admin_list_moderation_audit_log(integer,integer,text)', '2e788091d546d9fc34c908c3d7951d94'),
    ('private.enqueue_activity_notification(uuid,uuid,text,text,text,uuid,text)', 'fdb7928eb1930389cdd68173ea7f55eb'),
    ('moderation_private.profile_content_visible(uuid)', 'a41223ba4e42754a12eec610e9ab03cf'),
    ('moderation_private.current_profile_state(uuid)', '9c0b020a7ecdaa83372062a1cc85edc6'),
    ('private.current_user_can_access_pair(uuid,uuid)', '3602822522f16a11d5b110fe20c63dc6'),
    ('public.admin_assert_mutation_capability(uuid,text)', '51c79ee5189f512333e2e8a3e4b47ba0'),
    ('public.record_audit(text,uuid,uuid,jsonb)', '38cb635c4cf81051966bc563ebf6142d'),
    ('public.admin_moderation_reason_valid(text)', '3f75864d5dfc236033a8cd232238baf2'),
    ('public.notify_post_comment()', '1875e3c65f24a596c05ec8670907f302')
    ) AS known(signature, body_md5)
  LOOP
    SELECT pg_catalog.md5(routine.prosrc) INTO stored
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = pg_catalog.to_regprocedure(expected.signature);
    IF stored IS DISTINCT FROM expected.body_md5 THEN
      RAISE EXCEPTION 'community_watch_save_function_drift:%:%',
        expected.signature, coalesce(stored, 'missing');
    END IF;
  END LOOP;

  -- The three administrator vocabularies are restated below. Restating a
  -- list that somebody extended elsewhere would silently drop their values.
  FOR expected IN
    SELECT * FROM (VALUES
    ('public.admin_mutation_requests', 'admin_mutation_requests_action_check',
     'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,revoke_admin_tokens,revoke_token,set_post_pinned,takedown_content,update_report_status,upsert_banner'),
    ('public.admin_role_action_capabilities', 'admin_role_action_capabilities_action_check',
     'apply_ban,decide_appeal,delete_banner,issue_token,lift_suspension,resolve_target_reports,revoke_admin_tokens,revoke_token,set_post_pinned,takedown_content,update_report_status,upload_banner,upsert_banner'),
    ('public.admin_audit_log', 'admin_audit_log_event_kind_check',
     'actor_blocked,admin_login,admin_unauthorized,appeal_decided,appeal_more_information_requested,ban_applied,banner_changed,content_takedown,post_pin_changed,report_status_changed,support_email_claimed,suspension_lifted,token_issued,token_revoked')
    ) AS known(relation, constraint_name, vocabulary)
  LOOP
    SELECT pg_catalog.string_agg(accepted.value, ',' ORDER BY accepted.value COLLATE "C") INTO stored
    FROM pg_catalog.pg_constraint AS definition
    CROSS JOIN LATERAL (
      SELECT (pg_catalog.regexp_matches(
        pg_catalog.pg_get_constraintdef(definition.oid), '''([a-z_]+)''::text', 'g'
      ))[1] AS value
    ) AS accepted
    WHERE definition.conrelid = pg_catalog.to_regclass(expected.relation)
      AND definition.conname = expected.constraint_name
      AND definition.contype = 'c';
    IF stored IS DISTINCT FROM expected.vocabulary THEN
      RAISE EXCEPTION 'community_watch_save_vocabulary_drift:%:%',
        expected.constraint_name, coalesce(stored, 'missing');
    END IF;
  END LOOP;
END
$guard$;

-- Take the two busiest locks first, in the order a reply takes them: the
-- reply, then its topic through the counter trigger. That order rules out one
-- deadlock only, the one with a reply that is in flight: the migration waits
-- for it, up to lock_timeout. Other transactions take these tables, and the
-- ones locked further down (profiles for the two foreign keys, then the three
-- administrator tables), in another order. Deleting a topic takes the topic
-- before its replies, deleting an account takes the profile before both, and
-- an administrator takedown records its request before it touches the topic.
-- Any of them can still deadlock with this migration. PostgreSQL then rolls
-- one of the two transactions back, and it can be either one. This file is a
-- single transaction, so when it is the one that stops (40P01, or 55P03 for
-- lock_timeout) nothing of it is kept and it can be run again as it is.
LOCK TABLE public.post_comments, public.posts IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- P3.1  Watching and saving a topic
-- ---------------------------------------------------------------------------
CREATE TABLE public.post_follows (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
-- Fan-out reads a topic's watchers oldest first.
CREATE INDEX post_follows_post_idx ON public.post_follows (post_id, created_at);

CREATE TABLE public.post_bookmarks (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX post_bookmarks_user_idx ON public.post_bookmarks (user_id, created_at DESC, post_id);
-- Deleting a topic removes its saves; without this the cascade scans the table.
CREATE INDEX post_bookmarks_post_idx ON public.post_bookmarks (post_id);

ALTER TABLE public.post_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_bookmarks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.post_follows, public.post_bookmarks
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.post_follows, public.post_bookmarks
  TO service_role;
GRANT SELECT (user_id, post_id, created_at), INSERT (user_id, post_id)
  ON TABLE public.post_follows TO authenticated;
GRANT DELETE ON TABLE public.post_follows TO authenticated;
GRANT SELECT (user_id, post_id, created_at), INSERT (user_id, post_id)
  ON TABLE public.post_bookmarks TO authenticated;
GRANT DELETE ON TABLE public.post_bookmarks TO authenticated;

-- A member reads and removes only their own rows. A row can be added for a
-- topic the member can see, written by somebody neither side has blocked. The
-- pair check runs with definer rights because a member cannot read the blocks
-- other people placed on them.
CREATE POLICY "Members can view own topic follows" ON public.post_follows
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Members can follow visible topics" ON public.post_follows
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
        FROM public.posts AS post
       WHERE post.id = post_follows.post_id
         AND post.status = 'active'
         AND moderation_private.profile_content_visible(post.user_id)
         AND private.current_user_can_access_pair(post_follows.user_id, post.user_id)
    )
  );
CREATE POLICY "Members can unfollow topics" ON public.post_follows
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Members can view own topic bookmarks" ON public.post_bookmarks
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Members can bookmark visible topics" ON public.post_bookmarks
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
        FROM public.posts AS post
       WHERE post.id = post_bookmarks.post_id
         AND post.status = 'active'
         AND moderation_private.profile_content_visible(post.user_id)
         AND private.current_user_can_access_pair(post_bookmarks.user_id, post.user_id)
    )
  );
CREATE POLICY "Members can remove topic bookmarks" ON public.post_bookmarks
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- P3.1  Activity, answer, "Start here" and lock columns on topics
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts
  ADD COLUMN last_activity_at timestamptz,
  ADD COLUMN answered_at timestamptz,
  ADD COLUMN is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN locked_at timestamptz,
  ADD CONSTRAINT posts_featured_official_only CHECK (NOT is_featured OR is_official);

-- A topic was last active at its latest visible reply, and was answered at
-- the first visible reply from somebody other than its author. One statement,
-- so every row and its triggers are touched once. The BEFORE UPDATE row
-- triggers that fire for it are the three without a column list (PRECHECK
-- pins the set): authoritative_public_write_boundary and
-- guard_moderation_status look only at columns this leaves alone, and
-- set_posts_updated_at moves updated_at, as it does for every reply and like.
UPDATE public.posts AS post
   SET last_activity_at = greatest(post.created_at, coalesce(activity.latest_reply_at, post.created_at)),
       answered_at = activity.first_answer_at
  FROM (
    SELECT topic.id,
           max(reply.created_at) AS latest_reply_at,
           min(reply.created_at) FILTER (WHERE reply.user_id <> topic.user_id) AS first_answer_at
      FROM public.posts AS topic
      LEFT JOIN public.post_comments AS reply
        ON reply.post_id = topic.id AND reply.status = 'active'
     GROUP BY topic.id
  ) AS activity
 WHERE activity.id = post.id;

ALTER TABLE public.posts
  ALTER COLUMN last_activity_at SET NOT NULL,
  ALTER COLUMN last_activity_at SET DEFAULT now();

CREATE INDEX posts_board_activity_idx ON public.posts (region, category, last_activity_at DESC, id DESC)
  WHERE status = 'active';
CREATE INDEX posts_activity_idx ON public.posts (region, last_activity_at DESC, id DESC)
  WHERE status = 'active';
CREATE INDEX posts_unanswered_idx ON public.posts (region, created_at DESC, id DESC)
  WHERE status = 'active' AND title IS NOT NULL AND answered_at IS NULL;

-- Readable by everyone who can read the topic; written only by the comment
-- trigger and the administrator actions below. No INSERT or UPDATE grant, so
-- the restricted-account guard of 20261114015420 still names every column a
-- client can write.
GRANT SELECT (last_activity_at, answered_at, is_featured, locked_at)
  ON TABLE public.posts TO anon, authenticated;

-- 085's counter, with the same single UPDATE now also moving the topic
-- forward and recording its first answer. answered_at is never cleared: a
-- topic whose answer is later removed does not return to "unanswered".
CREATE OR REPLACE FUNCTION public.update_post_comment_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
begin
  if tg_op = 'INSERT' then
    update public.posts
       set comment_count = comment_count + 1,
           last_activity_at = greatest(last_activity_at, new.created_at),
           answered_at = coalesce(answered_at, case when new.user_id <> user_id then new.created_at end)
     where id = new.post_id;
  elsif tg_op = 'DELETE' and old.status = 'active' then
    update public.posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
  end if;
  return null;
end;
$function$;

-- P3.5: a locked topic takes no new replies from anyone. The check reads the
-- row as it is and takes no lock on it: two people replying at once would
-- otherwise wait on each other's counter update.
CREATE FUNCTION private.reject_reply_to_locked_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.posts AS post
     WHERE post.id = NEW.post_id
       AND post.locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'post_locked';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.reject_reply_to_locked_post()
  FROM PUBLIC, anon, authenticated, service_role;

-- BEFORE INSERT row triggers fire in name order.
-- authoritative_public_write_boundary comes first, so a reply that is too
-- long is refused for its size even on a closed topic. This one sorts right
-- after enforce_actor_post_comments, so a restricted account is told about
-- its restriction before the lock (D-49), and before the moderation,
-- serialization and rate-limit triggers, so a reply refused here costs none
-- of those.
CREATE TRIGGER enforce_locked_post_reply
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.reject_reply_to_locked_post();

-- P3.3 (D-54 2f): the reply a member is answering. A thread is one level deep
-- (parent_comment_id names the reply the thread hangs under), so an answer to
-- a reply inside a thread needs its own pointer for the notice to reach the
-- right person. It must be a visible reply of the same thread in the same
-- topic. One that was taken down or removed since the page was loaded costs
-- the member nothing: the reply is stored without it and the thread's first
-- author is the person answered. A reply nobody can read is treated as gone
-- wherever it is, so the answer does not say where it was.
ALTER TABLE public.post_comments
  ADD COLUMN reply_to_comment_id uuid
    REFERENCES public.post_comments(id) ON DELETE SET NULL;
-- Removing a reply clears the pointers to it; without this that scans the table.
CREATE INDEX post_comments_reply_to_comment_id_idx
  ON public.post_comments (reply_to_comment_id)
  WHERE reply_to_comment_id IS NOT NULL;
-- Set once, when the reply is written. No SELECT or UPDATE grant: the client
-- has no use for reading it back, and the restricted-account guard of
-- 20261114015420 still names every column a client can change.
GRANT INSERT (reply_to_comment_id) ON TABLE public.post_comments TO authenticated;

CREATE FUNCTION private.validate_comment_reply_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_post uuid;
  target_thread uuid;
BEGIN
  IF NEW.reply_to_comment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT target.post_id, coalesce(target.parent_comment_id, target.id)
    INTO target_post, target_thread
    FROM public.post_comments AS target
   WHERE target.id = NEW.reply_to_comment_id
     AND target.status = 'active';
  IF NOT FOUND THEN
    NEW.reply_to_comment_id := NULL;
    RETURN NEW;
  END IF;

  IF target_post IS DISTINCT FROM NEW.post_id
     OR target_thread IS DISTINCT FROM NEW.parent_comment_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'comment_reply_target_invalid';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.validate_comment_reply_target()
  FROM PUBLIC, anon, authenticated, service_role;

-- Sorts right after the lock refusal: a restricted account is still told
-- about its restriction first (D-49) and a closed topic second.
CREATE TRIGGER enforce_reply_target
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.validate_comment_reply_target();

-- ---------------------------------------------------------------------------
-- P3.3  Reply notifications
-- ---------------------------------------------------------------------------
-- One reply reaches each person once, in this order (SPEC 6.8). The topic
-- author keeps the existing post_comment notice (public.notify_post_comment,
-- unchanged). The author of the reply that was answered gets comment_reply.
-- Everybody else who watches the topic gets followed_post_reply, the first
-- 500 by watch time. Nobody is told about a topic they cannot open. The type,
-- the fixed title and the '<key>:<post id>' body follow 20260903070000, and
-- private.enqueue_activity_notification keeps owning the three rules: never
-- yourself, never across a block, never the same event twice.
--
-- A notification is written in the reply's transaction, so both rows carry
-- the same created_at. The client relies on that to find the reply a notice
-- is about (topic and instant); notifications has no column for it and its
-- column grant is pinned.

-- The release switch for the two new notices (D-54 2c). A client from before
-- P3 shows a body key it does not know as it is written, and the digest job
-- from before P3 would mail it, so the notices stay off until both have been
-- replaced. One row; only the owner of the table reads or changes it.
CREATE TABLE private.community_reply_notice_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO private.community_reply_notice_config DEFAULT VALUES;
ALTER TABLE private.community_reply_notice_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.community_reply_notice_config
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.notify_topic_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  post_author uuid;
  post_status text;
  answered_author uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM private.community_reply_notice_config AS release_switch
     WHERE release_switch.enabled
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NULL;
  END IF;

  SELECT post.user_id, post.status
    INTO post_author, post_status
    FROM public.posts AS post
   WHERE post.id = NEW.post_id;
  IF post_status IS DISTINCT FROM 'active' THEN
    RETURN NULL;
  END IF;

  -- A notice follows the right to read. An author under an active level 3+
  -- restriction is hidden from everyone else (the read policy on posts), and
  -- the people told here are never the author, so nobody is told.
  IF (
    SELECT author_state.shadow_banned
      FROM moderation_private.current_profile_state(post_author) AS author_state
  ) THEN
    RETURN NULL;
  END IF;

  IF NEW.parent_comment_id IS NOT NULL THEN
    -- The reply that was answered: the one the member named, which
    -- private.validate_comment_reply_target checked when this row was
    -- written, or else the reply the thread hangs under.
    SELECT answered.user_id
      INTO answered_author
      FROM public.post_comments AS answered
     WHERE answered.id = coalesce(NEW.reply_to_comment_id, NEW.parent_comment_id)
       AND answered.post_id = NEW.post_id
       AND answered.status = 'active';

    -- The topic author already has post_comment for this reply.
    IF answered_author IS NOT NULL AND answered_author IS DISTINCT FROM post_author THEN
      PERFORM private.enqueue_activity_notification(
        answered_author,
        NEW.user_id,
        'post_comment',
        '收到新评论 · New comment',
        pg_catalog.format('comment_reply:%s', NEW.post_id::text),
        NULL,
        pg_catalog.format('comment-reply:%s', NEW.id::text)
      );
    END IF;
  END IF;

  -- A watcher with a block to or from the person who replied, or to or from
  -- the topic author (the pair the watch rule refuses), is left out before
  -- the cap, so they do not use up places.
  PERFORM private.enqueue_activity_notification(
    watcher.user_id,
    NEW.user_id,
    'post_comment',
    '收到新评论 · New comment',
    pg_catalog.format('followed_post_reply:%s', NEW.post_id::text),
    NULL,
    pg_catalog.format('followed-reply:%s:%s', NEW.id::text, watcher.user_id::text)
  )
  FROM (
    SELECT follow.user_id
      FROM public.post_follows AS follow
     WHERE follow.post_id = NEW.post_id
       AND follow.user_id <> NEW.user_id
       AND follow.user_id IS DISTINCT FROM post_author
       AND follow.user_id IS DISTINCT FROM answered_author
       AND NOT EXISTS (
         SELECT 1
           FROM public.blocks AS block_relation
          WHERE (block_relation.blocker_id = follow.user_id
                 AND block_relation.blocked_id IN (NEW.user_id, post_author))
             OR (block_relation.blocked_id = follow.user_id
                 AND block_relation.blocker_id IN (NEW.user_id, post_author))
       )
     ORDER BY follow.created_at, follow.user_id
     LIMIT 500
  ) AS watcher;

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION private.notify_topic_reply()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_notify_topic_reply
  AFTER INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.notify_topic_reply();

-- ---------------------------------------------------------------------------
-- P3.4  Search ordering
-- ---------------------------------------------------------------------------
-- Two more result columns, so the function is dropped and recreated in this
-- transaction with its grants and statement budget. The Mini Program has never
-- been released, so no installed client depends on the old row shape; the H5
-- client reads fields by name.
--   active      latest activity first
--   unanswered  topics nobody else has answered, posted in the last 30 days
--   hot         only posts from the last 14 days
--   anything else is 'recent', as before
DROP FUNCTION public.search_community_posts(text[], text, int, int, text, text);

CREATE FUNCTION public.search_community_posts(
  terms_in   text[],
  sort_in    text  default 'recent',
  limit_in   int   default 20,
  offset_in  int   default 0,
  category_in text default null,
  region_in  text  default 'cu'
)
returns table (
  id                uuid,
  user_id           uuid,
  title             text,
  category          text,
  content           text,
  images            text[],
  image_dimensions  jsonb,
  content_i18n      jsonb,
  source_lang       text,
  is_official       boolean,
  is_pinned         boolean,
  like_count        int,
  comment_count     int,
  status            text,
  created_at        timestamptz,
  updated_at        timestamptz,
  profile           jsonb,
  rank              real,
  last_activity_at  timestamptz,
  answered_at       timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with terms as materialized (
    select left(t, 100) as term
    from unnest(terms_in) with ordinality as input(t, ordinal)
    where ordinal <= 8 and nullif(btrim(t), '') is not null
  )
  select
    p.id, p.user_id, p.title, p.category, p.content, p.images, p.image_dimensions,
    p.content_i18n, p.source_lang, p.is_official, p.is_pinned,
    p.like_count, p.comment_count, p.status, p.created_at, p.updated_at,
    jsonb_build_object(
      'id',                 pr.id,
      'nickname',           pr.nickname,
      'avatar_url',         pr.avatar_url,
      'location',           pr.location,
      'is_illini_verified', pr.is_illini_verified,
      'status_text',        pr.status_text,
      'status_emoji',       pr.status_emoji
    ) as profile,
    (
      select coalesce(max(greatest(
        similarity(coalesce(p.title, ''), t),
        case when p.title ilike '%' || t || '%' then 0.6 else 0 end,
        similarity(p.content, t),
        case when p.content ilike '%' || t || '%' then 0.4 else 0 end,
        similarity(coalesce(pr.nickname, ''), t) * 0.8,
        case when coalesce(pr.nickname, '') ilike '%' || t || '%' then 0.5 else 0 end
      )), 0)::real
        from terms as search_term(t)
    ) as rank,
    p.last_activity_at, p.answered_at
  from public.posts p
  left join public.profiles pr on pr.id = p.user_id
  where p.status = 'active'
    and p.region = region_in
    and (category_in is null or p.category = category_in)
    and (sort_in is distinct from 'hot' or p.created_at >= now() - interval '14 days')
    and (sort_in is distinct from 'unanswered' or (
      p.title is not null
      and p.answered_at is null
      and p.created_at >= now() - interval '30 days'
    ))
    and exists (
      select 1
        from terms as search_term(t)
       where p.title % t
          or p.title ilike '%' || t || '%'
          or p.content % t
          or p.content ilike '%' || t || '%'
          or coalesce(pr.nickname, '') % t
          or coalesce(pr.nickname, '') ilike '%' || t || '%'
    )
  order by
    p.is_pinned desc,
    rank desc,
    case when sort_in = 'hot' then (p.like_count + p.comment_count) else 0 end desc,
    case when sort_in = 'active' then p.last_activity_at end desc nulls last,
    p.created_at desc, p.id desc
  limit greatest(1, least(limit_in, 100))
  offset greatest(0, offset_in)
$$;

REVOKE ALL ON FUNCTION public.search_community_posts(text[], text, int, int, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_community_posts(text[], text, int, int, text, text)
  TO anon, authenticated;
ALTER FUNCTION public.search_community_posts(text[], text, int, int, text, text)
  SET statement_timeout = '3s';

-- ---------------------------------------------------------------------------
-- P3.5  Governance actions on the atomic administrator channel
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_role_action_capabilities
  DROP CONSTRAINT admin_role_action_capabilities_action_check;
ALTER TABLE public.admin_role_action_capabilities
  ADD CONSTRAINT admin_role_action_capabilities_action_check
  CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token',
    'upload_banner',
    'issue_token',
    'revoke_admin_tokens',
    'decide_appeal',
    'restore_content',
    'set_post_official',
    'set_post_featured',
    'set_post_locked',
    'set_post_category'
  ));

-- Day-to-day handling for the moderation role; the official label and
-- "Start here" for the owner only.
INSERT INTO public.admin_role_action_capabilities (admin_role, action) VALUES
  ('operator', 'restore_content'),
  ('operator', 'set_post_locked'),
  ('operator', 'set_post_category'),
  ('owner', 'restore_content'),
  ('owner', 'set_post_locked'),
  ('owner', 'set_post_category'),
  ('owner', 'set_post_official'),
  ('owner', 'set_post_featured')
ON CONFLICT (admin_role, action) DO NOTHING;

ALTER TABLE public.admin_mutation_requests
  DROP CONSTRAINT admin_mutation_requests_action_check;
ALTER TABLE public.admin_mutation_requests
  ADD CONSTRAINT admin_mutation_requests_action_check
  CHECK (action IN (
    'apply_ban',
    'lift_suspension',
    'update_report_status',
    'resolve_target_reports',
    'takedown_content',
    'set_post_pinned',
    'upsert_banner',
    'delete_banner',
    'revoke_token',
    'issue_token',
    'revoke_admin_tokens',
    'decide_appeal',
    'restore_content',
    'set_post_official',
    'set_post_featured',
    'set_post_locked',
    'set_post_category'
  ));

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_event_kind_check;
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_event_kind_check
  CHECK (event_kind IN (
    'ban_applied',
    'suspension_lifted',
    'report_status_changed',
    'actor_blocked',
    'admin_login',
    'admin_unauthorized',
    'content_takedown',
    'token_revoked',
    'post_pin_changed',
    'banner_changed',
    'token_issued',
    'appeal_decided',
    'appeal_more_information_requested',
    'support_email_claimed',
    'content_restored',
    'post_official_changed',
    'post_featured_changed',
    'post_lock_changed',
    'post_category_changed'
  ));

-- The Edge API refuses every administrator whose capability list differs from
-- its own (hasExactRoleCapabilities), which is what makes an out-of-band grant
-- visible. The rows added above would therefore lock the console out between
-- this migration and the next API deployment. This projection keeps reporting
-- the vocabulary it always has; the database capability table stays the
-- authority for the new actions, inside the mutation transaction.
--
-- The older v1 function makes the same promise to builds from before v2
-- ("old exact capability set", 20260720035037) and gets the same filter.
CREATE OR REPLACE FUNCTION public.admin_token_authorization(p_token_hash text)
RETURNS TABLE (
  admin_id uuid,
  admin_name text,
  admin_email text,
  role text,
  capabilities text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  authorization_time timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  authorization_time := pg_catalog.clock_timestamp();

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = authorization_time
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > authorization_time)
       AND public.admin_token_identity_safe(
         token.admin_name,
         token.admin_email
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = token.admin_id
       )
    RETURNING token.admin_id, token.admin_name, token.admin_email, token.role
  )
  SELECT matched.admin_id,
         matched.admin_name,
         matched.admin_email,
         matched.role,
         ARRAY(
           SELECT capability.action
             FROM public.admin_role_action_capabilities AS capability
            WHERE capability.admin_role = matched.role
              AND capability.action <> 'decide_appeal'
              -- Same fixed vocabulary as admin_token_authorization_v2 below.
              AND capability.action IN (
                'apply_ban', 'decide_appeal', 'delete_banner', 'issue_token',
                'lift_suspension', 'resolve_target_reports', 'revoke_admin_tokens',
                'revoke_token', 'set_post_pinned', 'takedown_content',
                'update_report_status', 'upload_banner', 'upsert_banner'
              )
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_token_authorization_v2(
  p_token_hash text
)
RETURNS TABLE (
  token_id uuid,
  admin_id uuid,
  admin_name text,
  admin_email text,
  role text,
  expires_at timestamptz,
  server_now timestamptz,
  capabilities text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  authorization_time timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  authorization_time := pg_catalog.clock_timestamp();

  -- This is deliberately an unlocked, read-only negative probe. It prevents
  -- random/revoked/expired hashes from entering the global lock domain. A
  -- positive candidate receives no authority here and is checked again below.
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_tokens AS candidate
     WHERE candidate.token_hash = p_token_hash
       AND candidate.admin_id IS NOT NULL
       AND candidate.revoked_at IS NULL
       AND (
         candidate.expires_at IS NULL
         OR candidate.expires_at > authorization_time
       )
       AND public.admin_token_identity_safe(
         candidate.admin_name,
         candidate.admin_email
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = candidate.admin_id
       )
  ) THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  authorization_time := pg_catalog.clock_timestamp();

  RETURN QUERY
  WITH matched AS (
    UPDATE public.admin_tokens AS token
       SET last_used_at = authorization_time
     WHERE token.token_hash = p_token_hash
       AND token.admin_id IS NOT NULL
       AND token.revoked_at IS NULL
       AND (token.expires_at IS NULL OR token.expires_at > authorization_time)
       AND public.admin_token_identity_safe(
         token.admin_name,
         token.admin_email
       )
       AND EXISTS (
         SELECT 1
           FROM public.profiles AS profile
          WHERE profile.id = token.admin_id
       )
    RETURNING
      token.id,
      token.admin_id,
      token.admin_name,
      token.admin_email,
      token.role,
      token.expires_at
  )
  SELECT matched.id,
         matched.admin_id,
         matched.admin_name,
         matched.admin_email,
         matched.role,
         matched.expires_at,
         authorization_time,
         ARRAY(
           SELECT capability.action
             FROM public.admin_role_action_capabilities AS capability
            WHERE capability.admin_role = matched.role
              -- The vocabulary this function has always reported. Actions added
              -- later are authorized by admin_assert_mutation_capability inside
              -- the mutation and are not part of this projection.
              AND capability.action IN (
                'apply_ban', 'decide_appeal', 'delete_banner', 'issue_token',
                'lift_suspension', 'resolve_target_reports', 'revoke_admin_tokens',
                'revoke_token', 'set_post_pinned', 'takedown_content',
                'update_report_status', 'upload_banner', 'upsert_banner'
              )
            ORDER BY capability.action
         )::text[]
    FROM matched;
END;
$function$;

COMMENT ON FUNCTION public.admin_token_authorization_v2(text) IS
  'Service-only active admin-token authorization. Missing, inactive, or identity-unsafe candidates exit after an indexed read-only probe; positive candidates are revalidated under both admin advisory locks before last_used_at is updated. The capability list is limited to the vocabulary of 20260722152000; later actions are checked by admin_assert_mutation_capability.';

-- Preserve the current dispatcher under a private name. Every earlier action
-- is still delegated to it unchanged.
ALTER FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb)
  RENAME TO admin_execute_mutation_pre_community_governance;

REVOKE ALL ON FUNCTION public.admin_execute_mutation_pre_community_governance(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

-- One transaction, like every other administrator action: the token is
-- locked and revalidated, the role's capability is asserted, the request is
-- recorded once per (token, idempotency key), the change is made, and exactly
-- one actor-attributed audit row is written before the result is stored.
--
--   restore_content    {target_type: post|comment, target_id, reason}
--   set_post_official  {post_id, official, reason, official_profile_id}
--   set_post_featured  {post_id, featured, reason}
--   set_post_locked    {post_id, locked, reason}
--   set_post_category  {post_id, category, reason}
--
-- official_profile_id is the account the site posts as. The Edge API passes
-- it from COMMUNITY_OFFICIAL_PROFILE_ID and never from the request; when that
-- is not configured the action is refused by name and nothing is written.
-- A listing has no hidden state (a takedown deletes it), so restore_content
-- takes topics and replies only.
CREATE FUNCTION public.admin_execute_community_governance(
  p_token_hash text,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  actor_token_id uuid;
  actor_id_value uuid;
  actor_role_value text;
  action_time timestamptz;
  inserted_rows integer;
  existing_action text;
  existing_payload_hash text;
  existing_status text;
  existing_result jsonb;
  result_value jsonb;
  allowed_keys text[];
  payload_key text;
  flag_key text;
  flag_value boolean;
  reason_value text;
  target_type_value text;
  target_id_value uuid;
  official_profile_value uuid;
  category_value text;
  post_author uuid;
  post_title text;
  post_category text;
  post_is_official boolean;
  post_is_featured boolean;
  parent_post_id uuid;
  restored_author uuid;
  restored_at timestamptz;
  affected_rows integer := 0;
  event_kind_value text;
  audit_target uuid;
  audit_details jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718180000::bigint);
  PERFORM pg_catalog.pg_advisory_xact_lock(20260718190000::bigint);
  action_time := pg_catalog.clock_timestamp();

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'admin_token_inactive';
  END IF;

  SELECT token.id, token.admin_id, token.role
    INTO actor_token_id, actor_id_value, actor_role_value
    FROM public.admin_tokens AS token
   WHERE token.token_hash = p_token_hash
     AND token.admin_id IS NOT NULL
     AND token.revoked_at IS NULL
     AND (token.expires_at IS NULL OR token.expires_at > action_time)
     AND EXISTS (
       SELECT 1
         FROM public.profiles AS actor_profile
        WHERE actor_profile.id = token.admin_id
     )
   FOR UPDATE;

  IF actor_token_id IS NULL OR actor_id_value IS NULL
     OR actor_role_value NOT IN ('operator', 'security_admin', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'admin_token_inactive';
  END IF;

  UPDATE public.admin_tokens AS token
     SET last_used_at = action_time
   WHERE token.id = actor_token_id;

  IF p_idempotency_key IS NULL
     OR p_payload_hash IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$'
     OR p_action IS NULL
     OR p_action NOT IN (
       'restore_content',
       'set_post_official',
       'set_post_featured',
       'set_post_locked',
       'set_post_category'
     )
     OR pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid';
  END IF;

  PERFORM public.admin_assert_mutation_capability(actor_token_id, p_action);

  allowed_keys := CASE p_action
    WHEN 'restore_content' THEN ARRAY['target_type', 'target_id', 'reason']
    WHEN 'set_post_official' THEN ARRAY['post_id', 'official', 'reason', 'official_profile_id']
    WHEN 'set_post_featured' THEN ARRAY['post_id', 'featured', 'reason']
    WHEN 'set_post_locked' THEN ARRAY['post_id', 'locked', 'reason']
    ELSE ARRAY['post_id', 'category', 'reason']
  END;
  FOR payload_key IN SELECT pg_catalog.jsonb_object_keys(p_payload) LOOP
    IF NOT (payload_key = ANY (allowed_keys)) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
  END LOOP;

  -- Every action carries a human-readable reason for the audit.
  IF pg_catalog.jsonb_typeof(p_payload -> 'reason') IS DISTINCT FROM 'string'
     OR public.admin_moderation_reason_valid(p_payload ->> 'reason') IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
  END IF;
  reason_value := pg_catalog.btrim(p_payload ->> 'reason');

  IF p_action = 'restore_content' THEN
    IF pg_catalog.jsonb_typeof(p_payload -> 'target_type') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'target_type') NOT IN ('post', 'comment')
       OR pg_catalog.jsonb_typeof(p_payload -> 'target_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'target_id') !~* uuid_pattern THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_type_value := p_payload ->> 'target_type';
    target_id_value := pg_catalog.lower(p_payload ->> 'target_id')::uuid;
  ELSE
    flag_key := CASE p_action
      WHEN 'set_post_official' THEN 'official'
      WHEN 'set_post_featured' THEN 'featured'
      WHEN 'set_post_locked' THEN 'locked'
    END;
    IF pg_catalog.jsonb_typeof(p_payload -> 'post_id') IS DISTINCT FROM 'string'
       OR (p_payload ->> 'post_id') !~* uuid_pattern
       OR (flag_key IS NOT NULL
           AND pg_catalog.jsonb_typeof(p_payload -> flag_key) IS DISTINCT FROM 'boolean')
       OR (p_action = 'set_post_category' AND (
             pg_catalog.jsonb_typeof(p_payload -> 'category') IS DISTINCT FROM 'string'
             OR (p_payload ->> 'category') NOT IN (
               'campus-life', 'settling-market', 'alumni-career', 'events-social', 'local-deals'
             ))) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
    END IF;
    target_id_value := pg_catalog.lower(p_payload ->> 'post_id')::uuid;
    IF flag_key IS NOT NULL THEN
      flag_value := (p_payload ->> flag_key)::boolean;
    END IF;
    category_value := p_payload ->> 'category';

    IF p_action = 'set_post_official' THEN
      IF NOT (p_payload ? 'official_profile_id')
         OR p_payload -> 'official_profile_id' = 'null'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'official_profile_not_configured';
      END IF;
      IF pg_catalog.jsonb_typeof(p_payload -> 'official_profile_id') IS DISTINCT FROM 'string'
         OR (p_payload ->> 'official_profile_id') !~* uuid_pattern THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'admin_mutation_invalid_payload';
      END IF;
      official_profile_value := pg_catalog.lower(p_payload ->> 'official_profile_id')::uuid;
    END IF;
  END IF;

  INSERT INTO public.admin_mutation_requests (
    admin_token_id,
    idempotency_key,
    actor_id,
    action,
    payload_hash
  ) VALUES (
    actor_token_id,
    p_idempotency_key,
    actor_id_value,
    p_action,
    p_payload_hash
  )
  ON CONFLICT (admin_token_id, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows = 0 THEN
    SELECT request.action,
           request.payload_hash,
           request.status,
           request.result
      INTO existing_action,
           existing_payload_hash,
           existing_status,
           existing_result
      FROM public.admin_mutation_requests AS request
     WHERE request.admin_token_id = actor_token_id
       AND request.idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF existing_action IS DISTINCT FROM p_action
       OR existing_payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'idempotency_conflict';
    END IF;

    IF existing_status = 'completed' AND existing_result IS NOT NULL THEN
      RETURN existing_result;
    END IF;

    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'idempotency_incomplete';
  END IF;

  PERFORM pg_catalog.set_config('admin.actor_id', actor_id_value::text, true);
  PERFORM pg_catalog.set_config('admin.token_id', actor_token_id::text, true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', p_idempotency_key::text, true);
  PERFORM pg_catalog.set_config('admin.audit_required', 'on', true);

  IF p_action = 'restore_content' THEN
    IF target_type_value = 'post' THEN
      UPDATE public.posts AS post
         SET status = 'active'
       WHERE post.id = target_id_value
         AND post.status = 'hidden';
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
    ELSE
      UPDATE public.post_comments AS comment
         SET status = 'active'
       WHERE comment.id = target_id_value
         AND comment.status = 'hidden'
      RETURNING comment.post_id, comment.user_id, comment.created_at
        INTO parent_post_id, restored_author, restored_at;
      GET DIAGNOSTICS affected_rows = ROW_COUNT;
      -- The takedown subtracted the reply when it hid it. A reply that was
      -- hidden when this migration ran was also left out of the backfill, so
      -- the topic may never have been moved forward or answered by it: place
      -- the reply now, as update_post_comment_count places a new one. Neither
      -- time moves backwards and a first answer already recorded is kept.
      IF affected_rows > 0 THEN
        UPDATE public.posts AS post
           SET comment_count = post.comment_count + 1,
               last_activity_at = greatest(post.last_activity_at, restored_at),
               answered_at = coalesce(post.answered_at,
                 CASE WHEN restored_author <> post.user_id THEN restored_at END)
         WHERE post.id = parent_post_id;
      END IF;
    END IF;
    IF affected_rows = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'content_not_found';
    END IF;
    event_kind_value := 'content_restored';
    audit_target := target_id_value;
    audit_details := pg_catalog.jsonb_build_object(
      'target_type', target_type_value,
      'reason', reason_value,
      'affected', affected_rows
    );
    result_value := pg_catalog.jsonb_build_object(
      'data', pg_catalog.jsonb_build_object('ok', true, 'affected', affected_rows)
    );
  ELSE
    SELECT post.user_id, post.title, post.category, post.is_official, post.is_featured
      INTO post_author, post_title, post_category, post_is_official, post_is_featured
      FROM public.posts AS post
     WHERE post.id = target_id_value
       AND post.status = 'active'
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'post_not_found';
    END IF;

    IF p_action = 'set_post_official' THEN
      IF post_author IS DISTINCT FROM official_profile_value THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'post_not_official_account';
      END IF;
      -- posts_featured_official_only: take the topic out of "Start here" first.
      IF NOT flag_value AND post_is_featured THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'admin_mutation_conflict';
      END IF;
      UPDATE public.posts AS post
         SET is_official = flag_value
       WHERE post.id = target_id_value;
      event_kind_value := 'post_official_changed';
      audit_details := pg_catalog.jsonb_build_object(
        'post_id', target_id_value, 'official', flag_value, 'reason', reason_value
      );
    ELSIF p_action = 'set_post_featured' THEN
      IF flag_value AND NOT post_is_official THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'post_not_official';
      END IF;
      UPDATE public.posts AS post
         SET is_featured = flag_value
       WHERE post.id = target_id_value;
      event_kind_value := 'post_featured_changed';
      audit_details := pg_catalog.jsonb_build_object(
        'post_id', target_id_value, 'featured', flag_value, 'reason', reason_value
      );
    ELSIF p_action = 'set_post_locked' THEN
      UPDATE public.posts AS post
         SET locked_at = CASE WHEN flag_value THEN coalesce(post.locked_at, action_time) END
       WHERE post.id = target_id_value;
      event_kind_value := 'post_lock_changed';
      audit_details := pg_catalog.jsonb_build_object(
        'post_id', target_id_value, 'locked', flag_value, 'reason', reason_value
      );
    ELSE
      -- A legacy update has no title and no board.
      IF post_title IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'post_not_topic';
      END IF;
      UPDATE public.posts AS post
         SET category = category_value
       WHERE post.id = target_id_value;
      event_kind_value := 'post_category_changed';
      audit_details := pg_catalog.jsonb_build_object(
        'post_id', target_id_value, 'from', post_category, 'to', category_value, 'reason', reason_value
      );
    END IF;
    result_value := pg_catalog.jsonb_build_object('success', true);
  END IF;

  PERFORM public.record_audit(event_kind_value, actor_id_value, audit_target, audit_details);

  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_audit_log AS audit
     WHERE audit.admin_token_id = actor_token_id
       AND audit.idempotency_key = p_idempotency_key
       AND audit.actor_id = actor_id_value
       AND audit.event_kind = event_kind_value
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'admin_audit_required_missing';
  END IF;

  UPDATE public.admin_mutation_requests AS request
     SET status = 'completed',
         result = result_value,
         completed_at = action_time
   WHERE request.admin_token_id = actor_token_id
     AND request.idempotency_key = p_idempotency_key
     AND request.status = 'running';
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'idempotency_completion_failed';
  END IF;

  PERFORM pg_catalog.set_config('admin.audit_required', 'off', true);
  PERFORM pg_catalog.set_config('admin.actor_id', '', true);
  PERFORM pg_catalog.set_config('admin.token_id', '', true);
  PERFORM pg_catalog.set_config('admin.idempotency_key', '', true);
  PERFORM pg_catalog.set_config('admin.role', '', true);

  RETURN result_value;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_community_governance(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_execute_mutation(
  p_token_hash text,
  p_idempotency_key uuid,
  p_payload_hash text,
  p_action text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_action IN (
    'restore_content',
    'set_post_official',
    'set_post_featured',
    'set_post_locked',
    'set_post_category'
  ) THEN
    RETURN public.admin_execute_community_governance(
      p_token_hash,
      p_idempotency_key,
      p_payload_hash,
      p_action,
      p_payload
    );
  END IF;

  RETURN public.admin_execute_mutation_pre_community_governance(
    p_token_hash,
    p_idempotency_key,
    p_payload_hash,
    p_action,
    p_payload
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_execute_mutation(
  text, uuid, text, text, jsonb
) TO service_role;

-- The moderation role's audit list gains the three events that role produces.
-- Owner decisions (official, "Start here") stay in the owner's list only, as
-- pinning does.
CREATE OR REPLACE FUNCTION public.admin_list_moderation_audit_log(
  limit_in integer DEFAULT 100,
  offset_in integer DEFAULT 0,
  kind_filter text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  event_kind text,
  actor_id uuid,
  actor_nickname text,
  target_id uuid,
  target_nickname text,
  details jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    audit.id,
    audit.event_kind,
    audit.actor_id,
    actor.nickname,
    audit.target_id,
    target.nickname,
    CASE audit.event_kind
      WHEN 'ban_applied' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'suspension_id', audit.details -> 'suspension_id',
          'level', audit.details -> 'level',
          'reason', audit.details -> 'reason',
          'category', audit.details -> 'category',
          'ends_at', audit.details -> 'ends_at',
          'linked_fingerprint_candidates',
            audit.details -> 'linked_fingerprint_candidates',
          'linked_accounts_action', audit.details -> 'linked_accounts_action'
        )
      )
      WHEN 'suspension_lifted' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'suspension_id', audit.details -> 'suspension_id',
          'reason', audit.details -> 'reason'
        )
      )
      WHEN 'report_status_changed' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'from', audit.details -> 'from',
          'to', audit.details -> 'to',
          'bulk', audit.details -> 'bulk',
          'target_type', audit.details -> 'target_type',
          'affected', audit.details -> 'affected'
        )
      )
      WHEN 'content_takedown' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'target_type', audit.details -> 'target_type',
          'reason', audit.details -> 'reason',
          'affected', audit.details -> 'affected'
        )
      )
      WHEN 'actor_blocked' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'table', audit.details -> 'table',
          'level', audit.details -> 'level',
          'ends_at', audit.details -> 'ends_at'
        )
      )
      WHEN 'content_restored' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'target_type', audit.details -> 'target_type',
          'reason', audit.details -> 'reason',
          'affected', audit.details -> 'affected'
        )
      )
      WHEN 'post_lock_changed' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'post_id', audit.details -> 'post_id',
          'locked', audit.details -> 'locked',
          'reason', audit.details -> 'reason'
        )
      )
      WHEN 'post_category_changed' THEN pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'post_id', audit.details -> 'post_id',
          'from', audit.details -> 'from',
          'to', audit.details -> 'to',
          'reason', audit.details -> 'reason'
        )
      )
      ELSE pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'decision', audit.details -> 'decision',
          'terminal', audit.details -> 'terminal',
          'reason', audit.details -> 'reason',
          'effective_at', audit.details -> 'effective_at',
          'suspension_active', audit.details -> 'suspension_active',
          'lifted_now', audit.details -> 'lifted_now',
          'remains_active', audit.details -> 'remains_active'
        )
      )
    END,
    audit.created_at
  FROM public.admin_audit_log AS audit
  LEFT JOIN public.profiles AS actor
    ON actor.id = audit.actor_id
  LEFT JOIN public.suspensions AS appeal_suspension
    ON audit.event_kind IN (
      'appeal_decided', 'appeal_more_information_requested'
    )
   AND appeal_suspension.id = audit.target_id
  LEFT JOIN public.profiles AS target
    ON target.id = COALESCE(appeal_suspension.profile_id, audit.target_id)
  WHERE audit.event_kind IN (
      'ban_applied',
      'suspension_lifted',
      'report_status_changed',
      'content_takedown',
      'actor_blocked',
      'appeal_decided',
      'appeal_more_information_requested',
      'content_restored',
      'post_lock_changed',
      'post_category_changed'
    )
    AND (kind_filter IS NULL OR audit.event_kind = kind_filter)
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 500))
  OFFSET GREATEST(0, offset_in);
$function$;

-- What the console's topic list needs for the five buttons. The older
-- admin_list_plaza_posts keeps its shape for the API that is deployed today.
CREATE FUNCTION public.admin_list_community_posts(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0,
  status_in text DEFAULT 'active'
)
RETURNS TABLE (
  id uuid,
  title text,
  category text,
  content text,
  author_nickname text,
  author_id uuid,
  status text,
  is_pinned boolean,
  is_official boolean,
  is_featured boolean,
  locked_at timestamptz,
  like_count integer,
  comment_count integer,
  thumbnail text,
  created_at timestamptz,
  last_activity_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    post.id,
    post.title,
    post.category,
    pg_catalog.left(post.content, 200),
    author.nickname,
    post.user_id,
    post.status,
    post.is_pinned,
    post.is_official,
    post.is_featured,
    post.locked_at,
    post.like_count,
    post.comment_count,
    (post.images)[1],
    post.created_at,
    post.last_activity_at
  FROM public.posts AS post
  JOIN public.profiles AS author
    ON author.id = post.user_id
  WHERE post.status = CASE WHEN status_in = 'hidden' THEN 'hidden' ELSE 'active' END
  ORDER BY post.is_pinned DESC, post.created_at DESC, post.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_community_posts(integer, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_community_posts(integer, integer, text)
  TO service_role;

-- P3.6: the report queue by how long each target has waited. A target waits
-- from its oldest report that is still pending; earlier reports that were
-- already handled do not count. admin_list_reports_grouped is unchanged.
CREATE FUNCTION public.admin_list_report_queue(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  target_type text,
  target_id uuid,
  report_count bigint,
  pending_count bigint,
  reporter_count bigint,
  last_reason text,
  last_note text,
  last_reporter_nickname text,
  last_status text,
  first_created_at timestamptz,
  last_created_at timestamptz,
  last_report_id uuid,
  oldest_pending_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH grouped AS (
    SELECT
      report.target_type,
      report.target_id,
      pg_catalog.count(*) AS report_count,
      pg_catalog.count(*) FILTER (WHERE report.status = 'pending') AS pending_count,
      pg_catalog.count(DISTINCT report.reporter_id) AS reporter_count,
      pg_catalog.min(report.created_at) AS first_created_at,
      pg_catalog.max(report.created_at) AS last_created_at,
      (pg_catalog.array_agg(report.id ORDER BY report.created_at DESC, report.id DESC))[1] AS last_report_id,
      pg_catalog.min(report.created_at) FILTER (WHERE report.status = 'pending') AS oldest_pending_at
    FROM public.reports AS report
    GROUP BY report.target_type, report.target_id
  )
  SELECT
    grouped.target_type,
    grouped.target_id,
    grouped.report_count,
    grouped.pending_count,
    grouped.reporter_count,
    latest.reason,
    latest.note,
    reporter.nickname,
    latest.status,
    grouped.first_created_at,
    grouped.last_created_at,
    grouped.last_report_id,
    grouped.oldest_pending_at
  FROM grouped
  JOIN public.reports AS latest
    ON latest.id = grouped.last_report_id
  JOIN public.profiles AS reporter
    ON reporter.id = latest.reporter_id
  WHERE grouped.pending_count > 0
  ORDER BY grouped.oldest_pending_at ASC, grouped.target_type ASC, grouped.target_id ASC
  LIMIT GREATEST(1, LEAST(limit_in, 200))
  OFFSET GREATEST(0, offset_in);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_report_queue(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_report_queue(integer, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- P3.6  What each side reads about a hidden topic
-- ---------------------------------------------------------------------------
-- Row security hides a hidden topic from everyone, its author included, and
-- that stays so: letting the author select the row would also let them delete
-- the evidence an appeal is decided on. These two functions answer the only
-- questions the pages ask.

-- 'active', 'hidden' or 'missing', and nothing else about the topic. A topic
-- whose author is hidden from the caller reads as hidden; the visibility
-- helper answers NULL, not false, for a caller without a user claim.
CREATE FUNCTION public.community_post_state(post_id_in uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '3s'
AS $function$
  SELECT coalesce((
    SELECT CASE
      WHEN post.status = 'deleted' THEN 'missing'
      WHEN post.status = 'hidden' THEN 'hidden'
      WHEN moderation_private.profile_content_visible(post.user_id) IS NOT TRUE THEN 'hidden'
      ELSE 'active'
    END
    FROM public.posts AS post
    WHERE post.id = post_id_in
  ), 'missing');
$function$;

REVOKE ALL ON FUNCTION public.community_post_state(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_post_state(uuid)
  TO anon, authenticated;

-- The caller's own hidden topics: the text they wrote and nothing else. No
-- images: they were moved out of the public bucket when the topic was hidden.
-- No reason either (D-54 2e): what a moderator typed for the takedown is an
-- internal audit note that may name the reporter, so this function does not
-- read the audit log at all.
CREATE FUNCTION public.list_own_hidden_posts(post_id_in uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  title text,
  category text,
  content text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '3s'
AS $function$
  SELECT
    post.id,
    post.title,
    post.category,
    post.content,
    post.created_at
  FROM public.posts AS post
  WHERE post.user_id = (SELECT auth.uid())
    AND post.status = 'hidden'
    AND (post_id_in IS NULL OR post.id = post_id_in)
  ORDER BY post.created_at DESC, post.id DESC
  LIMIT 50;
$function$;

REVOKE ALL ON FUNCTION public.list_own_hidden_posts(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_own_hidden_posts(uuid)
  TO authenticated;

COMMENT ON TABLE public.post_follows IS
  'Topics a member watches. Private to the member; a reply notifies the first 500 watchers (private.notify_topic_reply). D-49: open to restricted accounts.';
COMMENT ON TABLE public.post_bookmarks IS
  'Topics a member saved. Private to the member and notifies nobody. D-49: open to restricted accounts, like favorites.';
COMMENT ON COLUMN public.posts.last_activity_at IS
  'Time of the latest reply, or of the topic itself. Maintained by update_post_comment_count; never moves backwards.';
COMMENT ON COLUMN public.posts.answered_at IS
  'Time of the first reply from somebody other than the author. Set once and never cleared.';
COMMENT ON COLUMN public.posts.is_featured IS
  'Shown in "Start here". Official posts only (posts_featured_official_only); set by set_post_featured.';
COMMENT ON COLUMN public.posts.locked_at IS
  'When replies were closed. Set and cleared by set_post_locked; enforced by enforce_locked_post_reply.';
COMMENT ON FUNCTION public.admin_execute_mutation(text, uuid, text, text, jsonb) IS
  'Stable service-only mutation dispatcher. Community governance actions run in admin_execute_community_governance; all earlier actions delegate to the reviewed predecessor.';
COMMENT ON FUNCTION public.admin_execute_mutation_pre_community_governance(
  text, uuid, text, text, jsonb
) IS
  'Private dispatcher from before the community governance actions, retained verbatim for every earlier administrator action.';
COMMENT ON FUNCTION public.admin_execute_community_governance(text, uuid, text, text, jsonb) IS
  'Private atomic implementation of restore_content, set_post_official, set_post_featured, set_post_locked and set_post_category with required audit and idempotency.';
COMMENT ON FUNCTION public.admin_list_community_posts(integer, integer, text) IS
  'Service-only topic list for the moderation console: active by default, hidden on request, with the official, featured, lock and board state.';
COMMENT ON FUNCTION public.admin_list_report_queue(integer, integer) IS
  'Service-only report queue: targets with pending reports, longest wait first.';
COMMENT ON FUNCTION public.community_post_state(uuid) IS
  'active, hidden or missing for one topic, so a page can tell a hidden topic from a deleted one without reading it.';
COMMENT ON FUNCTION public.list_own_hidden_posts(uuid) IS
  'The caller''s own hidden topics: their own text and nothing from the audit log. Row security on posts is unchanged.';
COMMENT ON TABLE private.community_reply_notice_config IS
  'Release switch for the comment_reply and followed_post_reply notices (private.notify_topic_reply). Off until the P3 clients and API are released; see RUNBOOK.md, "Reply notice switch".';
COMMENT ON COLUMN public.post_comments.reply_to_comment_id IS
  'The reply this one answers, when the member named one: a visible reply of the same thread (private.validate_comment_reply_target). Its author gets the comment_reply notice.';

NOTIFY pgrst, 'reload schema';
COMMIT;
