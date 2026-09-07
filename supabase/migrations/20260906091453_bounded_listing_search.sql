-- 10,001 synthetic bilingual listings exposed 1.4s single-term and 7.2s
-- three-term search in the previous v2 query. Keep invoker RLS, every filter,
-- ranked pagination and the exact response shape; replace the 5x3 cross
-- product and expose each trigram predicate to the planner.
-- This is additive to applied migrations. Apply after structured details.
-- The bounded input matches expandSearch's 12 terms. No source rows change.
-- RLS remains authoritative. No extra index is added without measured benefit.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='120s';
DO $precheck$
BEGIN
  IF to_regprocedure('public.search_items_fuzzy_v2(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text)') IS NULL THEN
    RAISE EXCEPTION 'apply_structured_listing_details_first';
  END IF;
END
$precheck$;

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
DECLARE patterns text[];
BEGIN
  IF terms_in IS NULL OR cardinality(terms_in)=0 THEN RETURN; END IF;
  IF cardinality(terms_in)>12 OR array_ndims(terms_in)<>1 OR EXISTS (
    SELECT 1 FROM unnest(terms_in) AS term
    WHERE term IS NULL OR char_length(btrim(term))=0 OR char_length(term)>200
  ) THEN RAISE EXCEPTION 'invalid_search_terms' USING ERRCODE='22023'; END IF;
  SELECT array_agg('%' || term || '%') INTO patterns FROM unnest(terms_in) AS term;
  RETURN QUERY
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
    (
      -- max(greatest(title scores, description scores)) distributes over
      -- the former cross product: five title fields + three descriptions,
      -- never fifteen title/description pairs for every synonym.
      SELECT COALESCE(max(GREATEST(
        CASE WHEN field.is_title THEN similarity(field.value, search_term)
             ELSE similarity(field.value, search_term) * 0.6 END,
        CASE WHEN field.value ILIKE '%' || search_term || '%'
             THEN CASE WHEN field.is_title THEN 0.4 ELSE 0.25 END ELSE 0 END
      )), 0)::real
      FROM pg_catalog.unnest(terms_in) AS search_term
      CROSS JOIN LATERAL (VALUES
        (i.title, true),
        (COALESCE(i.title_i18n->>'zh', ''), true),
        (COALESCE(i.title_i18n->>'en', ''), true),
        (COALESCE(i.listing_details->>'origin', ''), true),
        (COALESCE(i.listing_details->>'destination', ''), true),
        (COALESCE(i.description, ''), false),
        (COALESCE(i.description_i18n->>'zh', ''), false),
        (COALESCE(i.description_i18n->>'en', ''), false)
      ) AS field(value, is_title)
    ) AS rank
  FROM public.items AS i
  LEFT JOIN public.profiles AS p ON p.id = i.user_id
  WHERE i.status = 'active'
    AND (
(i.title % ANY(terms_in) OR i.title ILIKE ANY(patterns))
      OR (COALESCE(i.title_i18n->>'zh', '') % ANY(terms_in) OR COALESCE(i.title_i18n->>'zh', '') ILIKE ANY(patterns))
      OR (COALESCE(i.title_i18n->>'en', '') % ANY(terms_in) OR COALESCE(i.title_i18n->>'en', '') ILIKE ANY(patterns))
      OR (COALESCE(i.listing_details->>'origin', '') % ANY(terms_in) OR COALESCE(i.listing_details->>'origin', '') ILIKE ANY(patterns))
      OR (COALESCE(i.listing_details->>'destination', '') % ANY(terms_in) OR COALESCE(i.listing_details->>'destination', '') ILIKE ANY(patterns))
      OR (COALESCE(i.description, '') % ANY(terms_in) OR COALESCE(i.description, '') ILIKE ANY(patterns))
      OR (COALESCE(i.description_i18n->>'zh', '') % ANY(terms_in) OR COALESCE(i.description_i18n->>'zh', '') ILIKE ANY(patterns))
      OR (COALESCE(i.description_i18n->>'en', '') % ANY(terms_in) OR COALESCE(i.description_i18n->>'en', '') ILIKE ANY(patterns))
    )
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
  ORDER BY rank DESC, i.created_at DESC, i.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 100))
  OFFSET GREATEST(0, offset_in);
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
DECLARE patterns text[];
BEGIN
  IF terms_in IS NULL OR cardinality(terms_in)=0 THEN RETURN; END IF;
  IF cardinality(terms_in)>12 OR array_ndims(terms_in)<>1 OR EXISTS (
    SELECT 1 FROM unnest(terms_in) AS term
    WHERE term IS NULL OR char_length(btrim(term))=0 OR char_length(term)>200
  ) THEN RAISE EXCEPTION 'invalid_search_terms' USING ERRCODE='22023'; END IF;
  SELECT array_agg('%' || term || '%') INTO patterns FROM unnest(terms_in) AS term;
  RETURN QUERY
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
    (
      -- max(greatest(title scores, description scores)) distributes over
      -- the former cross product: three title fields + three descriptions,
      -- never nine title/description pairs for every synonym.
      SELECT COALESCE(max(GREATEST(
        CASE WHEN field.is_title THEN similarity(field.value, search_term)
             ELSE similarity(field.value, search_term) * 0.6 END,
        CASE WHEN field.value ILIKE '%' || search_term || '%'
             THEN CASE WHEN field.is_title THEN 0.4 ELSE 0.25 END ELSE 0 END
      )), 0)::real
      FROM pg_catalog.unnest(terms_in) AS search_term
      CROSS JOIN LATERAL (VALUES
        (i.title, true),
        (COALESCE(i.title_i18n->>'zh', ''), true),
        (COALESCE(i.title_i18n->>'en', ''), true),
        (COALESCE(i.description, ''), false),
        (COALESCE(i.description_i18n->>'zh', ''), false),
        (COALESCE(i.description_i18n->>'en', ''), false)
      ) AS field(value, is_title)
    ) AS rank
  FROM public.items AS i
  LEFT JOIN public.profiles AS p ON p.id = i.user_id
  WHERE i.status = 'active'
    AND (
(i.title % ANY(terms_in) OR i.title ILIKE ANY(patterns))
      OR (COALESCE(i.title_i18n->>'zh', '') % ANY(terms_in) OR COALESCE(i.title_i18n->>'zh', '') ILIKE ANY(patterns))
      OR (COALESCE(i.title_i18n->>'en', '') % ANY(terms_in) OR COALESCE(i.title_i18n->>'en', '') ILIKE ANY(patterns))
      OR (COALESCE(i.description, '') % ANY(terms_in) OR COALESCE(i.description, '') ILIKE ANY(patterns))
      OR (COALESCE(i.description_i18n->>'zh', '') % ANY(terms_in) OR COALESCE(i.description_i18n->>'zh', '') ILIKE ANY(patterns))
      OR (COALESCE(i.description_i18n->>'en', '') % ANY(terms_in) OR COALESCE(i.description_i18n->>'en', '') ILIKE ANY(patterns))
    )
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
  ORDER BY rank DESC, i.created_at DESC, i.id DESC
  LIMIT GREATEST(1, LEAST(limit_in, 100))
  OFFSET GREATEST(0, offset_in);
END
$function$;


NOTIFY pgrst, 'reload schema';
