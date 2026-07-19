-- Isolated/local behavioral regression. Run inside a transaction against a
-- disposable database after all migrations; it rolls back every fixture.

BEGIN;

-- Deleted items are hidden by the production SELECT policy, and PostgreSQL
-- requires row visibility before UPDATE. Disable RLS inside this rollback-only
-- transaction so the test reaches the trigger rather than succeeding with a
-- zero-row UPDATE; column grants and current_user still remain representative.
ALTER TABLE public.items DISABLE ROW LEVEL SECURITY;

-- The integrated write-boundary migration intentionally grants authenticated
-- callers only UPDATE(content_i18n) on public.posts. Exercise the posts branch
-- of guard_moderation_status() on a rollback-only temp table named `posts`
-- instead of weakening the real table's column grants just for this test.
CREATE TEMP TABLE posts (
  id uuid PRIMARY KEY,
  content text NOT NULL,
  content_i18n jsonb,
  status text NOT NULL
) ON COMMIT DROP;

CREATE TRIGGER guard_moderation_status_regression
  BEFORE UPDATE ON posts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_moderation_status();

GRANT SELECT, UPDATE ON posts TO authenticated;

DO $$
DECLARE
  owner_id uuid := gen_random_uuid();
  item_id uuid := gen_random_uuid();
  post_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES (owner_id, 'enum-guard-regression@example.test');

  -- The production auth trigger creates the matching profile row.
  UPDATE public.profiles
  SET nickname = 'Enum Guard Regression'
  WHERE id = owner_id;

  INSERT INTO public.items (
    id, user_id, title, description, price, category, condition, status
  ) VALUES (
    item_id, owner_id, 'enum guard item', 'fixture', 1,
    'other', 'good', 'active'
  );

  INSERT INTO public.posts (id, user_id, content, status)
  VALUES (post_id, owner_id, 'enum guard post', 'active');

  INSERT INTO pg_temp.posts (id, content, status) VALUES
    ('94000000-0000-0000-0000-000000000001', 'temp active post', 'active'),
    ('94000000-0000-0000-0000-000000000002', 'temp hidden post', 'hidden');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  -- The production failure was here: any ordinary item update tried to cast
  -- posts-only `hidden` into item_status. Both legal lifecycle updates must pass.
  UPDATE public.items SET status = 'reserved' WHERE id = item_id;
  UPDATE public.items SET status = 'active' WHERE id = item_id;

  -- Ordinary public-post updates must use the exact column grant established by
  -- the integrated write boundary. The temp-table update separately exercises
  -- the trigger's posts branch as the real authenticated current_user.
  UPDATE public.posts
  SET content_i18n = '{"en":"enum guard post edited"}'::jsonb
  WHERE id = post_id;
  UPDATE pg_temp.posts
  SET content = 'temp active post edited'
  WHERE id = '94000000-0000-0000-0000-000000000001';

  RESET ROLE;

  -- Simulate moderator takedowns as the migration owner.
  UPDATE public.items SET status = 'deleted' WHERE id = item_id;
  UPDATE public.posts SET status = 'hidden' WHERE id = post_id;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  BEGIN
    UPDATE public.items SET status = 'active' WHERE id = item_id;
    RAISE EXCEPTION 'expected removed item restore to fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected removed item restore to fail' THEN RAISE; END IF;
      IF position('moderator-managed' in SQLERRM) = 0 THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE pg_temp.posts
    SET status = 'active'
    WHERE id = '94000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'expected hidden post restore to fail';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'expected hidden post restore to fail' THEN RAISE; END IF;
      IF position('moderator-managed' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
