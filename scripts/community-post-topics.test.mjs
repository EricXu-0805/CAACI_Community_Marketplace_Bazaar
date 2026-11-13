import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const migration = read('20261112120000_community_post_topics.sql')
const boundary = read('20260718230000_authoritative_public_write_resource_boundaries.sql')
const functionSql = (source, name, delimiter = '$function$') => {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert.ok(start >= 0)
  const first = source.indexOf(delimiter, start)
  return source.slice(start, source.indexOf(`${delimiter};`, first + delimiter.length) + delimiter.length + 1)
}
const UID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const POST = '33333333-3333-4333-8333-333333333333'

test('topic migration preserves legacy rows, RLS, metadata ACL and item ownership/cap', { skip: !bin && 'local PostgreSQL unavailable' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-topics-'))
  const data = join(dir, 'data'), port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const sql = input => run('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], input).trim()
  const as = (input, role = 'authenticated', uid = UID) => sql(`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claim.sub = '${uid}'; ${input}; COMMIT;`)
  let started = false
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--no-locale'])
    run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'])
    started = true
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA extensions;
      CREATE EXTENSION pg_trgm WITH SCHEMA extensions;
      GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY, nickname text, email text, avatar_url text, location text,
        is_illini_verified boolean, status_text text, status_emoji text, suspension_level int DEFAULT 0);
      CREATE FUNCTION public.get_my_profile() RETURNS SETOF profiles LANGUAGE sql STABLE AS $$ SELECT * FROM profiles WHERE id=auth.uid() $$;
      CREATE TABLE posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES profiles,
        content text, images text[] DEFAULT '{}', image_dimensions jsonb, content_i18n jsonb, source_lang text,
        is_official boolean DEFAULT false, is_pinned boolean DEFAULT false, like_count int DEFAULT 0,
        comment_count int DEFAULT 0, status text DEFAULT 'active', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY post_read ON posts FOR SELECT TO anon,authenticated USING(status='active');
      CREATE POLICY post_insert ON posts FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND NOT is_official);
      GRANT SELECT(id,user_id,content,images,image_dimensions,content_i18n,source_lang,is_official,is_pinned,like_count,comment_count,status,created_at,updated_at) ON posts TO anon,authenticated;
      GRANT INSERT(user_id,content,images) ON posts TO authenticated;
      GRANT SELECT ON profiles TO anon,authenticated;
      CREATE TYPE item_status AS ENUM('active','reserved','sold','deleted');
      CREATE TABLE items(id uuid PRIMARY KEY, user_id uuid, status item_status DEFAULT 'active', title text, images text[]);
      CREATE TABLE messages(id uuid, sender_id uuid, content text);
      CREATE TABLE post_comments(id uuid, user_id uuid, content text);
      CREATE TABLE reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, target_type text, target_id uuid,
        reason text, note text, status text DEFAULT 'pending', created_at timestamptz DEFAULT now(), target_snapshot jsonb);
      ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
      CREATE POLICY report_insert ON reports FOR INSERT TO authenticated WITH CHECK(reporter_id=auth.uid());
      GRANT INSERT(reporter_id,target_type,target_id,reason,note) ON reports TO authenticated;
      GRANT SELECT ON reports TO service_role;
      CREATE TABLE post_items(post_id uuid REFERENCES posts, item_id uuid REFERENCES items, display_order int, PRIMARY KEY(post_id,item_id));
      ALTER TABLE post_items ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON items,post_items TO authenticated;
      GRANT INSERT ON post_items TO authenticated;
      INSERT INTO profiles(id,nickname) VALUES('${UID}','Test author'),('${OTHER}','Another person');
      INSERT INTO posts(id,user_id,content) VALUES('${POST}','${UID}','Legacy campus update');
      CREATE FUNCTION public.content_moderation_check(text) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN $1 LIKE '%blocked fixture%' THEN 'sensitive_word' END $$;`)
    // Use the real shared boundary helpers and latest existing cap/policy, not replicas.
    sql(functionSql(boundary, 'private.assert_text_boundary'))
    sql(functionSql(boundary, 'private.assert_moderated_text'))
    const cap = read('20260722033904_reconcile_legacy_migration_versions.sql')
    sql(functionSql(cap, 'public.enforce_post_items_cap', '$function$'))
    sql('CREATE TRIGGER cap BEFORE INSERT ON post_items FOR EACH ROW EXECUTE FUNCTION public.enforce_post_items_cap()')
    const acl = read('20260719151729_reconcile_plaza_base_table_acl.sql')
    const start = acl.indexOf('CREATE POLICY "Post owner can attach own items"')
    sql(acl.slice(start, acl.indexOf(';', start) + 1))
    // Install the real report capture and immutability triggers before the increment.
    const evidence = read('20260717194334_preserve_conversation_and_report_evidence.sql')
    sql(functionSql(evidence, 'public.capture_report_target_snapshot'))
    sql(functionSql(evidence, 'public.guard_report_target_snapshot_immutable'))
    sql(`CREATE TRIGGER trg_capture_report_target_snapshot BEFORE INSERT ON reports FOR EACH ROW EXECUTE FUNCTION public.capture_report_target_snapshot();
      CREATE TRIGGER immutable_evidence BEFORE UPDATE OF reporter_id,target_type,target_id,target_snapshot ON reports FOR EACH ROW EXECUTE FUNCTION public.guard_report_target_snapshot_immutable();`)
    as(`INSERT INTO reports(reporter_id,target_type,target_id,reason) VALUES(auth.uid(),'post','${POST}','other')`, 'authenticated', OTHER)
    const oldReportId = sql(`SELECT id FROM reports WHERE target_id='${POST}'`)
    // The old installed-client RPC must remain callable and unchanged.
    const oldSearch = read('062_search_posts_fuzzy.sql')
    sql(oldSearch.slice(oldSearch.indexOf('create or replace function')))
    const oldRpc = sql("SELECT pg_get_functiondef('public.search_posts_fuzzy(text[],text,integer,integer)'::regprocedure)")
    // The real posts_visible the migration rebuilds; only its visibility helper is stubbed.
    sql(`CREATE SCHEMA moderation_private;
      CREATE FUNCTION moderation_private.profile_content_visible(uuid) RETURNS boolean LANGUAGE sql STABLE
        AS $$ SELECT coalesce((SELECT suspension_level < 2 FROM public.profiles WHERE id = $1), true) $$;
      GRANT USAGE ON SCHEMA moderation_private TO anon, authenticated;`)
    const visibility = read('20260718160000_reconcile_expired_suspension_visibility.sql')
    const viewStart = visibility.indexOf('CREATE OR REPLACE VIEW public.posts_visible')
    assert.ok(viewStart >= 0)
    sql(visibility.slice(viewStart, visibility.indexOf(';', viewStart) + 1))
    sql('GRANT SELECT ON public.posts_visible TO anon, authenticated, service_role')
    const viewColumns = () => sql("SELECT string_agg(attname, ',' ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.posts_visible'::regclass AND attnum > 0")
    const legacyViewColumns = viewColumns()
    const postAcl = () => sql(`SELECT grantee || ':' || privilege_type || ':' || column_name
      FROM information_schema.column_privileges WHERE table_schema='public' AND table_name='posts'
      AND grantee IN ('authenticated','anon') ORDER BY 1`).split('\n')
    const legacyAcl = postAcl()
    sql(migration)
    assert.equal(sql("SELECT pg_get_functiondef('public.search_posts_fuzzy(text[],text,integer,integer)'::regprocedure)"), oldRpc)
    assert.equal(as(`SELECT title IS NULL AND category IS NULL FROM posts WHERE id='${POST}'`), 't')
    as("INSERT INTO posts(user_id,content) VALUES(auth.uid(),'New legacy update')")
    const insert = (title, category = "'campus-life'", user = 'auth.uid()') => as(`INSERT INTO posts(user_id,content,title,category) VALUES(${user},'Ordinary body',${title},${category})`)
    insert("'Quantum study group'")
    insert("'Quantum alumni meetup'", "'alumni-career'")
    insert(`repeat('界',120)`)
    assert.throws(() => insert(`repeat('a',121)`), /post_title_size/)
    assert.throws(() => insert("'   '"), /post_title_size/)
    assert.throws(() => insert("E'line\\nbreak'"), /posts_topic_metadata_check/)
    assert.throws(() => insert("' bad trim '"), /posts_topic_metadata_check/)
    assert.throws(() => insert("'Title'", 'NULL'), /posts_topic_metadata_check/)
    assert.throws(() => insert('NULL'), /posts_topic_metadata_check/)
    assert.throws(() => insert("'Title'", "'furniture'"), /posts_topic_metadata_check/)
    assert.throws(() => insert("'blocked fixture'"), /moderation_block:post_title:sensitive_word/)
    assert.throws(() => insert("'Title'", "'campus-life'", `'${OTHER}'`), /row-level security/)
    assert.throws(() => as("INSERT INTO posts(user_id,content,title,category) VALUES(auth.uid(),'Body','Title','campus-life')", 'anon'), /permission denied/)
    assert.throws(() => as(`UPDATE posts SET title='Edited' WHERE id='${POST}'`), /permission denied/)
    assert.throws(() => as("INSERT INTO posts(user_id,content,is_official) VALUES(auth.uid(),'Body',true)"), /permission denied/)
    sql(`INSERT INTO posts(user_id,content,title,category,status) VALUES('${UID}','Body','Quantum hidden','campus-life','hidden')`)
    assert.equal(as("SELECT count(*) FROM search_community_posts(ARRAY['Quantum'],'recent',20,0,'campus-life')", 'anon'), '1')
    assert.equal(as("SELECT count(*) FROM search_community_posts(ARRAY['Quantum'],'recent',20,0,NULL)", 'anon'), '2')
    assert.equal(as("SELECT count(*) FROM search_community_posts(ARRAY['Quantum'],'recent',20,1,NULL)", 'anon'), '1')
    assert.equal(as("SELECT count(*) FROM search_community_posts(ARRAY['Legacy'],'recent',20,0,NULL)", 'anon'), '2')
    assert.equal(as("SELECT count(*) FROM search_posts_fuzzy(ARRAY['Legacy'])", 'anon'), '2')
    // ENGINEERING §6: installed old clients keep the old RPC, which matches bodies, not titles.
    assert.equal(as("SELECT count(*) FROM search_posts_fuzzy(ARRAY['Quantum'])", 'anon'), '0')
    assert.equal(sql("SELECT prosecdef FROM pg_proc WHERE oid='public.search_community_posts(text[],text,integer,integer,text,text)'::regprocedure"), 'f')
    // REGION.1: one region for now, readable by everyone, never written by clients.
    assert.equal(as("SELECT count(*) FROM search_community_posts(ARRAY['Quantum'],'recent',20,0,NULL,'cu')", 'anon'), '2')
    assert.equal(as("SELECT count(*) FROM search_community_posts(ARRAY['Quantum'],'recent',20,0,NULL,'chi')", 'anon'), '0')
    assert.equal(as("SELECT count(*) FROM posts WHERE region <> 'cu'", 'anon'), '0')
    assert.equal(sql("SELECT column_default || '|' || is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='posts' AND column_name='region'"), "'cu'::text|NO")
    assert.throws(() => sql(`INSERT INTO posts(user_id,content,region) VALUES('${UID}','Body','chi')`), /posts_region_check/)
    assert.throws(() => as("INSERT INTO posts(user_id,content,region) VALUES(auth.uid(),'Body','cu')"), /permission denied/)
    assert.throws(() => as(`UPDATE posts SET region='cu' WHERE user_id=auth.uid()`), /permission denied/)
    assert.equal(sql("SELECT has_function_privilege('authenticated','private.validate_post_topic()','execute')"), 'f')
    // ENGINEERING §5.1 row 3: a topic needs a body; the trigger names it before the CHECK does.
    assert.throws(() => as("INSERT INTO posts(user_id,content,title,category) VALUES(auth.uid(),'   ','Blank body','campus-life')"), /post_topic_body_required/)
    as("INSERT INTO posts(user_id,content) VALUES(auth.uid(),'   ')")
    assert.throws(() => sql(`BEGIN; ALTER TABLE posts DISABLE TRIGGER validate_post_topic;
      INSERT INTO posts(user_id,content,title,category) VALUES('${UID}',' ','Trigger off','campus-life'); COMMIT;`), /posts_topic_body_check/)
    // Row 4: the client may choose the id (P2.8 retries); a repeat is a key conflict, never a second post.
    const addedAcl = postAcl().filter(privilege => !legacyAcl.includes(privilege))
    assert.deepEqual(addedAcl, [
      'anon:SELECT:category', 'anon:SELECT:region', 'anon:SELECT:title',
      'authenticated:INSERT:category', 'authenticated:INSERT:id', 'authenticated:INSERT:title',
      'authenticated:SELECT:category', 'authenticated:SELECT:region', 'authenticated:SELECT:title',
    ], 'id is the only new INSERT privilege beyond the topic metadata contract')
    assert.ok(legacyAcl.every(privilege => postAcl().includes(privilege)), 'existing ACL remains intact')
    assert.equal(sql("SELECT has_table_privilege('authenticated','public.posts','INSERT')"), 'f')
    assert.equal(sql("SELECT has_column_privilege('anon','public.posts','id','INSERT')"), 'f')
    assert.equal(sql("SELECT has_column_privilege('authenticated','public.posts','id','UPDATE')"), 'f')
    const clientId = '44444444-4444-4444-8444-444444444444'
    const clientInsert = () => as(`INSERT INTO posts(id,user_id,content,title,category) VALUES('${clientId}',auth.uid(),'Retry-safe body','Client id topic','events-social')`)
    clientInsert()
    assert.throws(clientInsert, /duplicate key/)
    assert.equal(sql(`SELECT count(*) FROM posts WHERE id='${clientId}'`), '1')
    assert.throws(() => as(`UPDATE posts SET id=gen_random_uuid() WHERE id='${clientId}'`), /permission denied/)
    // Row 5: the new RPC carries its own statement budget.
    assert.match(sql("SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE oid='public.search_community_posts(text[],text,integer,integer,text,text)'::regprocedure"), /(^|;)statement_timeout=3s($|;)/)
    // Row 6: posts_visible keeps its columns and options and only appends four.
    assert.equal(viewColumns(), `${legacyViewColumns},source_lang,title,category,region`)
    assert.equal(sql("SELECT array_to_string(reloptions, ',') FROM pg_class WHERE oid='public.posts_visible'::regclass"), 'security_invoker=true,security_barrier=true')
    assert.equal(as("SELECT title || '|' || category || '|' || region FROM posts_visible WHERE title='Quantum study group'", 'anon'), 'Quantum study group|campus-life|cu')
    assert.equal(as("SELECT count(*) FROM posts_visible WHERE title='Quantum hidden'", 'anon'), '0')
    // Existing item rules apply to topics as they do to legacy updates.
    const topicId = sql("SELECT id FROM posts WHERE title='Quantum study group'")
    for (let n = 1; n <= 6; n++) sql(`INSERT INTO items(id,user_id,status) VALUES('00000000-0000-4000-8000-00000000000${n}','${n === 5 ? OTHER : UID}','${n === 6 ? 'sold' : 'active'}')`)
    const attach = n => as(`INSERT INTO post_items VALUES('${topicId}','00000000-0000-4000-8000-00000000000${n}',${n-1})`)
    assert.throws(() => attach(5), /row-level security/)
    assert.throws(() => attach(6), /row-level security/)
    for (let n = 1; n <= 3; n++) attach(n)
    assert.throws(() => attach(4), /post_items_cap_exceeded/)
    assert.equal(sql(`SELECT count(*) FROM post_items WHERE post_id='${topicId}'`), '3')
    // Title/category survive target deletion; old snapshots still show body.
    const reportedId = sql("SELECT id FROM posts WHERE title='Quantum alumni meetup'")
    as(`INSERT INTO reports(reporter_id,target_type,target_id,reason) VALUES(auth.uid(),'post','${reportedId}','other')`, 'authenticated', OTHER)
    const reportId = sql(`SELECT id FROM reports WHERE target_id='${reportedId}'`)
    const snapshot = JSON.parse(sql(`SELECT target_snapshot FROM reports WHERE id='${reportId}'`))
    assert.equal(snapshot.title, 'Quantum alumni meetup')
    assert.equal(snapshot.category, 'alumni-career')
    assert.throws(() => as(`INSERT INTO reports(reporter_id,target_type,target_id,target_snapshot) VALUES(auth.uid(),'post','${reportedId}','{}')`, 'authenticated', OTHER), /permission denied/)
    assert.throws(() => sql(`UPDATE reports SET target_snapshot='{}' WHERE id='${reportId}'`), /report_target_evidence_immutable/)
    assert.throws(() => as(`SELECT * FROM admin_get_report_detail('${reportId}')`), /permission denied/)
    const preview = as(`SELECT target_preview FROM admin_get_report_detail('${reportId}')`, 'service_role')
    assert.equal(preview, '[alumni-career]\nQuantum alumni meetup\nOrdinary body')
    sql(`DELETE FROM posts WHERE id='${reportedId}'`)
    assert.equal(as(`SELECT target_preview FROM admin_get_report_detail('${reportId}')`, 'service_role'), preview)
    assert.equal(as(`SELECT target_preview FROM admin_get_report_detail('${oldReportId}')`, 'service_role'), 'Legacy campus update')
    sql(`DELETE FROM posts WHERE id='${POST}'`)
    assert.equal(as(`SELECT target_preview FROM admin_get_report_detail('${oldReportId}')`, 'service_role'), 'Legacy campus update')

  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  }
})
