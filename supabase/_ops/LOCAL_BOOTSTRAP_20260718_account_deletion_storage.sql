-- Supplemental Storage fixture for isolated PostgreSQL migration/regression
-- testing. Supabase owns the real storage schema; NEVER run this file against
-- a hosted project.

CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('item-images', 'item-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

CREATE TABLE IF NOT EXISTS public.wechat_password_map (
  openid text PRIMARY KEY,
  password text NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON public.wechat_password_map TO service_role;

-- Mirror the app's existing items/<uid>/<filename> permissive upload policy.
-- The account-deletion migration adds a RESTRICTIVE policy on top of this.
DO $local_storage_policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::pg_catalog.regclass
      AND polname = 'local_authenticated_item_image_insert'
  ) THEN
    CREATE POLICY local_authenticated_item_image_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'item-images'
        AND split_part(name, '/', 1) = 'items'
        AND split_part(name, '/', 2) = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::pg_catalog.regclass
      AND polname = 'local_authenticated_item_image_select'
  ) THEN
    CREATE POLICY local_authenticated_item_image_select
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'item-images'
        AND split_part(name, '/', 1) = 'items'
        AND split_part(name, '/', 2) = auth.uid()::text
      );
  END IF;

  -- A permissive UPDATE fixture makes the new restrictive UPDATE boundary
  -- testable even though the current app does not expose image replacement.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'storage.objects'::pg_catalog.regclass
      AND polname = 'local_authenticated_item_image_update'
  ) THEN
    CREATE POLICY local_authenticated_item_image_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'item-images'
        AND split_part(name, '/', 1) = 'items'
        AND split_part(name, '/', 2) = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'item-images'
        AND split_part(name, '/', 1) = 'items'
        AND split_part(name, '/', 2) = auth.uid()::text
      );
  END IF;
END
$local_storage_policies$;
