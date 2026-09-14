-- Precompute native trigram sets when searchable listing text changes.
-- Exact pg_trgm scores/thresholds, filters, invoker RLS and response shape remain.
-- Apply this entire file in ONE transaction; lock timeout fails without partial
-- backfill. The item lock prevents a concurrent edit being overwritten by an
-- older backfill snapshot. Reads remain available during the bounded backfill.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='120s';
DO $guard$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm' AND e.extversion='1.6' AND n.nspname='extensions')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='intarray')
    OR to_regnamespace('search_private') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.items'::regclass AND attname IN ('title','description') AND attcollation <> 'pg_catalog.default'::regcollation)
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.items'::regclass)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid IN ('public.search_items_fuzzy'::regproc,'public.search_items_fuzzy_v2'::regproc) AND prosecdef)
  THEN RAISE EXCEPTION 'cached_listing_search_prerequisite_drift'; END IF;
END $guard$;
LOCK TABLE public.items IN SHARE ROW EXCLUSIVE MODE;
CREATE SCHEMA search_private;
REVOKE ALL ON SCHEMA search_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA search_private TO anon,authenticated,service_role;
-- Keep intarray operators off the application search_path: they must not
-- shadow ordinary integer-array operators or their existing index classes.
CREATE EXTENSION intarray WITH SCHEMA search_private VERSION '1.5';
-- Decode the native 24-bit tokens, retaining pg_trgm Unicode CRC collisions.
-- Never replace this with a custom tokenizer or a wider hash.
CREATE FUNCTION search_private.token_ids(value_in text) RETURNS integer[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT coalesce(array_agg(token_id ORDER BY token_id),'{}'::integer[])
 FROM (SELECT CASE WHEN left(t,2)='0x' AND length(t)=8
   THEN ('x'||substring(t FROM 3))::bit(24)::integer
   ELSE ('x'||encode(convert_to(t,'UTF8'),'hex'))::bit(24)::integer END token_id
 FROM unnest(extensions.show_trgm(value_in)) t) tokenized
$$;
CREATE TYPE search_private.term_input AS (value text,pattern text,tokens integer[]);

CREATE TYPE search_private.cached_field AS (
  value text, folded text, tokens integer[],
  present_v1 boolean, title_v1 boolean, title_v2 boolean
);
CREATE TABLE search_private.item_fields (
  item_id uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
  fields search_private.cached_field[] NOT NULL
);
ALTER TABLE search_private.item_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible_listing ON search_private.item_fields FOR SELECT TO anon,authenticated
  USING (item_id IN (SELECT id FROM public.items));
REVOKE ALL ON search_private.item_fields FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON search_private.item_fields TO anon,authenticated,service_role;
COMMENT ON TABLE search_private.item_fields IS
  'Derived search data; never expose search_private through the Data API. Item RLS is authoritative. Rebuild transactionally after pg_trgm/ICU/collation upgrades.';

CREATE FUNCTION search_private.build_fields(title_in text,title_i18n_in jsonb,description_in text,description_i18n_in jsonb,details_in jsonb)
RETURNS search_private.cached_field[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $build$
  SELECT array_agg(ROW(value,lower(value),search_private.token_ids(value),present_v1,title_v1,title_v2)::search_private.cached_field ORDER BY title_v1 DESC,title_v2 DESC,value)
  FROM (
    SELECT coalesce(v.value,'') value, bool_or(slot<=6) present_v1,
      bool_or(slot<=3) title_v1, bool_or(slot IN (1,2,3,7,8)) title_v2
    FROM (VALUES
      (1,title_in),(2,title_i18n_in->>'zh'),(3,title_i18n_in->>'en'),
      (4,description_in),(5,description_i18n_in->>'zh'),(6,description_i18n_in->>'en'),
      (7,details_in->>'origin'),(8,details_in->>'destination')
    ) v(slot,value) GROUP BY coalesce(v.value,'')
  ) deduplicated
$build$;

-- AFTER observes final values from all BEFORE validation/moderation triggers.
-- Invoking this trigger never skips or relaxes existing item write policies.
CREATE FUNCTION search_private.sync_item_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $sync$
BEGIN
  INSERT INTO search_private.item_fields(item_id,fields)
  VALUES (NEW.id,search_private.build_fields(NEW.title,NEW.title_i18n,NEW.description,NEW.description_i18n,NEW.listing_details))
  ON CONFLICT(item_id) DO UPDATE SET fields=EXCLUDED.fields;
  RETURN NEW;
END $sync$;
CREATE TRIGGER sync_listing_search_insert AFTER INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION search_private.sync_item_fields();
CREATE TRIGGER sync_listing_search_update AFTER UPDATE ON public.items
FOR EACH ROW WHEN (
  (OLD.title,OLD.title_i18n,OLD.description,OLD.description_i18n,OLD.listing_details)
  IS DISTINCT FROM
  (NEW.title,NEW.title_i18n,NEW.description,NEW.description_i18n,NEW.listing_details)
) EXECUTE FUNCTION search_private.sync_item_fields();

INSERT INTO search_private.item_fields(item_id,fields)
SELECT id,search_private.build_fields(title,title_i18n,description,description_i18n,listing_details)
FROM public.items;
ANALYZE search_private.item_fields;
CREATE FUNCTION search_private.item_rank(fields_in search_private.cached_field[],terms_in search_private.term_input[],patterns_in text[],threshold_hint real,v2 boolean,blank_matches boolean,blank_contained boolean,min_query_tokens integer,max_query_tokens integer)
RETURNS real LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE f search_private.cached_field; t search_private.term_input;
 best double precision:=0; matched boolean:=false; contained boolean; is_title boolean;
 weight double precision; floor_value double precision; upper_score real;
 n integer; count_field integer; raw_score real; best_similarity real; closest text;
BEGIN
 FOREACH f IN ARRAY fields_in LOOP
  IF NOT v2 AND NOT f.present_v1 THEN CONTINUE; END IF;
  is_title:=CASE WHEN v2 THEN f.title_v2 ELSE f.title_v1 END;
  weight:=CASE WHEN is_title THEN 1 ELSE 0.6 END;
  floor_value:=CASE WHEN is_title THEN 0.4 ELSE 0.25 END;
  IF f.value='' THEN
   matched:=matched OR blank_matches;
   IF blank_contained THEN best:=greatest(best,floor_value); END IF;
   CONTINUE;
  END IF;
  count_field:=cardinality(f.tokens);
  upper_score:=CASE WHEN count_field=0 OR max_query_tokens=0 THEN 0::real
    WHEN count_field>max_query_tokens THEN max_query_tokens::real/count_field::real
    WHEN count_field<min_query_tokens THEN count_field::real/min_query_tokens::real ELSE 1::real END;
  -- No field can exceed this score: intersection <= min(|A|,|B|).
  -- Once any field admitted the item, skipping a non-improving field is exact.
  IF matched AND greatest(upper_score*weight,floor_value)<=best THEN CONTINUE; END IF;
  contained:=f.folded LIKE ANY(patterns_in);
  matched:=matched OR contained;
  IF contained THEN best:=greatest(best,floor_value); END IF;
  IF upper_score*weight<=best AND (matched OR upper_score<threshold_hint) THEN CONTINUE; END IF;
  best_similarity:=-1; closest:=null;
  FOREACH t IN ARRAY terms_in LOOP
   n:=cardinality(f.tokens OPERATOR(search_private.&) t.tokens);
   raw_score:=CASE WHEN n=0 THEN 0::real ELSE n::real/(count_field+cardinality(t.tokens)-n)::real END;
   IF raw_score>best_similarity THEN best_similarity:=raw_score; closest:=t.value; END IF;
  END LOOP;
  best:=greatest(best,best_similarity*weight);
  IF NOT matched THEN
   matched:=CASE WHEN best_similarity>threshold_hint THEN true
                 WHEN best_similarity<threshold_hint THEN false
                 ELSE f.value OPERATOR(extensions.%) closest END;
  END IF;
  IF matched AND best=1 THEN RETURN 1::real; END IF;
 END LOOP;
 RETURN CASE WHEN matched THEN best::real ELSE NULL END;
END $$;

-- Clients may read visible derived fields and run pure scoring helpers only.
-- Revoke PUBLIC, including extension defaults; trigger/build helpers stay private.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA search_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION search_private.token_ids(text),
  search_private._int_inter(integer[],integer[]),
  search_private.item_rank(search_private.cached_field[],search_private.term_input[],text[],real,boolean,boolean,boolean,integer,integer)
TO anon,authenticated,service_role;
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
    SELECT i.id,i.created_at FROM public.items i WHERE i.status='active'
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
    SELECT i.id,i.created_at,search_private.item_rank(f.fields,query_terms,patterns,threshold_hint,true,blank_matches,blank_contained,min_tokens,max_tokens) rank
    FROM input i JOIN search_private.item_fields f ON f.item_id=i.id
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
    SELECT i.id,i.created_at FROM public.items i WHERE i.status='active'
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
    SELECT i.id,i.created_at,search_private.item_rank(f.fields,query_terms,patterns,threshold_hint,false,blank_matches,blank_contained,min_tokens,max_tokens) rank
    FROM input i JOIN search_private.item_fields f ON f.item_id=i.id
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
