-- Retain the exact indexed search deployed as reviewed revision 3, while
-- extending its maintained title index to seller names and private feedback.
-- Old 20260914 full-scan bodies must not replace that production optimization.
-- Fresh databases have item_fields but need the same indexed-field extension.
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='120s';
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.items IN SHARE ROW EXCLUSIVE MODE;
DO $bootstrap$
BEGIN
 IF to_regclass('search_private.knn_fields') IS NULL THEN
  EXECUTE $ddl$
-- Indexed-field definitions from the previously reviewed revision-3 deployment.
CREATE TABLE search_private.knn_fields AS
SELECT item_id,ordinality AS slot,(f).value,(f).folded,(f).present_v1,(f).title_v1,(f).title_v2,cardinality((f).tokens) AS token_count,(f).tokens
FROM search_private.item_fields CROSS JOIN LATERAL unnest(fields) WITH ORDINALITY AS f;
ALTER TABLE search_private.knn_fields ADD PRIMARY KEY(item_id,slot);
ALTER TABLE search_private.knn_fields ADD FOREIGN KEY(item_id) REFERENCES search_private.item_fields(item_id) ON DELETE CASCADE;
ALTER TABLE search_private.knn_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible_listing ON search_private.knn_fields FOR SELECT TO anon,authenticated USING(item_id IN(SELECT id FROM public.items));
REVOKE ALL ON search_private.knn_fields FROM PUBLIC,anon,authenticated;
GRANT SELECT ON search_private.knn_fields TO anon,authenticated,service_role;
CREATE INDEX knn_title ON search_private.knn_fields USING gist(value extensions.gist_trgm_ops(siglen=128)) WHERE title_v2;
CREATE FUNCTION search_private.sync_knn_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM search_private.knn_fields WHERE item_id=NEW.item_id;
 INSERT INTO search_private.knn_fields(item_id,slot,value,folded,present_v1,title_v1,title_v2,token_count,tokens)
 SELECT NEW.item_id,ordinality,(f).value,(f).folded,(f).present_v1,(f).title_v1,(f).title_v2,cardinality((f).tokens),(f).tokens
 FROM unnest(NEW.fields) WITH ORDINALITY AS f;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION search_private.sync_knn_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER sync_knn_fields AFTER INSERT OR UPDATE OF fields ON search_private.item_fields
FOR EACH ROW EXECUTE FUNCTION search_private.sync_knn_fields();
CREATE INDEX knn_desc_token_count ON search_private.knn_fields(token_count) WHERE NOT title_v2;
CREATE INDEX knn_desc_exact ON search_private.knn_fields(folded,item_id)
WHERE NOT title_v2 AND token_count<=64 AND octet_length(folded)<=512;
ANALYZE search_private.knn_fields;

$ddl$;
 END IF;
END $bootstrap$;
CREATE OR REPLACE FUNCTION search_private.build_seller_fields(nickname_in text)
RETURNS search_private.cached_field[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN nullif(btrim(nickname_in),'') IS NULL THEN '{}'::search_private.cached_field[]
 ELSE ARRAY[ROW(nickname_in,lower(nickname_in),search_private.token_ids(nickname_in),true,true,true)::search_private.cached_field] END
$$;
CREATE OR REPLACE FUNCTION search_private.sync_item_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE seller_name text;
BEGIN
 -- Serialize a profile rename with any concurrent listing text edit before
 -- acquiring the cache row. A stale seller name cannot overwrite a new one.
 SELECT nickname INTO seller_name FROM public.profiles WHERE id=NEW.user_id FOR SHARE;
 INSERT INTO search_private.item_fields(item_id,fields)
 VALUES(NEW.id,search_private.build_fields(NEW.title,NEW.title_i18n,NEW.description,NEW.description_i18n,NEW.listing_details)
   ||search_private.build_seller_fields(seller_name))
 ON CONFLICT(item_id) DO UPDATE SET fields=EXCLUDED.fields;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_listing_search_update ON public.items;
CREATE TRIGGER sync_listing_search_update AFTER UPDATE ON public.items
FOR EACH ROW WHEN (
 (OLD.user_id,OLD.title,OLD.title_i18n,OLD.description,OLD.description_i18n,OLD.listing_details)
 IS DISTINCT FROM (NEW.user_id,NEW.title,NEW.title_i18n,NEW.description,NEW.description_i18n,NEW.listing_details)
) EXECUTE FUNCTION search_private.sync_item_fields();
CREATE OR REPLACE FUNCTION search_private.sync_seller_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO search_private.seller_fields(profile_id,fields)
 VALUES(NEW.id,search_private.build_seller_fields(NEW.nickname))
 ON CONFLICT(profile_id) DO UPDATE SET fields=EXCLUDED.fields;
 -- Nicknames are indexed as titles. Index maintenance runs on writes, rather
 -- than joining and rescoring a seller for every item during each search.
 UPDATE search_private.item_fields f SET fields=
   search_private.build_fields(i.title,i.title_i18n,i.description,i.description_i18n,i.listing_details)
   ||search_private.build_seller_fields(NEW.nickname)
 FROM public.items i WHERE i.id=f.item_id AND i.user_id=NEW.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION search_private.build_seller_fields(text),search_private.sync_seller_fields(),search_private.sync_item_fields()
 FROM PUBLIC,anon,authenticated,service_role;
UPDATE search_private.seller_fields f SET fields=search_private.build_seller_fields(p.nickname)
 FROM public.profiles p WHERE p.id=f.profile_id;
INSERT INTO search_private.item_fields(item_id,fields)
 SELECT i.id,search_private.build_fields(i.title,i.title_i18n,i.description,i.description_i18n,i.listing_details)
   ||search_private.build_seller_fields(p.nickname)
 FROM public.items i LEFT JOIN public.profiles p ON p.id=i.user_id
ON CONFLICT(item_id) DO UPDATE SET fields=EXCLUDED.fields;
ANALYZE search_private.item_fields;
ANALYZE search_private.knn_fields;
-- Exact indexed query from revision 3; only private feedback filters are added below.
-- Previously reviewed union-bound scorer; unchanged.
CREATE OR REPLACE FUNCTION search_private.union_rank(fields_in search_private.cached_field[],terms_in search_private.term_input[],patterns_in text[],threshold_hint real,v2 boolean,blank_matches boolean,blank_contained boolean,min_query_tokens integer,max_query_tokens integer, query_union_tokens integer[])
RETURNS real LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE f search_private.cached_field; t search_private.term_input;
 best double precision:=0; matched boolean:=false; contained boolean; is_title boolean;
 weight double precision; floor_value double precision; upper_score real;
 n integer; count_field integer; union_overlap integer; raw_score real; best_similarity real; closest text;
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
  union_overlap:=least(cardinality(f.tokens OPERATOR(search_private.&) query_union_tokens),max_query_tokens);
  upper_score:=CASE WHEN union_overlap=0 THEN 0::real ELSE union_overlap::real/(count_field+greatest(min_query_tokens,union_overlap)-union_overlap)::real END;
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

REVOKE ALL ON FUNCTION search_private.union_rank(search_private.cached_field[],search_private.term_input[],text[],real,boolean,boolean,boolean,integer,integer,integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_private.union_rank(search_private.cached_field[],search_private.term_input[],text[],real,boolean,boolean,boolean,integer,integer,integer[]) TO anon,authenticated,service_role;
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
-- Search terms and optional filters require parameter-specific index plans.
-- Restore the caller's plan_cache_mode automatically when this function exits.
SET plan_cache_mode = force_custom_plan
AS $function$
#variable_conflict use_column
DECLARE query_terms search_private.term_input[]; threshold_hint real; patterns text[]; blank_matches boolean; blank_contained boolean; min_tokens integer; max_tokens integer; query_union_tokens integer[];
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
  SELECT coalesce(array_agg(DISTINCT tok ORDER BY tok),'{}'::integer[]) INTO query_union_tokens FROM unnest(query_terms) qt CROSS JOIN LATERAL unnest(qt.tokens) tok;
  blank_contained:='' LIKE ANY(patterns);
  blank_matches:='' OPERATOR(extensions.%) ANY(terms_in) OR blank_contained;
  RETURN QUERY
  WITH input AS NOT MATERIALIZED (
    SELECT i.id,i.created_at FROM public.items i WHERE i.status='active'
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
  ), nearest_seed AS MATERIALIZED (
    SELECT t.ord,t.term,n.item_id,n.distance FROM unnest(terms_in) WITH ORDINALITY t(term,ord)
    CROSS JOIN LATERAL (
      SELECT f.item_id,f.value OPERATOR(extensions.<->) t.term AS distance
      FROM search_private.knn_fields f
      WHERE f.title_v2 AND EXISTS (SELECT 1 FROM input i WHERE i.id=f.item_id OFFSET 0)
      ORDER BY f.value OPERATOR(extensions.<->) t.term LIMIT 40
    ) n
  ), seed_boundaries AS MATERIALIZED (
    SELECT ord,term,count(*) n,max(distance) boundary FROM nearest_seed GROUP BY ord,term
  ), nearest AS MATERIALIZED (
    SELECT s.ord,s.item_id,s.distance,(b.n<40) AS complete_boundary
    FROM nearest_seed s JOIN seed_boundaries b USING(ord,term) WHERE NOT(b.n>=40 AND b.boundary<=0.75)
    UNION ALL
    SELECT b.ord,n.item_id,n.distance,true FROM seed_boundaries b
    CROSS JOIN LATERAL (
      SELECT f.item_id,f.value OPERATOR(extensions.<->) b.term AS distance
      FROM search_private.knn_fields f
      WHERE f.title_v2 AND EXISTS (SELECT 1 FROM input i WHERE i.id=f.item_id OFFSET 0)
      ORDER BY f.value OPERATOR(extensions.<->) b.term FETCH FIRST 40 ROWS WITH TIES
    ) n WHERE b.n>=40 AND b.boundary<=0.75
  ), recent_input AS MATERIALIZED (
    SELECT i.id,i.created_at FROM input i ORDER BY i.created_at DESC,i.id DESC
    LIMIT least(512::bigint,(GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)*8)
  ), recent_title_contains AS MATERIALIZED (
    SELECT i.id,i.created_at FROM recent_input i WHERE EXISTS (
      SELECT 1 FROM search_private.knn_fields f WHERE f.item_id=i.id AND f.title_v2 AND f.folded LIKE ANY(patterns) OFFSET 0
    ) ORDER BY i.created_at DESC,i.id DESC
    LIMIT (GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)
  ), title_contains AS MATERIALIZED (
    -- If the most recent input rows contain a full page, older rows cannot
    -- precede them at the contains-score floor. Otherwise use the full scan.
    SELECT r.id FROM recent_title_contains r WHERE
      (SELECT count(*) FROM recent_title_contains)>=(GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)
    UNION ALL
    SELECT z.id FROM (
      SELECT i.id FROM input i WHERE
        (SELECT count(*) FROM recent_title_contains)<(GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)
        AND EXISTS(SELECT 1 FROM search_private.knn_fields f WHERE f.item_id=i.id AND f.title_v2 AND f.folded LIKE ANY(patterns))
      ORDER BY i.created_at DESC,i.id DESC
      LIMIT (GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)
    ) z
  ), desc_contains AS MATERIALIZED (
    -- K admitted title-contains items each score at least 0.4, so a 0.25
    -- description-only floor cannot enter that page. Larger similarities
    -- remain protected by the title frontier and global description bound.
    SELECT i.id FROM input i WHERE
      (SELECT count(*) FROM title_contains)<(GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)
      AND EXISTS (
      SELECT 1 FROM search_private.knn_fields f WHERE f.item_id=i.id AND NOT f.title_v2 AND f.folded LIKE ANY(patterns)
    ) ORDER BY i.created_at DESC,i.id DESC
    LIMIT (GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)
  ), desc_exact AS MATERIALIZED (
    -- These are additional fully-scored seeds, never an admission shortcut.
    -- Exact folded matches lift the page floor for dense short descriptions.
    SELECT i.id FROM input i WHERE EXISTS (
      SELECT 1 FROM search_private.knn_fields f
      WHERE f.item_id=i.id AND NOT f.title_v2 AND f.token_count<=64
        AND octet_length(f.folded)<=512 AND f.folded=ANY(SELECT lower(t) FROM unnest(terms_in) t)
    ) ORDER BY i.created_at DESC,i.id DESC
    LIMIT (GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint)
  ), selected AS MATERIALIZED (
    SELECT item_id AS id FROM nearest UNION SELECT id FROM title_contains UNION SELECT id FROM desc_contains UNION SELECT id FROM desc_exact
  ), selected_scores AS MATERIALIZED (
    SELECT i.id,i.created_at,search_private.union_rank(f.fields,query_terms,patterns,threshold_hint,true,blank_matches,blank_contained,min_tokens,max_tokens,query_union_tokens) rank
    FROM selected s JOIN input i ON i.id=s.id JOIN search_private.item_fields f ON f.item_id=i.id
  ), page_floor AS MATERIALIZED (
    SELECT rank,created_at,id FROM selected_scores WHERE rank IS NOT NULL ORDER BY rank DESC,created_at DESC,id DESC
    OFFSET (GREATEST(1,LEAST(limit_in,100))::bigint+GREATEST(0,offset_in)::bigint-1) LIMIT 1
  ), desc_min AS MATERIALIZED (
    SELECT (SELECT f.token_count FROM search_private.knn_fields f
      WHERE NOT f.title_v2 AND f.token_count>0
        AND EXISTS (SELECT 1 FROM input i WHERE i.id=f.item_id OFFSET 0)
      ORDER BY f.token_count LIMIT 1) AS lo
  ), desc_range AS MATERIALIZED (
    SELECT lo,CASE WHEN lo<min_tokens THEN (
      SELECT f.token_count FROM search_private.knn_fields f
      WHERE NOT f.title_v2 AND f.token_count>0
        AND EXISTS (SELECT 1 FROM input i WHERE i.id=f.item_id OFFSET 0)
      ORDER BY f.token_count DESC LIMIT 1
    ) ELSE lo END AS hi FROM desc_min
  ), desc_bound AS MATERIALIZED (
    SELECT CASE WHEN lo IS NULL OR max_tokens=0 THEN 0::double precision
      WHEN lo>max_tokens THEN (max_tokens::real/lo::real)::double precision*0.6
      WHEN hi<min_tokens THEN (hi::real/min_tokens::real)::double precision*0.6
      ELSE 0.6::double precision END+0.000001 AS upper_score FROM desc_range
  ), desc_exception_target AS MATERIALIZED (
    SELECT t.*,least(2147483647::double precision,ceil(max_tokens::double precision*t.weight/greatest(t.cutoff-0.000001,0.000001)))::integer max_count
    FROM (SELECT coalesce((SELECT rank FROM page_floor),threshold_hint)::double precision cutoff,
      CASE WHEN (SELECT rank FROM page_floor) IS NULL THEN 1::double precision ELSE 0.6::double precision END weight,
      (SELECT rank FROM page_floor) rank_floor,(SELECT created_at FROM page_floor) created_floor,(SELECT id FROM page_floor) id_floor) t
  ), desc_exception_fields AS MATERIALIZED (
    -- A safe union-of-trigrams upper bound eliminates unrelated short fields.
    -- Equal-score fields only matter if their item is ahead of the kth seed
    -- on the unchanged (created_at DESC NULLS FIRST, id DESC) tie break.
    SELECT f.item_id FROM desc_exception_target t CROSS JOIN LATERAL (
    SELECT f.item_id FROM search_private.knn_fields f
    CROSS JOIN LATERAL (SELECT least(cardinality(f.tokens OPERATOR(search_private.&) query_union_tokens),max_tokens) n) overlap
    CROSS JOIN LATERAL (SELECT CASE WHEN overlap.n=0 THEN 0::real ELSE overlap.n::real/(f.token_count+greatest(min_tokens,overlap.n)-overlap.n)::real END raw_upper) b
    WHERE t.cutoff>=0.01 AND NOT f.title_v2 AND f.token_count>0 AND f.token_count<=t.max_count
      AND EXISTS (SELECT 1 FROM input i WHERE i.id=f.item_id AND
        (CASE WHEN t.rank_floor IS NULL THEN b.raw_upper::double precision+0.000001>=t.cutoff ELSE
          (b.raw_upper::double precision*0.6)::real>t.rank_floor OR
          ((b.raw_upper::double precision*0.6)::real=t.rank_floor AND
            ((i.created_at IS NULL AND t.created_floor IS NOT NULL) OR i.created_at>t.created_floor OR
              (i.created_at IS NOT DISTINCT FROM t.created_floor AND i.id>t.id_floor)))
        END) OFFSET 0)
    ORDER BY f.token_count LIMIT 1001
    ) f
  ), desc_exceptions AS MATERIALIZED (
    SELECT DISTINCT item_id FROM desc_exception_fields
  ), unscored_exceptions AS MATERIALIZED (
    SELECT e.item_id FROM desc_exceptions e WHERE NOT EXISTS(SELECT 1 FROM selected s WHERE s.id=e.item_id)
  ), extra_scores AS MATERIALIZED (
    SELECT i.id,i.created_at,search_private.union_rank(f.fields,query_terms,patterns,threshold_hint,true,blank_matches,blank_contained,min_tokens,max_tokens,query_union_tokens) rank
    FROM unscored_exceptions e
    CROSS JOIN LATERAL(SELECT i.id,i.created_at FROM input i WHERE i.id=e.item_id LIMIT 1) i
    CROSS JOIN LATERAL(SELECT f.fields FROM search_private.item_fields f WHERE f.item_id=e.item_id LIMIT 1) f
    WHERE (SELECT count(*) FROM desc_exception_fields)<=1000 AND EXISTS(SELECT 1 FROM unscored_exceptions)
  ), title_bounds AS MATERIALIZED (
    SELECT coalesce(bool_and(count_rows<40 OR
      (complete_boundary AND last_distance>=(1::real-(SELECT rank FROM page_floor))) OR
      (1-last_distance::double precision+0.000001<(SELECT rank FROM page_floor))),true) AS covered,
      min(last_distance) AS boundary_distance,coalesce(max(CASE WHEN count_rows<40 THEN 0 ELSE 1-last_distance::double precision+0.000001 END),0) AS unseen_upper,
           coalesce(max(1-first_distance::double precision+0.000001),0) AS global_upper
    FROM(SELECT ord,bool_and(complete_boundary) complete_boundary,count(*) count_rows,max(distance) last_distance,min(distance) first_distance FROM nearest GROUP BY ord) n
  ), certified AS MATERIALIZED (
    SELECT (SELECT cutoff FROM desc_exception_target)>=0.01 AND (SELECT count(*) FROM desc_exception_fields)<=1000
      AND ((coalesce((SELECT rank FROM page_floor) IS NOT NULL AND t.covered,false))
        OR ((SELECT rank FROM page_floor) IS NULL AND t.unseen_upper<threshold_hint)) AS ok
    FROM title_bounds t
  ), scores AS MATERIALIZED (
    SELECT * FROM selected_scores WHERE (SELECT ok FROM certified)
    UNION ALL SELECT * FROM extra_scores WHERE (SELECT ok FROM certified)
    UNION ALL
    SELECT i.id,i.created_at,search_private.union_rank(f.fields,query_terms,patterns,threshold_hint,true,blank_matches,blank_contained,min_tokens,max_tokens,query_union_tokens) rank
    FROM input i JOIN search_private.item_fields f ON f.item_id=i.id WHERE NOT (SELECT ok FROM certified)
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

NOTIFY pgrst, 'reload schema';
