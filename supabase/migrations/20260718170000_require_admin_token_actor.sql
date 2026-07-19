-- Require every administrator token to resolve to a real profile.
--
-- Safety for existing installations:
--   Older mint instructions allowed admin_id = NULL. The current API rejects
--   those rows, but silently guessing an actor from mutable name/email fields
--   would corrupt the audit trail. This migration therefore stops before any
--   schema change when unattributed rows remain. Inventory and revoke them,
--   independently verify each operator's public.profiles.id, mint attributed
--   replacements, retain any required forensic metadata in the approved case
--   record, and deliberately remove the obsolete NULL rows before retrying.

BEGIN;

-- Keep the NULL preflight and constraint changes in one DML-free window.
LOCK TABLE public.admin_tokens IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  unattributed_count bigint;
BEGIN
  SELECT count(*)
    INTO unattributed_count
    FROM public.admin_tokens
   WHERE admin_id IS NULL;

  IF unattributed_count > 0 THEN
    RAISE EXCEPTION
      'Cannot require admin_tokens.admin_id: % unattributed token row(s) remain',
      unattributed_count
      USING ERRCODE = '23502',
            HINT = 'Do not infer an actor from admin_name/admin_email. Revoke and replace each token with a verified profiles.id, retain required evidence, remove the obsolete NULL rows, then retry.';
  END IF;
END;
$$;

-- Migration 036 already creates this relationship. Reuse and validate any
-- equivalent ON DELETE CASCADE FK; add the named v2 constraint only for a
-- drifted installation where that relationship is missing.
DO $$
DECLARE
  actor_fk_name name;
BEGIN
  SELECT constraint_row.conname
    INTO actor_fk_name
    FROM pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public.admin_tokens'::regclass
     AND constraint_row.contype = 'f'
     AND constraint_row.confrelid = 'public.profiles'::regclass
     AND constraint_row.confdeltype = 'c'
     AND constraint_row.conkey = ARRAY[
       (SELECT column_row.attnum
          FROM pg_attribute AS column_row
         WHERE column_row.attrelid = 'public.admin_tokens'::regclass
           AND column_row.attname = 'admin_id'
           AND NOT column_row.attisdropped)
     ]
     AND constraint_row.confkey = ARRAY[
       (SELECT column_row.attnum
          FROM pg_attribute AS column_row
         WHERE column_row.attrelid = 'public.profiles'::regclass
           AND column_row.attname = 'id'
           AND NOT column_row.attisdropped)
     ]
   ORDER BY (constraint_row.conname = 'admin_tokens_admin_id_fkey') DESC
   LIMIT 1;

  IF actor_fk_name IS NULL THEN
    ALTER TABLE public.admin_tokens
      ADD CONSTRAINT admin_tokens_admin_id_profiles_fkey_v2
      FOREIGN KEY (admin_id)
      REFERENCES public.profiles(id)
      ON DELETE CASCADE
      NOT VALID;
    actor_fk_name := 'admin_tokens_admin_id_profiles_fkey_v2';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.admin_tokens VALIDATE CONSTRAINT %I',
    actor_fk_name
  );
END;
$$;

-- A validated CHECK lets PostgreSQL prove the subsequent SET NOT NULL without
-- silently rewriting data. Drop the temporary proof after the catalog flag is
-- installed.
ALTER TABLE public.admin_tokens
  ADD CONSTRAINT admin_tokens_admin_id_required_check
  CHECK (admin_id IS NOT NULL)
  NOT VALID;

ALTER TABLE public.admin_tokens
  VALIDATE CONSTRAINT admin_tokens_admin_id_required_check;

ALTER TABLE public.admin_tokens
  ALTER COLUMN admin_id SET NOT NULL;

ALTER TABLE public.admin_tokens
  DROP CONSTRAINT admin_tokens_admin_id_required_check;

COMMENT ON COLUMN public.admin_tokens.admin_id IS
  'Required verified profiles.id for authentication and administrator audit attribution.';

NOTIFY pgrst, 'reload schema';

COMMIT;
