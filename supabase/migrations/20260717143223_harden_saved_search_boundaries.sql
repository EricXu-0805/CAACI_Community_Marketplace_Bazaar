-- Harden saved-search price bounds and make keyword matching literal.
--
-- NOT VALID makes each constraint start enforcing new writes immediately,
-- while the explicit VALIDATE step scans existing rows and fails the migration
-- if historical negative values need remediation. No data is silently changed.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.saved_searches'::pg_catalog.regclass
      AND conname = 'saved_searches_price_min_nonnegative'
  ) THEN
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_price_min_nonnegative
      CHECK (price_min IS NULL OR price_min >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.saved_searches'::pg_catalog.regclass
      AND conname = 'saved_searches_price_max_nonnegative'
  ) THEN
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_price_max_nonnegative
      CHECK (price_max IS NULL OR price_max >= 0) NOT VALID;
  END IF;
END
$migration$;

-- Constraint names are not proof of constraint semantics.  Refuse to continue
-- if a prior/manual object reused either name with a weaker expression.  This
-- makes replay idempotent without silently trusting a same-name impostor.
DO $constraint_gate$
DECLARE
  min_type "char";
  max_type "char";
  min_expression text;
  max_expression text;
BEGIN
  SELECT
    constraint_row.contype,
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.lower(
          pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
        ),
        '::numeric',
        ''
      ),
      '[[:space:]()]',
      '',
      'g'
  )
  INTO min_type, min_expression
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.saved_searches'::pg_catalog.regclass
    AND constraint_row.conname = 'saved_searches_price_min_nonnegative';

  SELECT
    constraint_row.contype,
    pg_catalog.regexp_replace(
      pg_catalog.replace(
        pg_catalog.lower(
          pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid)
        ),
        '::numeric',
        ''
      ),
      '[[:space:]()]',
      '',
      'g'
  )
  INTO max_type, max_expression
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.saved_searches'::pg_catalog.regclass
    AND constraint_row.conname = 'saved_searches_price_max_nonnegative';

  IF min_type IS DISTINCT FROM 'c'
     OR min_expression IS DISTINCT FROM 'price_minisnullorprice_min>=0' THEN
    RAISE EXCEPTION 'migration_blocked: saved_searches_price_min_nonnegative has unexpected semantics';
  END IF;

  IF max_type IS DISTINCT FROM 'c'
     OR max_expression IS DISTINCT FROM 'price_maxisnullorprice_max>=0' THEN
    RAISE EXCEPTION 'migration_blocked: saved_searches_price_max_nonnegative has unexpected semantics';
  END IF;
END
$constraint_gate$;

ALTER TABLE public.saved_searches
  VALIDATE CONSTRAINT saved_searches_price_min_nonnegative;

ALTER TABLE public.saved_searches
  VALIDATE CONSTRAINT saved_searches_price_max_nonnegative;

-- Preserve migration 066's listing-type discriminator, migration 037's
-- per-subscriber dedupe / 24-hour throttle, and the unique notification
-- conflict guard. strpos() treats %, _ and every other character literally;
-- the previous LIKE expression interpreted user input as SQL wildcards.
CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  norm_haystack text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  norm_haystack := pg_catalog.lower(
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, '')
  );

  WITH matching AS (
    SELECT ss.id AS ss_id, ss.user_id AS subscriber
    FROM public.saved_searches AS ss
    WHERE ss.user_id <> NEW.user_id
      AND (
        ss.last_notified_at IS NULL
        OR ss.last_notified_at < pg_catalog.now() - INTERVAL '24 hours'
      )
      AND pg_catalog.strpos(norm_haystack, pg_catalog.lower(ss.keyword)) > 0
      AND (ss.category IS NULL OR ss.category = NEW.category)
      AND (ss.price_min IS NULL OR NEW.price >= ss.price_min)
      AND (ss.price_max IS NULL OR NEW.price <= ss.price_max)
      AND (ss.listing_type = 'both' OR ss.listing_type = NEW.listing_type)
  ),
  unique_subs AS (
    SELECT DISTINCT subscriber
    FROM matching
  ),
  inserted AS (
    INSERT INTO public.notifications (user_id, type, title, body, item_id)
    SELECT subscriber, 'system', NEW.title, 'saved_search_match', NEW.id
    FROM unique_subs
    ON CONFLICT (user_id, item_id)
      WHERE type = 'system'
        AND body = 'saved_search_match'
        AND item_id IS NOT NULL
      DO NOTHING
    RETURNING user_id
  )
  UPDATE public.saved_searches
  SET last_notified_at = pg_catalog.now()
  WHERE id IN (SELECT ss_id FROM matching);

  RETURN NEW;
END;
$$;

-- Trigger functions are internal implementation details, not client RPCs.
REVOKE EXECUTE ON FUNCTION public.notify_saved_search_matches()
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
