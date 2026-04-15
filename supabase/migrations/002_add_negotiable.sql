-- Add negotiable column to items table
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS negotiable BOOLEAN NOT NULL DEFAULT false;
