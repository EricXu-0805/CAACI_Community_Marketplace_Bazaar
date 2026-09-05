-- Additive category details. Existing NULL rows stay NULL; no inferred backfill.
-- Current/legacy search RPCs remain callable during rollout.
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS listing_details jsonb;

CREATE OR REPLACE FUNCTION private.valid_listing_details(category text, d jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE date_from date; date_to date; wall timestamp; instant timestamptz;
BEGIN
  IF d IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(d) <> 'object' OR octet_length(d::text) > 2048
     OR d->>'kind' IS DISTINCT FROM category THEN RETURN false; END IF;
  IF category = 'housing' THEN
    IF NOT d ?& ARRAY['kind','available_from','available_to','price_unit','room_type']
      OR d - ARRAY['kind','available_from','available_to','price_unit','room_type'] <> '{}'::jsonb
      OR jsonb_typeof(d->'available_from') <> 'string' OR jsonb_typeof(d->'available_to') <> 'string'
      OR d->>'available_from' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      OR d->>'available_to' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      OR d->>'price_unit' NOT IN ('month','week','total')
      OR d->>'room_type' NOT IN ('private','shared','entire') THEN RETURN false; END IF;
    date_from := (d->>'available_from')::date; date_to := (d->>'available_to')::date;
    RETURN date_to >= date_from AND jsonb_typeof(d->'price_unit') = 'string' AND jsonb_typeof(d->'room_type') = 'string';
  ELSIF category = 'rideshare' THEN
    IF NOT d ?& ARRAY['kind','origin','destination','departure_date','departure_time','seats','price_unit','time_zone']
      OR d - ARRAY['kind','origin','destination','departure_date','departure_time','seats','price_unit','time_zone'] <> '{}'::jsonb
      OR jsonb_typeof(d->'origin') <> 'string' OR jsonb_typeof(d->'destination') <> 'string'
      OR length(btrim(d->>'origin')) NOT BETWEEN 2 AND 80 OR length(btrim(d->>'destination')) NOT BETWEEN 2 AND 80
      OR d->>'origin' ~ '[[:cntrl:]]' OR d->>'destination' ~ '[[:cntrl:]]'
      OR lower(btrim(d->>'origin')) = lower(btrim(d->>'destination'))
      OR jsonb_typeof(d->'departure_date') <> 'string' OR jsonb_typeof(d->'departure_time') <> 'string'
      OR d->>'departure_date' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      OR d->>'departure_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      OR jsonb_typeof(d->'seats') <> 'number' OR d->>'seats' !~ '^[1-8]$'
      OR d->>'price_unit' IS DISTINCT FROM 'person' OR d->>'time_zone' IS DISTINCT FROM 'America/Chicago' THEN RETURN false; END IF;
    date_from := (d->>'departure_date')::date;
    wall := ((d->>'departure_date') || ' ' || (d->>'departure_time'))::timestamp;
    instant := wall AT TIME ZONE 'America/Chicago';
    RETURN (instant AT TIME ZONE 'America/Chicago') = wall; -- Reject the DST spring gap.
  END IF;
  RETURN false;
EXCEPTION WHEN data_exception THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION private.valid_listing_details(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.guard_listing_details()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT coalesce(private.valid_listing_details(NEW.category::text,NEW.listing_details),false) THEN
    RAISE EXCEPTION 'invalid_listing_details' USING ERRCODE='23514';
  END IF;
  IF NEW.listing_details->>'kind' = 'rideshare' THEN
    PERFORM private.assert_text_boundary(NEW.listing_details->>'origin','item_route_origin',2,80,320,false);
    PERFORM private.assert_text_boundary(NEW.listing_details->>'destination','item_route_destination',2,80,320,false);
    PERFORM private.assert_moderated_text(NEW.listing_details->>'origin','item_route_origin');
    PERFORM private.assert_moderated_text(NEW.listing_details->>'destination','item_route_destination');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_listing_details() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS guard_listing_details ON public.items;
CREATE TRIGGER guard_listing_details BEFORE INSERT OR UPDATE OF category,listing_details ON public.items
FOR EACH ROW EXECUTE FUNCTION private.guard_listing_details();
GRANT SELECT(listing_details) ON public.items TO anon,authenticated;
GRANT INSERT(listing_details),UPDATE(listing_details) ON public.items TO authenticated;
CREATE INDEX IF NOT EXISTS items_housing_dates_idx ON public.items
((listing_details->>'available_from'),(listing_details->>'available_to')) WHERE category='housing' AND status='active';
CREATE INDEX IF NOT EXISTS items_rideshare_date_idx ON public.items
((listing_details->>'departure_date')) WHERE category='rideshare' AND status='active';

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
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, extensions
AS $function$
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
      SELECT COALESCE(pg_catalog.max(GREATEST(
        similarity(title_text, search_term),
        similarity(description_text, search_term) * 0.6,
        CASE WHEN title_text ILIKE '%' || search_term || '%' THEN 0.4 ELSE 0 END,
        CASE
          WHEN description_text ILIKE '%' || search_term || '%'
            THEN 0.25
          ELSE 0
        END
      )), 0)::real
      FROM pg_catalog.unnest(terms_in) AS search_term
      CROSS JOIN pg_catalog.unnest(ARRAY[
        i.title,
        COALESCE(i.title_i18n->>'zh', ''),
        COALESCE(i.title_i18n->>'en', ''),
        COALESCE(i.listing_details->>'origin', ''),
        COALESCE(i.listing_details->>'destination', '')
      ]) AS title_text
      CROSS JOIN pg_catalog.unnest(ARRAY[
        COALESCE(i.description, ''),
        COALESCE(i.description_i18n->>'zh', ''),
        COALESCE(i.description_i18n->>'en', '')
      ]) AS description_text
    ) AS rank
  FROM public.items AS i
  LEFT JOIN public.profiles AS p ON p.id = i.user_id
  WHERE i.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(terms_in) AS search_term
      CROSS JOIN pg_catalog.unnest(ARRAY[
        i.title,
        COALESCE(i.title_i18n->>'zh', ''),
        COALESCE(i.title_i18n->>'en', ''),
        COALESCE(i.listing_details->>'origin', ''),
        COALESCE(i.listing_details->>'destination', '')
      ]) AS title_text
      CROSS JOIN pg_catalog.unnest(ARRAY[
        COALESCE(i.description, ''),
        COALESCE(i.description_i18n->>'zh', ''),
        COALESCE(i.description_i18n->>'en', '')
      ]) AS description_text
      WHERE title_text % search_term
         OR description_text % search_term
         OR title_text ILIKE '%' || search_term || '%'
         OR description_text ILIKE '%' || search_term || '%'
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
  OFFSET GREATEST(0, offset_in)
$function$;

REVOKE ALL ON FUNCTION public.search_items_fuzzy_v2(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_items_fuzzy_v2(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
