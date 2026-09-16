-- hidden_items is private feedback, not a new public item-to-profile join.
-- A composite FK primary key makes PostgREST infer a second many-to-many
-- relationship and breaks existing profile:profiles(...) embeds (PGRST201).
-- Preserve pair uniqueness/lookup, use a surrogate PK for relationship discovery.
-- Apply atomically with discovery_preferences in production so old clients work.
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.hidden_items ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
DO $guard$
DECLARE keys text[];
BEGIN
 SELECT array_agg(a.attname::text ORDER BY k.ordinality) INTO keys
 FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
 JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
 WHERE c.conrelid='public.hidden_items'::regclass AND c.contype='p';
 IF keys=ARRAY['user_id','item_id']::text[] THEN
   ALTER TABLE public.hidden_items DROP CONSTRAINT hidden_items_pkey;
   ALTER TABLE public.hidden_items ADD CONSTRAINT hidden_items_user_item_key UNIQUE(user_id,item_id);
   ALTER TABLE public.hidden_items ADD CONSTRAINT hidden_items_pkey PRIMARY KEY(id);
 ELSIF keys IS DISTINCT FROM ARRAY['id']::text[] THEN
   RAISE EXCEPTION 'hidden_items_primary_key_drift';
 END IF;
END $guard$;
-- Existing authenticated column-level INSERT rights do not include id.
NOTIFY pgrst, 'reload schema';
