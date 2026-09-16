-- Add public seller nicknames to both search versions. Keep profile-derived
-- fields separate: nickname changes rebuild one row, not every owned listing.
-- Run in one transaction. Locks block profile edits briefly, not item writes.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='120s';
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE search_private.seller_fields (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  fields search_private.cached_field[] NOT NULL
);
ALTER TABLE search_private.seller_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible_seller ON search_private.seller_fields FOR SELECT TO anon,authenticated
  USING (profile_id IN (SELECT id FROM public.profiles));
REVOKE ALL ON search_private.seller_fields FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON search_private.seller_fields TO anon,authenticated,service_role;

CREATE FUNCTION search_private.build_seller_fields(nickname_in text)
RETURNS search_private.cached_field[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN nullif(btrim(nickname_in),'') IS NULL THEN '{}'::search_private.cached_field[]
 ELSE ARRAY[ROW(nickname_in,lower(nickname_in),search_private.token_ids(nickname_in),true,false,false)::search_private.cached_field] END
$$;
CREATE FUNCTION search_private.sync_seller_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO search_private.seller_fields(profile_id,fields)
 VALUES(NEW.id,search_private.build_seller_fields(NEW.nickname))
 ON CONFLICT(profile_id) DO UPDATE SET fields=EXCLUDED.fields;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION search_private.build_seller_fields(text),search_private.sync_seller_fields()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_seller_search_insert AFTER INSERT ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION search_private.sync_seller_fields();
CREATE TRIGGER sync_seller_search_update AFTER UPDATE OF nickname ON public.profiles
 FOR EACH ROW WHEN (OLD.nickname IS DISTINCT FROM NEW.nickname)
 EXECUTE FUNCTION search_private.sync_seller_fields();
INSERT INTO search_private.seller_fields(profile_id,fields)
 SELECT id,search_private.build_seller_fields(nickname) FROM public.profiles;
ANALYZE search_private.seller_fields;
COMMENT ON TABLE search_private.seller_fields IS
 'Public nickname only. Profile RLS stays authoritative; never expose search_private through Data API.';

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
