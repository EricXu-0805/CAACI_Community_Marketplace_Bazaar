-- Own reversible feedback, never a public label on the seller or item.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='120s';
CREATE TABLE IF NOT EXISTS public.hidden_items (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,item_id)
);
CREATE INDEX IF NOT EXISTS hidden_items_item ON public.hidden_items(item_id);
ALTER TABLE public.hidden_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hidden_items FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hidden_items TO anon,authenticated;
GRANT INSERT(user_id,item_id),DELETE ON public.hidden_items TO authenticated;
GRANT ALL ON public.hidden_items TO service_role;
DROP POLICY IF EXISTS own_feedback_read ON public.hidden_items;
CREATE POLICY own_feedback_read ON public.hidden_items FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS own_feedback_insert ON public.hidden_items;
CREATE POLICY own_feedback_insert ON public.hidden_items FOR INSERT TO authenticated WITH CHECK(
 user_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.items i WHERE i.id=hidden_items.item_id AND i.status='active' AND i.user_id<>hidden_items.user_id));
DROP POLICY IF EXISTS own_feedback_delete ON public.hidden_items;
CREATE POLICY own_feedback_delete ON public.hidden_items FOR DELETE TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE OR REPLACE FUNCTION private.limit_hidden_items() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'account_changed' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hidden-items:'||NEW.user_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.hidden_items WHERE user_id=NEW.user_id AND item_id=NEW.item_id)
 AND (SELECT count(*) FROM public.hidden_items WHERE user_id=NEW.user_id)>=1000
 THEN RAISE EXCEPTION 'hidden_item_limit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.limit_hidden_items() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS hidden_items_limit ON public.hidden_items;
CREATE TRIGGER hidden_items_limit BEFORE INSERT ON public.hidden_items
 FOR EACH ROW EXECUTE FUNCTION private.limit_hidden_items();

-- Fixed actor, only current user's block pairs, never a caller-supplied identity.
CREATE OR REPLACE FUNCTION search_private.blocked_seller_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT b.blocked_id FROM public.blocks b WHERE b.blocker_id=(SELECT auth.uid())
 UNION SELECT b.blocker_id FROM public.blocks b WHERE b.blocked_id=(SELECT auth.uid())
$$;
REVOKE ALL ON FUNCTION search_private.blocked_seller_ids() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION search_private.blocked_seller_ids() TO anon,authenticated,service_role;

-- A bounded two-stage discovery pool: 200 fresh candidates plus 100 per
-- preferred category (max 3). Only public ids/reasons leave this RPC; callers
-- re-read each page under current item/profile RLS. No raw view history/GPS.
CREATE OR REPLACE FUNCTION public.browse_listing_ids(
 sort_in text DEFAULT 'latest',
 categories_in public.item_category[] DEFAULT '{}',
 category_in public.item_category DEFAULT NULL,
 condition_in public.item_condition DEFAULT NULL,
 price_min_in numeric DEFAULT NULL,
 price_max_in numeric DEFAULT NULL,
 user_id_in uuid DEFAULT NULL,
 listing_type_in text DEFAULT NULL,
 location_in text DEFAULT NULL,
 verified_only_in boolean DEFAULT false,
 detail_date_in date DEFAULT NULL,
 price_unit_in text DEFAULT NULL,
 limit_in integer DEFAULT 20,
 offset_in integer DEFAULT 0,
 before_created_in timestamptz DEFAULT NULL,
 before_id_in uuid DEFAULT NULL
) RETURNS TABLE(id uuid, reason text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
BEGIN
 IF sort_in NOT IN ('latest','price_asc','price_desc','popular','recommended')
 OR coalesce(cardinality(categories_in),0)>3 OR array_ndims(categories_in)>1
 OR (before_created_in IS NULL)<>(before_id_in IS NULL)
 OR char_length(location_in)>120 OR offset_in<0 OR offset_in>10000
 THEN RAISE EXCEPTION 'invalid_discovery_input' USING ERRCODE='22023'; END IF;
 RETURN QUERY
 WITH eligible AS NOT MATERIALIZED (
 SELECT i.id,i.user_id,i.category,i.price,i.view_count,i.created_at FROM public.items i
 WHERE i.status='active'
 AND (category_in IS NULL OR i.category=category_in)
 AND (condition_in IS NULL OR i.condition=condition_in)
 AND (price_min_in IS NULL OR i.price>=price_min_in)
 AND (price_max_in IS NULL OR i.price<=price_max_in)
 AND (user_id_in IS NULL OR i.user_id=user_id_in)
 AND (listing_type_in IS NULL OR i.listing_type=listing_type_in)
 AND (verified_only_in=false OR i.location_verified=true)
 AND NOT EXISTS(SELECT 1 FROM public.hidden_items h WHERE h.user_id=(SELECT auth.uid()) AND h.item_id=i.id)
 AND i.user_id NOT IN(SELECT * FROM search_private.blocked_seller_ids())
 AND (location_in IS NULL OR EXISTS(
   SELECT 1 FROM unnest(CASE WHEN lower(btrim(location_in))='uiuc'
    THEN ARRAY['UIUC','Illini Union','伊利尼学生中心','Grainger Library','Grainger 图书馆','Main Library','主图书馆','UGL','本科生图书馆','Siebel Center','Siebel CS 楼','ARC Gym','ARC 健身房','Lincoln Hall','林肯堂','Foellinger Aud.','Foellinger 礼堂','Ikenberry Commons','伊肯贝里公共区']
    ELSE ARRAY[btrim(location_in)] END) loc WHERE i.location ILIKE '%'||loc||'%'))
 AND (detail_date_in IS NULL OR
  (i.category='housing' AND i.listing_details->>'available_from'<=to_char(detail_date_in,'YYYY-MM-DD') AND i.listing_details->>'available_to'>=to_char(detail_date_in,'YYYY-MM-DD')) OR
  (i.category='rideshare' AND i.listing_details->>'departure_date'=to_char(detail_date_in,'YYYY-MM-DD')))
 AND (price_unit_in IS NULL OR i.listing_details->>'price_unit'=price_unit_in)
 ), fresh AS MATERIALIZED (
  SELECT e.* FROM eligible e ORDER BY e.created_at DESC,e.id DESC LIMIT 200
 ), interests AS MATERIALIZED (
  SELECT e.* FROM (SELECT DISTINCT unnest(categories_in) category) c
  CROSS JOIN LATERAL (SELECT x.* FROM eligible x WHERE x.category=c.category ORDER BY x.created_at DESC,x.id DESC LIMIT 100) e
 ), candidates AS MATERIALIZED (
  SELECT * FROM fresh UNION SELECT * FROM interests
 ), scored AS (
  SELECT c.*, (CASE WHEN c.category=ANY(categories_in) THEN 2.0 ELSE 0 END
    +3.0/(1+greatest(0,extract(epoch FROM statement_timestamp()-c.created_at))/604800)) score,
    CASE WHEN c.category=ANY(categories_in) THEN 'interest' ELSE 'recent' END why
  FROM candidates c
 ), diverse AS (
  SELECT s.*,row_number() OVER(PARTITION BY s.user_id ORDER BY s.score DESC,s.created_at DESC,s.id DESC) seller_round FROM scored s
 )
 SELECT result.item_id,result.why FROM (
  (SELECT d.id item_id,d.why,row_number() OVER(ORDER BY d.seller_round,d.score DESC,d.created_at DESC,d.id DESC) position FROM diverse d WHERE sort_in='recommended'
   ORDER BY d.seller_round,d.score DESC,d.created_at DESC,d.id DESC LIMIT 200)
  UNION ALL
  (SELECT e.id item_id,'recent'::text why,row_number() OVER(ORDER BY
    CASE WHEN sort_in='price_asc' THEN e.price END ASC,
    CASE WHEN sort_in='price_desc' THEN e.price END DESC,
    CASE WHEN sort_in='popular' THEN e.view_count END DESC,
    CASE WHEN sort_in='latest' THEN e.created_at END DESC,e.id DESC) position
   FROM eligible e WHERE sort_in<>'recommended'
   AND (before_created_in IS NULL OR (e.created_at,e.id)<(before_created_in,before_id_in))
   ORDER BY CASE WHEN sort_in='price_asc' THEN e.price END ASC,
    CASE WHEN sort_in='price_desc' THEN e.price END DESC,
    CASE WHEN sort_in='popular' THEN e.view_count END DESC,
    CASE WHEN sort_in='latest' THEN e.created_at END DESC,e.id DESC
   LIMIT greatest(1,least(coalesce(limit_in,20),100)) OFFSET coalesce(offset_in,0))
 ) result ORDER BY result.position;
END $$;
REVOKE ALL ON FUNCTION public.browse_listing_ids(text,public.item_category[],public.item_category,public.item_condition,numeric,numeric,uuid,text,text,boolean,date,text,integer,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.browse_listing_ids(text,public.item_category[],public.item_category,public.item_condition,numeric,numeric,uuid,text,text,boolean,date,text,integer,integer,timestamptz,uuid) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.search_items_fuzzy_v2(
  terms_in         text[],
  category_in      public.item_category  DEFAULT NULL,
  condition_in     public.item_condition DEFAULT NULL,
  price_min_in     numeric               DEFAULT NULL,
  price_max_in     numeric               DEFAULT NULL,
  user_id_in       uuid                  DEFAULT NULL,
  listing_type_in  text                  DEFAULT NULL,
  limit_in         integer               DEFAULT 20,
  offset_in        integer               DEFAULT 0,
  location_in      text                  DEFAULT NULL,
  verified_only_in boolean               DEFAULT false,
  detail_date_in   date                  DEFAULT NULL,
  price_unit_in    text                  DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  user_id           uuid,
  title             text,
  title_i18n        jsonb,
  description_i18n  jsonb,
  source_lang       text,
  price             numeric,
  category          public.item_category,
  condition         public.item_condition,
  status            public.item_status,
  listing_type      text,
  location          text,
  location_verified boolean,
  images            text[],
  image_dimensions  jsonb,
  view_count        integer,
  favorite_count    integer,
  negotiable        boolean,
  created_at        timestamptz,
  profile           jsonb,
  listing_details   jsonb,
  rank              real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $function$
#variable_conflict use_column
DECLARE query_terms search_private.term_input[]; threshold_hint real; patterns text[]; blank_matches boolean; blank_contained boolean; min_tokens integer; max_tokens integer;
BEGIN
  IF terms_in IS NULL OR cardinality(terms_in)=0 THEN RETURN; END IF;
  IF cardinality(terms_in)>12 OR array_ndims(terms_in)<>1 OR EXISTS (
    SELECT 1 FROM unnest(terms_in) AS term
    WHERE term IS NULL OR char_length(btrim(term))=0 OR char_length(term)>200
  ) THEN RAISE EXCEPTION 'invalid_search_terms' USING ERRCODE='22023'; END IF;
  -- current_setting uses %g and loses threshold precision. show_limit returns
  -- native float4; item_rank falls back to native % on equality, preserving
  -- the underlying float8 GUC, including values beside a float4 boundary.
  threshold_hint:=extensions.show_limit();
  SELECT array_agg(ROW(t,'%'||lower(t)||'%',search_private.token_ids(t))::search_private.term_input) INTO query_terms FROM unnest(terms_in) t;
  SELECT array_agg(t.pattern),min(cardinality(t.tokens)),max(cardinality(t.tokens)) INTO patterns,min_tokens,max_tokens FROM unnest(query_terms) t;
  blank_contained:='' LIKE ANY(patterns);
  blank_matches:='' OPERATOR(extensions.%) ANY(terms_in) OR blank_contained;
  RETURN QUERY
  WITH input AS NOT MATERIALIZED (
    SELECT i.id,i.user_id,i.created_at FROM public.items i WHERE i.status='active'
    AND NOT EXISTS(SELECT 1 FROM public.hidden_items h WHERE h.user_id=(SELECT auth.uid()) AND h.item_id=i.id AND user_id_in IS NULL)
    AND i.user_id NOT IN(SELECT * FROM search_private.blocked_seller_ids())
    AND (category_in IS NULL OR i.category = category_in)
    AND (condition_in IS NULL OR i.condition = condition_in)
    AND (price_min_in IS NULL OR i.price >= price_min_in)
    AND (price_max_in IS NULL OR i.price <= price_max_in)
    AND (user_id_in IS NULL OR i.user_id = user_id_in)
    AND (listing_type_in IS NULL OR i.listing_type = listing_type_in)
    AND (location_in IS NULL OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(
        CASE WHEN pg_catalog.lower(pg_catalog.btrim(location_in)) = 'uiuc'
          THEN ARRAY['UIUC', 'Illini Union', '伊利尼学生中心', 'Grainger Library', 'Grainger 图书馆', 'Main Library', '主图书馆', 'UGL', '本科生图书馆', 'Siebel Center', 'Siebel CS 楼', 'ARC Gym', 'ARC 健身房', 'Lincoln Hall', '林肯堂', 'Foellinger Aud.', 'Foellinger 礼堂', 'Ikenberry Commons', '伊肯贝里公共区']
          ELSE ARRAY[pg_catalog.btrim(location_in)]
        END
      ) AS pickup_term
      WHERE i.location ILIKE '%' || pickup_term || '%'
    ))
    AND (verified_only_in = false OR i.location_verified = true)
    AND (detail_date_in IS NULL OR
      (i.category='housing' AND i.listing_details->>'available_from' <= to_char(detail_date_in,'YYYY-MM-DD') AND i.listing_details->>'available_to' >= to_char(detail_date_in,'YYYY-MM-DD')) OR
      (i.category='rideshare' AND i.listing_details->>'departure_date' = to_char(detail_date_in,'YYYY-MM-DD')))
    AND (price_unit_in IS NULL OR i.listing_details->>'price_unit' = price_unit_in)
  ), scores AS MATERIALIZED (
    SELECT i.id,i.created_at,search_private.item_rank(f.fields || coalesce(s.fields,'{}'::search_private.cached_field[]),query_terms,patterns,threshold_hint,true,blank_matches,blank_contained,min_tokens,max_tokens) rank
    FROM input i JOIN search_private.item_fields f ON f.item_id=i.id
    LEFT JOIN search_private.seller_fields s ON s.profile_id=i.user_id
  ), ranked AS MATERIALIZED (
    SELECT * FROM scores WHERE rank IS NOT NULL ORDER BY rank DESC,created_at DESC,id DESC
    LIMIT GREATEST(1,LEAST(limit_in,100)) OFFSET GREATEST(0,offset_in)
  )
  SELECT
    i.id,
    i.user_id,
    i.title,
    i.title_i18n,
    i.description_i18n,
    i.source_lang,
    i.price,
    i.category,
    i.condition,
    i.status,
    i.listing_type,
    i.location,
    i.location_verified,
    i.images,
    i.image_dimensions,
    i.view_count,
    i.favorite_count,
    i.negotiable,
    i.created_at,
    pg_catalog.jsonb_build_object(
      'id',                 p.id,
      'nickname',           p.nickname,
      'avatar_url',         p.avatar_url,
      'location',           p.location,
      'is_illini_verified', p.is_illini_verified,
      'status_text',        p.status_text,
      'status_emoji',       p.status_emoji
    ) AS profile,
    i.listing_details,
    ranked.rank AS rank
  FROM ranked JOIN public.items i ON i.id=ranked.id
  LEFT JOIN public.profiles p ON p.id=i.user_id
  ORDER BY ranked.rank DESC,ranked.created_at DESC,ranked.id DESC;
END
$function$;




CREATE OR REPLACE FUNCTION public.search_items_fuzzy(
  terms_in         text[],
  category_in      public.item_category  DEFAULT NULL,
  condition_in     public.item_condition DEFAULT NULL,
  price_min_in     numeric               DEFAULT NULL,
  price_max_in     numeric               DEFAULT NULL,
  user_id_in       uuid                  DEFAULT NULL,
  listing_type_in  text                  DEFAULT NULL,
  limit_in         integer               DEFAULT 20,
  offset_in        integer               DEFAULT 0,
  location_in      text                  DEFAULT NULL,
  verified_only_in boolean               DEFAULT false
)
RETURNS TABLE (
  id                uuid,
  user_id           uuid,
  title             text,
  title_i18n        jsonb,
  description_i18n  jsonb,
  source_lang       text,
  price             numeric,
  category          public.item_category,
  condition         public.item_condition,
  status            public.item_status,
  listing_type      text,
  location          text,
  location_verified boolean,
  images            text[],
  image_dimensions  jsonb,
  view_count        integer,
  favorite_count    integer,
  negotiable        boolean,
  created_at        timestamptz,
  profile           jsonb,
  rank              real
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $function$
#variable_conflict use_column
DECLARE query_terms search_private.term_input[]; threshold_hint real; patterns text[]; blank_matches boolean; blank_contained boolean; min_tokens integer; max_tokens integer;
BEGIN
  IF terms_in IS NULL OR cardinality(terms_in)=0 THEN RETURN; END IF;
  IF cardinality(terms_in)>12 OR array_ndims(terms_in)<>1 OR EXISTS (
    SELECT 1 FROM unnest(terms_in) AS term
    WHERE term IS NULL OR char_length(btrim(term))=0 OR char_length(term)>200
  ) THEN RAISE EXCEPTION 'invalid_search_terms' USING ERRCODE='22023'; END IF;
  -- current_setting uses %g and loses threshold precision. show_limit returns
  -- native float4; item_rank falls back to native % on equality, preserving
  -- the underlying float8 GUC, including values beside a float4 boundary.
  threshold_hint:=extensions.show_limit();
  SELECT array_agg(ROW(t,'%'||lower(t)||'%',search_private.token_ids(t))::search_private.term_input) INTO query_terms FROM unnest(terms_in) t;
  SELECT array_agg(t.pattern),min(cardinality(t.tokens)),max(cardinality(t.tokens)) INTO patterns,min_tokens,max_tokens FROM unnest(query_terms) t;
  blank_contained:='' LIKE ANY(patterns);
  blank_matches:='' OPERATOR(extensions.%) ANY(terms_in) OR blank_contained;
  RETURN QUERY
  WITH input AS NOT MATERIALIZED (
    SELECT i.id,i.user_id,i.created_at FROM public.items i WHERE i.status='active'
    AND NOT EXISTS(SELECT 1 FROM public.hidden_items h WHERE h.user_id=(SELECT auth.uid()) AND h.item_id=i.id AND user_id_in IS NULL)
    AND i.user_id NOT IN(SELECT * FROM search_private.blocked_seller_ids())
    AND (category_in IS NULL OR i.category = category_in)
    AND (condition_in IS NULL OR i.condition = condition_in)
    AND (price_min_in IS NULL OR i.price >= price_min_in)
    AND (price_max_in IS NULL OR i.price <= price_max_in)
    AND (user_id_in IS NULL OR i.user_id = user_id_in)
    AND (listing_type_in IS NULL OR i.listing_type = listing_type_in)
    AND (location_in IS NULL OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(
        CASE WHEN pg_catalog.lower(pg_catalog.btrim(location_in)) = 'uiuc'
          THEN ARRAY['UIUC', 'Illini Union', '伊利尼学生中心', 'Grainger Library', 'Grainger 图书馆', 'Main Library', '主图书馆', 'UGL', '本科生图书馆', 'Siebel Center', 'Siebel CS 楼', 'ARC Gym', 'ARC 健身房', 'Lincoln Hall', '林肯堂', 'Foellinger Aud.', 'Foellinger 礼堂', 'Ikenberry Commons', '伊肯贝里公共区']
          ELSE ARRAY[pg_catalog.btrim(location_in)]
        END
      ) AS pickup_term
      WHERE i.location ILIKE '%' || pickup_term || '%'
    ))
    AND (verified_only_in = false OR i.location_verified = true)
  ), scores AS MATERIALIZED (
    SELECT i.id,i.created_at,search_private.item_rank(f.fields || coalesce(s.fields,'{}'::search_private.cached_field[]),query_terms,patterns,threshold_hint,false,blank_matches,blank_contained,min_tokens,max_tokens) rank
    FROM input i JOIN search_private.item_fields f ON f.item_id=i.id
    LEFT JOIN search_private.seller_fields s ON s.profile_id=i.user_id
  ), ranked AS MATERIALIZED (
    SELECT * FROM scores WHERE rank IS NOT NULL ORDER BY rank DESC,created_at DESC,id DESC
    LIMIT GREATEST(1,LEAST(limit_in,100)) OFFSET GREATEST(0,offset_in)
  )
  SELECT
    i.id,
    i.user_id,
    i.title,
    i.title_i18n,
    i.description_i18n,
    i.source_lang,
    i.price,
    i.category,
    i.condition,
    i.status,
    i.listing_type,
    i.location,
    i.location_verified,
    i.images,
    i.image_dimensions,
    i.view_count,
    i.favorite_count,
    i.negotiable,
    i.created_at,
    pg_catalog.jsonb_build_object(
      'id',                 p.id,
      'nickname',           p.nickname,
      'avatar_url',         p.avatar_url,
      'location',           p.location,
      'is_illini_verified', p.is_illini_verified,
      'status_text',        p.status_text,
      'status_emoji',       p.status_emoji
    ) AS profile,
    ranked.rank AS rank
  FROM ranked JOIN public.items i ON i.id=ranked.id
  LEFT JOIN public.profiles p ON p.id=i.user_id
  ORDER BY ranked.rank DESC,ranked.created_at DESC,ranked.id DESC;
END
$function$;


NOTIFY pgrst, 'reload schema';
