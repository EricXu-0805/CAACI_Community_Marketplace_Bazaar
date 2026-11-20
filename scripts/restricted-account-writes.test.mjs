import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/*
 * D-49: an account under an active posting restriction (canonical level 2-5)
 * keeps reading and tidying up but cannot publish, edit, contact or transact.
 *
 * The whole migration file runs here against a narrow schema. Everything the
 * decision rests on is the real stored text: current_profile_state and
 * is_posting_allowed, the eight bodies the migration reissues, and the
 * conversation and attachment access helpers. Only tables, grants and two
 * decoy triggers are stand-ins. The full-chain behaviour (real ACLs, RLS,
 * notifications, sale completion) is REGRESSION_20261114015420.
 */

const bin = ['/opt/homebrew/opt/postgresql@17/bin', '/usr/lib/postgresql/17/bin'].find(p => existsSync(join(p, 'initdb')))
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const readOps = name => readFileSync(new URL(`../supabase/_ops/${name}`, import.meta.url), 'utf8')
const migration = read('20261114015420_restricted_account_writes.sql')

// One complete CREATE [OR REPLACE] FUNCTION statement, body included.
function functionSql(source, name) {
  const start = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name.replace('.', '\\.')}\\(`).exec(source)
  assert.ok(start, `${name} is not defined in the named migration`)
  const tag = /\bAS (\$[a-z_]*\$)/.exec(source.slice(start.index))
  const open = start.index + tag.index + tag[0].length
  const close = source.indexOf(tag[1], open)
  return source.slice(start.index, source.indexOf(';', close) + 1)
}

const A = '11111111-1111-4111-8111-111111111111' // the account whose state changes
const B = '22222222-2222-4222-8222-222222222222' // an ordinary other member
const C = '33333333-3333-4333-8333-333333333333' // unrestricted, cache claims level 5
const D = '44444444-4444-4444-8444-444444444444' // level 3 active, cache looks clean
const ITEM_A = 'a0000000-0000-4000-8000-000000000001'
const ITEM_A_RESERVED = 'a0000000-0000-4000-8000-000000000002'
const ITEM_B = 'a0000000-0000-4000-8000-000000000003'
const POST_A = 'b0000000-0000-4000-8000-000000000001'
const POST_B = 'b0000000-0000-4000-8000-000000000002'
const POST_B_LIKED = 'b0000000-0000-4000-8000-000000000003'
const COMMENT_A = 'c0000000-0000-4000-8000-000000000001'
const COMMENT_B = 'c0000000-0000-4000-8000-000000000002'
const CONVERSATION = 'd0000000-0000-4000-8000-000000000001'
const MISSING = 'e0000000-0000-4000-8000-000000000009'
const ATTACHMENT = `items/${A}/${CONVERSATION}/f0000000-0000-4000-8000-000000000001.jpg`

const STARTED = '2020-01-01 00:00:00+00'
const ENDS = '2099-01-02 03:04:05.678+00' // fraction is dropped, not rounded
const ENDS_LABEL = '2099-01-02T03:04:05Z'
const ENDS_OTHER_ZONE = '2099-06-30 23:59:59.9-06' // printed in UTC
const ENDS_OTHER_ZONE_LABEL = '2099-07-01T05:59:59Z'
const EXPIRED = '2021-01-01 00:00:00+00'
const NOT_YET = '2098-01-01 00:00:00+00'

// rows: [level, started_at, ends_at, lifted_at]; refusal is the exact text an
// active level 2-5 restriction must produce, null when writes stay open.
const STATES = [
  { name: 'L0 with no history', rows: [], refusal: null },
  { name: 'L0 active record', rows: [[0, STARTED, ENDS, null]], refusal: null },
  { name: 'L1 with an end', rows: [[1, STARTED, ENDS, null]], refusal: null },
  { name: 'L1 open-ended', rows: [[1, STARTED, null, null]], refusal: null },
  { name: 'L1 infinite', rows: [[1, STARTED, 'infinity', null]], refusal: null },
  ...[2, 3, 4, 5].flatMap(level => [
    { name: `L${level} with an end`, rows: [[level, STARTED, level % 2 ? ENDS_OTHER_ZONE : ENDS, null]],
      refusal: `suspension_active:${level}:${level % 2 ? ENDS_OTHER_ZONE_LABEL : ENDS_LABEL}` },
    { name: `L${level} open-ended`, rows: [[level, STARTED, null, null]], refusal: `suspension_active:${level}:permanent` },
    { name: `L${level} infinite`, rows: [[level, STARTED, 'infinity', null]], refusal: `suspension_active:${level}:permanent` },
    { name: `L${level} expired`, rows: [[level, STARTED, EXPIRED, null]], refusal: null },
  ]),
  { name: 'L5 lifted', rows: [[5, STARTED, ENDS, EXPIRED]], refusal: null },
  { name: 'L5 not started yet', rows: [[5, NOT_YET, ENDS, null]], refusal: null },
  { name: 'expired L5 over active L3', rows: [[5, STARTED, EXPIRED, null], [3, STARTED, ENDS, null]], refusal: `suspension_active:3:${ENDS_LABEL}` },
  { name: 'expired L5 over active L1', rows: [[5, STARTED, EXPIRED, null], [1, STARTED, ENDS, null]], refusal: null },
  { name: 'active L2 and L4 take the higher level and its own end', rows: [[2, STARTED, ENDS_OTHER_ZONE, null], [4, STARTED, ENDS, null]], refusal: `suspension_active:4:${ENDS_LABEL}` },
  { name: 'L3 with an end and L3 open-ended is open-ended', rows: [[3, STARTED, ENDS, null], [3, STARTED, null, null]], refusal: 'suspension_active:3:permanent' },
  { name: 'lifted L5 over active L2', rows: [[5, STARTED, ENDS, EXPIRED], [2, STARTED, ENDS, null]], refusal: `suspension_active:2:${ENDS_LABEL}` },
]

const OPS = []
// blocked: refused for an active restriction; otherwise `ok` (default one row).
const blocked = (name, action, ok = 'ok:1', extra = {}) => OPS.push({ name, action, blocked: true, ok, role: 'authenticated', uid: A, ...extra })
// open: the same answer in every state.
const open = (name, action, always = 'ok:1', extra = {}) => OPS.push({ name, action, always, role: 'authenticated', uid: A, ...extra })

blocked('follow', `INSERT INTO public.follows VALUES ('${A}','${B}')`)
blocked('follow again while already following', `INSERT INTO public.follows VALUES ('${A}','${C}') ON CONFLICT DO NOTHING`, 'ok:0')
blocked('like a post', `INSERT INTO public.post_likes VALUES ('${POST_B}','${A}')`)
blocked('like a reply', `INSERT INTO public.post_comment_likes VALUES ('${COMMENT_B}','${A}')`)
blocked('attach a listing to a post', `INSERT INTO public.post_items VALUES ('${POST_A}','${ITEM_A}',0)`)
blocked('start a listing conversation', `INSERT INTO public.conversations(item_id,buyer_id,seller_id) VALUES ('${ITEM_B}','${A}','${B}')`)
blocked('start a direct conversation', `INSERT INTO public.conversations(buyer_id,seller_id,is_direct) VALUES ('${A}','${C}',true)`)
blocked('start a direct conversation with a restricted member', `INSERT INTO public.conversations(buyer_id,seller_id,is_direct) VALUES ('${A}','${D}',true)`, '42501:conversation_unavailable')
for (const [column, value] of [
  ['title', `'Edited'`], ['description', `'Edited'`], ['price', '19'], ['images', `ARRAY['https://example.invalid/a.jpg']`],
  ['image_dimensions', `'[{"w":1,"h":1}]'`], ['location', `'Urbana'`], ['category', `'books'`], ['listing_details', `'{"kind":"housing"}'`],
  ['negotiable', 'true'], ['condition', `'new'`], ['title_i18n', `'{"en":"Desk"}'`], ['description_i18n', `'{"en":"A desk"}'`],
  ['source_lang', `'zh'`], ['location_check_token', `'${MISSING}'`],
]) blocked(`edit item ${column}`, `UPDATE public.items SET ${column}=${value} WHERE id='${ITEM_A}'`)
blocked('relist a reserved item', `UPDATE public.items SET status='active' WHERE id='${ITEM_A_RESERVED}'`)
blocked('edit and reserve in one statement', `UPDATE public.items SET title='Edited',status='reserved' WHERE id='${ITEM_A}'`)
// The refusal comes before the payload rule that sorts after it.
blocked('edit item with a payload the next trigger rejects', `UPDATE public.items SET title='INVALID' WHERE id='${ITEM_A}'`, '22023:public_write_boundary:item_title_size')
for (const column of ['content_i18n', 'content', 'title', 'category', 'images', 'image_dimensions', 'source_lang']) {
  const value = { content_i18n: `'{"en":"x"}'`, images: `ARRAY['x']`, image_dimensions: `'[1]'` }[column] || `'Edited'`
  blocked(`edit post ${column}`, `UPDATE public.posts SET ${column}=${value} WHERE id='${POST_A}'`)
}
blocked('edit reply content', `UPDATE public.post_comments SET content='Edited' WHERE id='${COMMENT_A}'`)
blocked('edit reply translation', `UPDATE public.post_comments SET content_i18n='{"en":"x"}' WHERE id='${COMMENT_A}'`)
for (const column of ['nickname', 'avatar_url', 'bio', 'location', 'status_text', 'status_emoji']) {
  blocked(`edit profile ${column}`, `UPDATE public.profiles SET ${column}='Edited' WHERE id='${A}'`)
}
blocked('profile upsert', `INSERT INTO public.profiles(id,nickname) VALUES ('${A}','Upsert') ON CONFLICT (id) DO UPDATE SET nickname=excluded.nickname`)
blocked('upload an item image', `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('item-images','items/${A}/new.jpg','{"mimetype":"image/jpeg"}')`)
blocked('upload a chat attachment', `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('chat-media','items/${A}/${CONVERSATION}/new.jpg','{"mimetype":"image/jpeg"}')`)
blocked('upload a file the next trigger rejects', `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('item-images','items/${A}/bad.html','{"mimetype":"text/html"}')`, '22023:storage_boundary:invalid_image_type')
blocked('RLS check for the current account', `SELECT private.assert_current_account_posting_allowed()`, 'value:true', { ask: true })
// The six RPCs: refused right after the caller is identified; an unrestricted
// caller goes on to the next rule, which here is that the target does not exist.
blocked('make_offer', `SELECT public.make_offer('${MISSING}',25,'${A}','note')`, '42501:conversation_unavailable')
blocked('respond_to_offer', `SELECT public.respond_to_offer('${MISSING}','accept','${A}')`, '42501:offer_unavailable')
blocked('propose_meetup', `SELECT public.propose_meetup('${MISSING}','Library','2099-01-01 00:00:00+00','${A}','note')`, '42501:conversation_unavailable')
blocked('respond_to_meetup', `SELECT public.respond_to_meetup('${MISSING}','accept','${A}')`, '42501:meetup_unavailable')
blocked('reschedule_accepted_meetup', `SELECT public.reschedule_accepted_meetup('${MISSING}','Union','2099-01-01 00:00:00+00','${A}','note')`, '42501:meetup_unavailable')
blocked('submit_transaction_rating', `SELECT public.submit_transaction_rating('${MISSING}','${B}',5,'Good','${A}')`, '42501:rating_not_permitted')

// Identity checks still come first, restricted or not.
open('make_offer for another account', `SELECT public.make_offer('${MISSING}',25,'${B}','note')`, '42501:account_changed')
open('submit_transaction_rating for another account', `SELECT public.submit_transaction_rating('${MISSING}','${B}',5,'Good','${B}')`, '42501:account_changed')
open('make_offer without a user claim', `SELECT public.make_offer('${MISSING}',25,'${A}','note')`, '42501:not_authenticated', { uid: '' })
open('RLS check without a user claim', `SELECT private.assert_current_account_posting_allowed()`, 'value:false', { uid: '', ask: true })
// Reading, deleting, delisting and bookkeeping stay open.
open('unfollow', `DELETE FROM public.follows WHERE follower_id='${A}' AND followee_id='${C}'`)
open('unlike', `DELETE FROM public.post_likes WHERE post_id='${POST_B_LIKED}' AND user_id='${A}'`)
open('delete own item', `DELETE FROM public.items WHERE id='${ITEM_A}'`)
open('delete own post', `DELETE FROM public.posts WHERE id='${POST_A}'`)
open('delete own reply', `DELETE FROM public.post_comments WHERE id='${COMMENT_A}'`)
open('reserve an item', `UPDATE public.items SET status='reserved' WHERE id='${ITEM_A}'`)
open('mark an item sold', `UPDATE public.items SET status='sold' WHERE id='${ITEM_A}'`)
open('save an item without changing it', `UPDATE public.items SET title=title,status=status WHERE id='${ITEM_A}'`)
open('save a profile without changing it', `UPDATE public.profiles SET nickname=nickname WHERE id='${A}'`)
open('pin a conversation', `UPDATE public.conversations SET is_pinned_buyer=true WHERE id='${CONVERSATION}'`)
open('read own item image', `SELECT 1 FROM storage.objects WHERE bucket_id='item-images' AND name='items/${A}/old.jpg'`)
open('delete own item image', `DELETE FROM storage.objects WHERE bucket_id='item-images' AND name='items/${A}/old.jpg'`)
open('upload to another bucket', `INSERT INTO storage.objects(bucket_id,name) VALUES ('other','items/${A}/x.bin')`)
open('read a chat attachment', `SELECT private.chat_media_access('${ATTACHMENT}',false)`, 'value:true', { ask: true })
open('own an unsent chat attachment', `SELECT private.chat_media_access('${ATTACHMENT}',true)`, 'value:true', { ask: true })
// A definer RPC runs as its owner but still on behalf of this caller.
open('view counter on another listing', `UPDATE public.items SET view_count=view_count+1 WHERE id='${ITEM_B}'`, 'ok:1', { role: 'postgres' })
open('consent version', `UPDATE public.profiles SET tos_version='2026-09-19' WHERE id='${A}'`, 'ok:1', { role: 'postgres' })
// Someone else acts on this account's rows.
open('another member likes its post', `INSERT INTO public.post_likes VALUES ('${POST_A}','${B}')`, 'ok:1', { uid: B })
open('another member follows it', `INSERT INTO public.follows VALUES ('${B}','${A}')`, 'ok:1', { uid: B })
// Service-role work carries no user claim.
open('worker translates its listing', `UPDATE public.items SET title_i18n='{"en":"Worker"}' WHERE id='${ITEM_A}'`, 'ok:1', { role: 'service_role', uid: '' })
open('worker records an object in its folder', `INSERT INTO storage.objects(bucket_id,name) VALUES ('item-images','items/${A}/worker.jpg')`, 'ok:1', { role: 'service_role', uid: '' })
open('service sets a profile field', `UPDATE public.profiles SET nickname='Service value' WHERE id='${A}'`, 'ok:1', { role: 'service_role', uid: '' })

const REISSUED = [
  'public.make_offer(uuid,numeric,uuid,text)',
  'public.respond_to_offer(uuid,text,uuid,numeric,text)',
  'public.propose_meetup(uuid,text,timestamptz,uuid,text)',
  'public.respond_to_meetup(uuid,text,uuid,text,timestamptz,text)',
  'public.reschedule_accepted_meetup(uuid,text,timestamptz,uuid,text)',
  'public.submit_transaction_rating(uuid,uuid,integer,text,uuid)',
  'public.enforce_chat_block_boundary()',
  'private.chat_media_access(text,boolean)',
]
const CREATED = [
  'moderation_private.assert_posting_allowed(uuid)',
  'private.assert_current_account_posting_allowed()',
  'private.enforce_restricted_account_write()',
]
// (signature, md5) pairs as the ops files list them.
const pinned = source => new Map([...source.matchAll(/\('([a-z_.]+\([a-z,]*\))', '([0-9a-f]{32})'/g)].map(m => [m[1], m[2]]))

test('restricted accounts are refused the listed writes and nothing else', { skip: !bin && 'local PostgreSQL unavailable' }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'restricted-writes-'))
  const data = join(dir, 'data'), port = String(50000 + Math.floor(Math.random() * 10000))
  const run = (name, args, input) => execFileSync(join(bin, name), args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  const sql = input => run('psql', ['-X', '-h', dir, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qtA'], input).trim()
  let started = false
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--no-locale'])
    run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${dir} -c listen_addresses=''`, '-l', join(dir, 'pg.log'), '-w', 'start'])
    started = true
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA moderation_private; CREATE SCHEMA storage; CREATE SCHEMA harness;
      GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
      GRANT USAGE ON SCHEMA private TO authenticated;
      GRANT USAGE ON SCHEMA moderation_private TO anon, authenticated, service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TYPE public.item_status AS ENUM('active','reserved','sold','deleted');
      CREATE TABLE public.profiles(id uuid PRIMARY KEY, nickname text NOT NULL DEFAULT '', avatar_url text DEFAULT '', bio text DEFAULT '',
        location text DEFAULT 'UIUC', status_text text, status_emoji text, tos_version text,
        suspension_level smallint NOT NULL DEFAULT 0, suspended_until timestamptz);
      CREATE TABLE public.suspensions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL REFERENCES public.profiles(id),
        level smallint NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, lifted_at timestamptz);
      CREATE TABLE public.items(id uuid PRIMARY KEY, user_id uuid, title text, description text DEFAULT '', price numeric(10,2) DEFAULT 0,
        category text DEFAULT 'other', condition text DEFAULT 'good', status public.item_status NOT NULL DEFAULT 'active',
        location text DEFAULT 'UIUC', images text[] DEFAULT '{}', image_dimensions jsonb DEFAULT '[]', negotiable boolean DEFAULT false,
        title_i18n jsonb, description_i18n jsonb, source_lang text, listing_details jsonb, location_check_token uuid,
        view_count integer NOT NULL DEFAULT 0);
      CREATE TABLE public.posts(id uuid PRIMARY KEY, user_id uuid, content text, title text, category text, images text[] DEFAULT '{}',
        image_dimensions jsonb DEFAULT '[]', content_i18n jsonb, source_lang text, like_count integer NOT NULL DEFAULT 0);
      CREATE TABLE public.post_comments(id uuid PRIMARY KEY, post_id uuid, user_id uuid, content text, content_i18n jsonb);
      CREATE TABLE public.conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
        is_direct boolean NOT NULL DEFAULT false, is_pinned_buyer boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.follows(follower_id uuid, followee_id uuid, PRIMARY KEY(follower_id,followee_id));
      CREATE TABLE public.post_likes(post_id uuid, user_id uuid, PRIMARY KEY(post_id,user_id));
      CREATE TABLE public.post_comment_likes(comment_id uuid, user_id uuid, PRIMARY KEY(comment_id,user_id));
      CREATE TABLE public.post_items(post_id uuid, item_id uuid, display_order integer, PRIMARY KEY(post_id,item_id));
      CREATE TABLE public.messages(id uuid PRIMARY KEY, conversation_id uuid, sender_id uuid, content text, message_type text DEFAULT 'text');
      CREATE TABLE public.offers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, item_id uuid, from_user uuid, to_user uuid,
        price numeric, note text, status text DEFAULT 'pending', parent_offer_id uuid, expires_at timestamptz,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.meetups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid, item_id uuid, from_user uuid, to_user uuid,
        spot text, meet_at timestamptz, note text, status text DEFAULT 'pending', parent_meetup_id uuid, expires_at timestamptz,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.ratings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rater_id uuid, ratee_id uuid, item_id uuid, stars integer, comment text);
      CREATE TABLE public.blocks(blocker_id uuid, blocked_id uuid);
      CREATE TABLE public.account_deletion_jobs(user_id uuid);
      CREATE TABLE private.chat_media_gc(name text PRIMARY KEY, attempted_at timestamptz);
      CREATE TABLE private.item_deals(item_id uuid PRIMARY KEY, owner_id uuid, counterparty_id uuid);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL, name text NOT NULL, owner uuid,
        metadata jsonb, version text, UNIQUE(bucket_id,name));
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY read_objects ON storage.objects FOR SELECT TO authenticated USING (true);
      CREATE POLICY upload_own_folder ON storage.objects FOR INSERT TO authenticated WITH CHECK (split_part(name,'/',2) = auth.uid()::text);
      CREATE POLICY delete_own_folder ON storage.objects FOR DELETE TO authenticated USING (split_part(name,'/',2) = auth.uid()::text);
      -- Stand-ins for the payload rules that sort after the new trigger.
      CREATE FUNCTION public.fixture_item_payload() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.title = 'INVALID' THEN RAISE EXCEPTION 'public_write_boundary:item_title_size' USING ERRCODE = '22023'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER authoritative_public_write_boundary BEFORE INSERT OR UPDATE ON public.items
        FOR EACH ROW EXECUTE FUNCTION public.fixture_item_payload();
      CREATE FUNCTION public.fixture_storage_payload() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.metadata->>'mimetype' = 'text/html' THEN RAISE EXCEPTION 'storage_boundary:invalid_image_type' USING ERRCODE = '22023'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER enforce_item_storage_resource_boundary BEFORE INSERT OR UPDATE ON storage.objects
        FOR EACH ROW EXECUTE FUNCTION public.fixture_storage_payload();
      -- One attempt as a role and user. It is always rolled back, so attempts
      -- never see each other. ask=true returns the statement's single value.
      CREATE FUNCTION harness.attempt(as_role text, as_uid text, action text, ask boolean) RETURNS text LANGUAGE plpgsql AS $$
        DECLARE affected bigint; answer text;
        BEGIN
          BEGIN
            PERFORM set_config('request.jwt.claim.sub', as_uid, true);
            EXECUTE format('SET LOCAL ROLE %I', as_role);
            IF ask THEN
              EXECUTE action INTO answer;
              answer := 'value:' || coalesce(answer, 'null');
            ELSE
              EXECUTE action;
              GET DIAGNOSTICS affected = ROW_COUNT;
              answer := 'ok:' || affected;
            END IF;
            RAISE EXCEPTION USING ERRCODE = 'Z4949', MESSAGE = answer;
          EXCEPTION
            WHEN SQLSTATE 'Z4949' THEN RETURN SQLERRM;
            WHEN OTHERS THEN RETURN SQLSTATE || ':' || SQLERRM;
          END;
        END $$;
      INSERT INTO public.profiles(id,nickname,suspension_level) VALUES ('${A}','Member A',0),('${B}','Member B',0),('${C}','Member C',5),('${D}','Member D',0);
      INSERT INTO public.suspensions(profile_id,level,started_at,ends_at) VALUES ('${D}',3,'${STARTED}','${ENDS}');
      INSERT INTO public.items(id,user_id,title,status) VALUES ('${ITEM_A}','${A}','Desk','active'),('${ITEM_A_RESERVED}','${A}','Lamp','reserved'),('${ITEM_B}','${B}','Chair','active');
      INSERT INTO public.posts(id,user_id,content) VALUES ('${POST_A}','${A}','Own post'),('${POST_B}','${B}','Other post'),('${POST_B_LIKED}','${B}','Liked post');
      INSERT INTO public.post_comments(id,post_id,user_id,content) VALUES ('${COMMENT_A}','${POST_A}','${A}','Own reply'),('${COMMENT_B}','${POST_B}','${B}','Other reply');
      INSERT INTO public.follows VALUES ('${A}','${C}');
      INSERT INTO public.post_likes VALUES ('${POST_B_LIKED}','${A}');
      INSERT INTO public.conversations(id,item_id,buyer_id,seller_id) VALUES ('${CONVERSATION}','${ITEM_B}','${A}','${B}');
      INSERT INTO storage.objects(bucket_id,name) VALUES ('item-images','items/${A}/old.jpg');`)

    // The real stored text of everything the decision and the reissued bodies rest on.
    const visibility = read('20260718160000_reconcile_expired_suspension_visibility.sql')
    const chat = read('20260717141822_enforce_symmetric_chat_block_boundary.sql')
    const meetups = read('20260718250000_durable_meetup_email_delivery.sql')
    sql(functionSql(visibility, 'moderation_private.current_profile_state'))
    sql(functionSql(visibility, 'public.is_posting_allowed'))
    sql(functionSql(chat, 'private.current_user_can_access_pair'))
    sql(functionSql(chat, 'private.current_user_can_access_conversation'))
    sql(functionSql(read('20260717194646_account_deletion_jobs.sql'), 'private.current_account_storage_writes_allowed'))
    sql(functionSql(chat, 'public.make_offer'))
    sql(functionSql(chat, 'public.respond_to_offer'))
    sql(functionSql(meetups, 'public.propose_meetup'))
    sql(functionSql(meetups, 'public.respond_to_meetup'))
    sql(functionSql(meetups, 'public.reschedule_accepted_meetup'))
    sql(functionSql(read('20260718210000_deal_attributed_ratings.sql'), 'public.submit_transaction_rating'))
    sql(functionSql(read('20260916050227_direct_profile_conversations.sql'), 'public.enforce_chat_block_boundary'))
    sql(functionSql(read('20260916192738_private_conversation_media.sql'), 'private.chat_media_access'))
    sql(`CREATE TRIGGER trg_chat_block_boundary BEFORE INSERT OR UPDATE ON public.conversations
        FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block_boundary();
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private, moderation_private FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${REISSUED.filter(name => name !== 'public.enforce_chat_block_boundary()').join(', ')} TO authenticated;
      GRANT EXECUTE ON FUNCTION private.current_user_can_access_pair(uuid,uuid), private.current_account_storage_writes_allowed() TO authenticated;
      GRANT EXECUTE ON FUNCTION public.is_posting_allowed(uuid) TO service_role;`)

    const bodyMd5 = names => new Map(sql(`SELECT s || ' ' || md5(p.prosrc) FROM unnest(ARRAY[${names.map(n => `'${n}'`).join(',')}]) AS s
      JOIN pg_proc AS p ON p.oid = to_regprocedure(s)`).split('\n').filter(Boolean).map(line => line.split(' ')))
    const contract = () => sql(`SELECT string_agg(p.oid::regprocedure::text || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid)
        || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || p.proconfig::text || '|' || p.proowner::regrole::text || '|' || p.proacl::text,
        E'\\n' ORDER BY p.oid::regprocedure::text)
      FROM pg_proc AS p WHERE p.oid = ANY (ARRAY[${REISSUED.map(n => `'${n}'::regprocedure`).join(',')}])`)

    const precheck = pinned(readOps('PRECHECK_20261114015420_restricted_account_writes.sql'))
    const before = bodyMd5([...REISSUED, 'moderation_private.current_profile_state(uuid)', 'public.is_posting_allowed(uuid)', 'private.current_account_storage_writes_allowed()'])
    const contractBefore = contract()
    sql(migration)

    await t.test('the ops files pin the bodies this migration starts from and ends with', () => {
      assert.equal(before.size, REISSUED.length + 3)
      for (const [signature, md5] of before) assert.equal(precheck.get(signature), md5, `PRECHECK does not pin the stored ${signature}`)
      const verify = pinned(readOps('VERIFY_20261114015420_restricted_account_writes.sql'))
      const after = bodyMd5([...REISSUED, ...CREATED])
      assert.equal(after.size, REISSUED.length + CREATED.length)
      for (const [signature, md5] of after) {
        assert.equal(verify.get(signature), md5, `VERIFY does not pin the migrated ${signature}`)
        if (before.has(signature)) assert.notEqual(md5, before.get(signature), `${signature} was not reissued`)
      }
    })

    await t.test('reissued functions keep their signature, defaults, owner, security and grants', () => {
      assert.equal(contract(), contractBefore)
    })

    await t.test('the new functions are closed to API roles except the caller-bound RLS check', () => {
      const grants = sql(`SELECT string_agg(s || ':' || r || ':' || has_function_privilege(r, s, 'EXECUTE')::text, ' ' ORDER BY s, r)
        FROM unnest(ARRAY[${CREATED.map(n => `'${n}'`).join(',')}]) AS s, unnest(ARRAY['anon','authenticated','service_role']) AS r`)
      assert.equal(grants, [
        'moderation_private.assert_posting_allowed(uuid):anon:false',
        'moderation_private.assert_posting_allowed(uuid):authenticated:false',
        'moderation_private.assert_posting_allowed(uuid):service_role:false',
        'private.assert_current_account_posting_allowed():anon:false',
        'private.assert_current_account_posting_allowed():authenticated:true',
        'private.assert_current_account_posting_allowed():service_role:false',
        'private.enforce_restricted_account_write():anon:false',
        'private.enforce_restricted_account_write():authenticated:false',
        'private.enforce_restricted_account_write():service_role:false',
      ].join(' '))
      assert.equal(sql(`SELECT string_agg(prosecdef::text || ':' || proconfig::text, ' ') FROM pg_proc
        WHERE oid = ANY (ARRAY[${CREATED.map(n => `'${n}'::regprocedure`).join(',')}])`),
        Array(3).fill('true:{search_path=pg_catalog}').join(' '))
      assert.equal(sql(`SELECT string_agg(tgrelid::regclass::text, ',' ORDER BY tgrelid::regclass::text) FROM pg_trigger
        WHERE tgname = 'aa_restricted_account_write' AND tgfoid = 'private.enforce_restricted_account_write()'::regprocedure`),
        'conversations,follows,items,post_comment_likes,post_comments,post_items,post_likes,posts,profiles,storage.objects')
      assert.equal(sql(`SELECT string_agg(polname::text || ':' || polpermissive::text || ':' || polcmd::text, ' ' ORDER BY polname::text) FROM pg_policy
        WHERE polrelid = 'storage.objects'::regclass AND polname LIKE 'restricted_account%'`),
        'restricted_account_blocks_upload_insert:false:a restricted_account_blocks_upload_update:false:w')
    })

    const values = OPS.map(op => `($op$${op.name}$op$,'${op.role}','${op.uid}',$op$${op.action}$op$,${Boolean(op.ask)})`).join(',\n')
    for (const state of STATES) {
      await t.test(state.name, () => {
        const rows = state.rows.map(([level, startedAt, endsAt, liftedAt]) =>
          `('${A}',${level},'${startedAt}',${endsAt ? `'${endsAt}'` : 'NULL'},${liftedAt ? `'${liftedAt}'` : 'NULL'})`).join(',')
        // The cached columns always claim the opposite of the action log.
        const actual = JSON.parse(sql(`BEGIN;
          DELETE FROM public.suspensions WHERE profile_id = '${A}';
          ${rows ? `INSERT INTO public.suspensions(profile_id,level,started_at,ends_at,lifted_at) VALUES ${rows};` : ''}
          UPDATE public.profiles SET suspension_level = ${state.refusal ? 0 : 5}, suspended_until = NULL WHERE id = '${A}';
          COMMIT;
          SELECT json_object_agg(op.name, harness.attempt(op.as_role, op.as_uid, op.action, op.ask))
          FROM (VALUES ${values}) AS op(name, as_role, as_uid, action, ask);`))
        const expected = Object.fromEntries(OPS.map(op => [
          op.name,
          op.always ?? (state.refusal ? `P0001:${state.refusal}` : op.ok),
        ]))
        assert.deepEqual(actual, expected)
      })
    }

    await t.test('the Storage policy refuses on its own when the row trigger is off', () => {
      const attempt = (uid, bucket) => sql(`BEGIN;
        DELETE FROM public.suspensions WHERE profile_id = '${A}';
        INSERT INTO public.suspensions(profile_id,level,started_at,ends_at) VALUES ('${A}',4,'${STARTED}',NULL);
        ALTER TABLE storage.objects DISABLE TRIGGER aa_restricted_account_write;
        SELECT harness.attempt('authenticated','${uid}',$op$INSERT INTO storage.objects(bucket_id,name) VALUES ('${bucket}','items/${uid}/policy.jpg')$op$,false);
        ROLLBACK;`)
      assert.equal(attempt(A, 'item-images'), 'P0001:suspension_active:4:permanent')
      assert.equal(attempt(A, 'chat-media'), 'P0001:suspension_active:4:permanent')
      assert.equal(attempt(A, 'other'), 'ok:1')
      assert.equal(attempt(B, 'item-images'), 'ok:1')
    })
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  }
})
