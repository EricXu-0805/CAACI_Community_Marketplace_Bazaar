-- Add 'rideshare' (拼车) to the item_category enum so users can post
-- rideshare offers via the existing publish flow. Apply MANUALLY on
-- dev + prod (no `supabase db push` from CI in this batch). Without
-- this ALTER, a publish where category=rideshare 500s with
-- "invalid input value for enum item_category" (Postgres SQLSTATE 22P02).
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'rideshare';
