-- Additive community topics. Deploy the migration before the new client.
-- Old clients keep inserting updates without either field and keep their RPC.
BEGIN;

ALTER TABLE public.posts
  ADD COLUMN title text,
  ADD COLUMN category text,
  ADD CONSTRAINT posts_topic_metadata_check CHECK (
    (title IS NULL AND category IS NULL)
    OR (title IS NOT NULL AND category IS NOT NULL
      AND title = btrim(title)
      AND char_length(title) BETWEEN 1 AND 120
      AND octet_length(title) <= 480
      AND title !~ E'[\\r\\n]'
      AND category IN ('campus-life', 'settling-market', 'alumni-career', 'events-social', 'local-deals'))
  );

-- Keep existing row policies, server-owned columns, update permissions and
-- post_items ownership/cap triggers unchanged. Only these two columns open.
GRANT SELECT (title, category) ON public.posts TO anon, authenticated;
GRANT INSERT (title, category) ON public.posts TO authenticated;

CREATE FUNCTION private.validate_post_topic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM private.assert_text_boundary(NEW.title, 'post_title', 1, 120, 480, true);
  PERFORM private.assert_moderated_text(NEW.title, 'post_title');
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.validate_post_topic() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_post_topic
  BEFORE INSERT OR UPDATE OF title, category ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.validate_post_topic();

CREATE INDEX idx_posts_category_feed ON public.posts (category, is_pinned DESC, created_at DESC, id DESC)
  WHERE status = 'active';
CREATE INDEX idx_posts_title_trgm ON public.posts USING gin (title extensions.gin_trgm_ops);

-- Versioned entry point: changing the old RPC's return type would break
-- installed clients. Invoker rights keep both RLS and column ACLs in effect.
create or replace function public.search_community_posts(
  terms_in   text[],
  sort_in    text  default 'recent',
  limit_in   int   default 20,
  offset_in  int   default 0,
  category_in text default null
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
  rank              real
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
    ) as rank
  from public.posts p
  left join public.profiles pr on pr.id = p.user_id
  where p.status = 'active'
    and (category_in is null or p.category = category_in)
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
    p.created_at desc, p.id desc
  limit greatest(1, least(limit_in, 100))
  offset greatest(0, offset_in)
$$;

revoke all on function public.search_community_posts(text[], text, int, int, text) from public;
grant execute on function public.search_community_posts(text[], text, int, int, text) to anon, authenticated;


-- Reissue the existing evidence functions with only the post branch extended.
-- Reporter-bound invoker checks, immutable snapshots, other target branches,
-- return signatures and the service-role-only admin boundary are preserved.
CREATE OR REPLACE FUNCTION public.capture_report_target_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  reported_target record;
BEGIN
  -- Invoker rights deliberately keep RLS and column grants in force. Explicit
  -- predicates below mirror the product's current reportable states and make
  -- the contract reviewable even if an RLS policy is later broadened.
  IF caller_id IS NOT NULL AND caller_id <> NEW.reporter_id THEN
    RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
  END IF;

  IF NEW.target_type = 'message' THEN
    SELECT
      message.id,
      message.conversation_id,
      message.sender_id,
      message.content,
      message.message_type,
      message.created_at,
      conversation.buyer_id,
      conversation.seller_id,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.messages AS message
    INNER JOIN public.conversations AS conversation
      ON conversation.id = message.conversation_id
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = message.sender_id
    WHERE message.id = NEW.target_id
      AND NEW.reporter_id IN (
        conversation.buyer_id,
        conversation.seller_id
      )
      AND NEW.reporter_id <> message.sender_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    -- Coordinate with the symmetric block migration. Rechecking blocks after
    -- the shared pair lock closes the report-vs-block race without revealing
    -- who blocked whom.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        LEAST(
          reported_target.buyer_id::text,
          reported_target.seller_id::text
        ) || ':' || GREATEST(
          reported_target.buyer_id::text,
          reported_target.seller_id::text
        ),
        0
      )
    );

    IF (
      caller_id IS NOT NULL
      AND NOT private.current_user_can_access_pair(
        reported_target.buyer_id,
        reported_target.seller_id
      )
    ) OR (
      caller_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.blocks AS block_relation
        WHERE (
          block_relation.blocker_id = reported_target.buyer_id
          AND block_relation.blocked_id = reported_target.seller_id
        ) OR (
          block_relation.blocker_id = reported_target.seller_id
          AND block_relation.blocked_id = reported_target.buyer_id
        )
      )
    ) THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'message',
      'target_id', reported_target.id,
      'target_user_id', reported_target.sender_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'message_id', reported_target.id,
      'conversation_id', reported_target.conversation_id,
      'sender_id', reported_target.sender_id,
      'content', reported_target.content,
      'message_type', reported_target.message_type,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'item' THEN
    SELECT
      item.id,
      item.user_id,
      item.title,
      item.description,
      item.images,
      item.created_at,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.items AS item
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = item.user_id
    WHERE item.id = NEW.target_id
      AND item.status <> 'deleted'::public.item_status
      AND item.user_id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'item',
      'target_id', reported_target.id,
      'target_user_id', reported_target.user_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'title', reported_target.title,
      'description', reported_target.description,
      'images', reported_target.images,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'post' THEN
    SELECT
      post.id,
      post.user_id,
      post.title,
      post.category,
      post.content,
      post.images,
      post.created_at,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.posts AS post
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = post.user_id
    WHERE post.id = NEW.target_id
      AND post.status = 'active'
      AND post.user_id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'post',
      'target_id', reported_target.id,
      'target_user_id', reported_target.user_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'title', reported_target.title,
      'category', reported_target.category,
      'content', reported_target.content,
      'images', reported_target.images,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'comment' THEN
    SELECT
      comment.id,
      comment.post_id,
      comment.user_id,
      comment.content,
      comment.created_at,
      target_profile.nickname AS target_user_nickname
    INTO reported_target
    FROM public.post_comments AS comment
    INNER JOIN public.posts AS parent_post
      ON parent_post.id = comment.post_id
    INNER JOIN public.profiles AS target_profile
      ON target_profile.id = comment.user_id
    WHERE comment.id = NEW.target_id
      AND comment.status = 'active'
      AND parent_post.status = 'active'
      AND comment.user_id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'comment',
      'target_id', reported_target.id,
      'target_user_id', reported_target.user_id,
      'target_user_nickname', reported_target.target_user_nickname,
      'post_id', reported_target.post_id,
      'content', reported_target.content,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSIF NEW.target_type = 'user' THEN
    SELECT
      target_profile.id,
      target_profile.nickname,
      target_profile.avatar_url,
      target_profile.bio,
      target_profile.status_text,
      target_profile.status_emoji,
      target_profile.created_at
    INTO reported_target
    FROM public.profiles AS target_profile
    WHERE target_profile.id = NEW.target_id
      AND target_profile.id <> NEW.reporter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
    END IF;

    NEW.target_snapshot := pg_catalog.jsonb_build_object(
      'target_type', 'user',
      'target_id', reported_target.id,
      'target_user_id', reported_target.id,
      'target_user_nickname', reported_target.nickname,
      'avatar_url', reported_target.avatar_url,
      'bio', reported_target.bio,
      'status_text', reported_target.status_text,
      'status_emoji', reported_target.status_emoji,
      'created_at', reported_target.created_at,
      'captured_at', pg_catalog.statement_timestamp()
    );
  ELSE
    RAISE EXCEPTION 'report_target_unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.capture_report_target_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_report_detail(
  report_id_in uuid
)
RETURNS TABLE (
  id                    uuid,
  reporter_id           uuid,
  reporter_nickname     text,
  reporter_email        text,
  target_type           text,
  target_id             uuid,
  target_user_id        uuid,
  target_user_nickname  text,
  target_preview        text,
  target_image          text,
  reason                text,
  note                  text,
  status                text,
  created_at            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH resolved AS (
    SELECT
      report.id,
      report.reporter_id,
      report.target_type,
      report.target_id,
      report.reason,
      report.note,
      report.status,
      report.created_at,
      report.target_snapshot ->> 'target_user_nickname'
        AS snapshot_target_user_nickname,
      CASE report.target_type
        WHEN 'user' THEN report.target_id
        WHEN 'item' THEN COALESCE(
          (
            SELECT item.user_id
            FROM public.items AS item
            WHERE item.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END
        )
        WHEN 'post' THEN COALESCE(
          (
            SELECT post.user_id
            FROM public.posts AS post
            WHERE post.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END
        )
        WHEN 'message' THEN COALESCE(
          (
            SELECT message.sender_id
            FROM public.messages AS message
            WHERE message.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END,
          CASE WHEN (report.target_snapshot ->> 'sender_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'sender_id')::uuid END
        )
        WHEN 'comment' THEN COALESCE(
          (
            SELECT comment.user_id
            FROM public.post_comments AS comment
            WHERE comment.id = report.target_id
          ),
          CASE WHEN (report.target_snapshot ->> 'target_user_id') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN (report.target_snapshot ->> 'target_user_id')::uuid END
        )
      END AS resolved_user_id,
      CASE report.target_type
        WHEN 'item' THEN COALESCE(
          (
            SELECT pg_catalog.left(item.title, 120)
            FROM public.items AS item
            WHERE item.id = report.target_id
          ),
          pg_catalog.left(report.target_snapshot ->> 'title', 120)
        )
        WHEN 'post' THEN COALESCE(
          (
            SELECT pg_catalog.concat_ws(E'\n',
              CASE WHEN post.category IS NOT NULL THEN '[' || post.category || ']' END,
              NULLIF(post.title, ''), pg_catalog.left(post.content, 120))
            FROM public.posts AS post
            WHERE post.id = report.target_id
          ),
          pg_catalog.concat_ws(E'\n',
            CASE WHEN report.target_snapshot ->> 'category' IS NOT NULL
              THEN '[' || (report.target_snapshot ->> 'category') || ']' END,
            NULLIF(report.target_snapshot ->> 'title', ''),
            pg_catalog.left(report.target_snapshot ->> 'content', 120))
        )
        WHEN 'message' THEN COALESCE(
          (
            SELECT pg_catalog.left(message.content, 120)
            FROM public.messages AS message
            WHERE message.id = report.target_id
          ),
          pg_catalog.left(report.target_snapshot ->> 'content', 120)
        )
        WHEN 'comment' THEN COALESCE(
          (
            SELECT pg_catalog.left(comment.content, 120)
            FROM public.post_comments AS comment
            WHERE comment.id = report.target_id
          ),
          pg_catalog.left(report.target_snapshot ->> 'content', 120)
        )
        ELSE NULL
      END AS resolved_preview,
      CASE report.target_type
        WHEN 'item' THEN COALESCE(
          (
            SELECT (item.images)[1]
            FROM public.items AS item
            WHERE item.id = report.target_id
          ),
          report.target_snapshot -> 'images' ->> 0
        )
        WHEN 'post' THEN COALESCE(
          (
            SELECT (post.images)[1]
            FROM public.posts AS post
            WHERE post.id = report.target_id
          ),
          report.target_snapshot -> 'images' ->> 0
        )
        ELSE NULL
      END AS resolved_image
    FROM public.reports AS report
    WHERE report.id = report_id_in
  )
  SELECT
    resolved.id,
    resolved.reporter_id,
    reporter.nickname,
    reporter.email,
    resolved.target_type,
    resolved.target_id,
    resolved.resolved_user_id,
    COALESCE(
      target.nickname,
      resolved.snapshot_target_user_nickname
    ),
    resolved.resolved_preview,
    resolved.resolved_image,
    resolved.reason,
    resolved.note,
    resolved.status,
    resolved.created_at
  FROM resolved
  INNER JOIN public.profiles AS reporter
    ON reporter.id = resolved.reporter_id
  LEFT JOIN public.profiles AS target
    ON target.id = resolved.resolved_user_id
$function$;
REVOKE ALL ON FUNCTION public.admin_get_report_detail(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_report_detail(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
