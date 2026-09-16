import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = path => readFileSync(resolve(root, path), 'utf8')
const digest = text => createHash('sha256').update(text).digest('hex')
const names = [
  '20260916190808_conversation_manual_unread.sql',
  '20260916192738_private_conversation_media.sql',
  '20260916195036_seller_name_search.sql',
  '20260916195510_discovery_preferences.sql',
  '20260916202229_durable_listing_english.sql',
  '20260916210800_accept_discovery_media_privacy_consent.sql',
  '20260916211900_chat_media_storage_preflight.sql',
  '20260916222000_precompute_moderation_patterns.sql',
  '20260916224000_keep_listing_profile_embed_unambiguous.sql',
  '20260916230000_preserve_indexed_seller_discovery_search.sql',
]
const manifest = new Map(read('supabase/migrations/manifest.sha256').trim().split('\n').map(line => {
  const [sha, name] = line.trim().split(/\s+/)
  return [name, sha]
}))
// These reviewed files contain only top-level transaction control on its own
// line. Remove wrappers so consent and relationship repairs are never visible
// in a partially installed state. Function/DO bodies use bare BEGIN (no ;).
const unwrap = text => text.replace(/^(?:BEGIN|COMMIT);\s*$/gm, '')
const receipt = []
const forward = names.map(name => {
  const sql = read('supabase/migrations/' + name), sha256 = digest(sql)
  if (manifest.get(name) !== sha256) throw new Error('Migration checksum mismatch: ' + name)
  receipt.push({ name, sha256 })
  return '-- SOURCE: ' + name + '\n' + unwrap(sql)
}).join('\n')
const precheck = `
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='120s';
DO $precheck$ BEGIN
 IF to_regclass('search_private.knn_fields') IS NULL
 OR to_regprocedure('search_private.union_rank(search_private.cached_field[],search_private.term_input[],text[],real,boolean,boolean,boolean,integer,integer,integer[])') IS NULL
 THEN RAISE EXCEPTION 'expected_deployed_indexed_search_missing'; END IF;
 IF md5(pg_get_functiondef('public.search_items_fuzzy_v2(text[],public.item_category,public.item_condition,numeric,numeric,uuid,text,integer,integer,text,boolean,date,text)'::regprocedure))
    <> 'dd5f5bf71187a16e667dd1992bdf7b46'
 THEN RAISE EXCEPTION 'deployed_search_changed_reconcile_first'; END IF;
 IF to_regclass('public.hidden_items') IS NOT NULL
 THEN RAISE EXCEPTION 'feedback_release_already_present_reconcile_first'; END IF;
END $precheck$;
`
const rollbackPaths = [
  'supabase/_ops/ROLLBACK_20260916_durable_listing_english.sql',
  'supabase/_ops/ROLLBACK_20260916_private_chat_media.sql',
  'supabase/_ops/ROLLBACK_20260916_manual_unread.sql',
  'supabase/_ops/ROLLBACK_20260916_preserve_indexed_seller_discovery_search.sql',
  'supabase/_ops/ROLLBACK_20260916_discovery_preferences.sql',
  'supabase/_ops/ROLLBACK_20260916_seller_name_search.sql',
  // Preserve the production indexed algorithm; never finish on the obsolete
  // full-scan V2 body restored by the individual feature rollback files.
  'supabase/_ops/indexed_search_candidate/query.sql',
  'supabase/_ops/ROLLBACK_20260916_precompute_moderation_patterns.sql',
]
const rollback = rollbackPaths.map(path => '-- SOURCE: ' + path + '\n' + unwrap(read(path))).join('\n')
const installSql = 'BEGIN;\n' + precheck + forward + '\nCOMMIT;\n'
const rollbackSql = 'BEGIN;\n' + rollback + '\nCOMMIT;\n'
const dir = resolve(root, 'output/feedback-release-20260916')
mkdirSync(dir, { recursive: true })
writeFileSync(resolve(dir, 'INSTALL.sql'), installSql)
writeFileSync(resolve(dir, 'ROLLBACK.sql'), rollbackSql)
writeFileSync(resolve(dir, 'source-receipt.json'), JSON.stringify({
  target: 'lfhvgprfphyfvhidegum', baseline: '281799c',
  previousIndexedSearchRemoteVersion: '20260916151259',
  inputs: receipt, installSha256: digest(installSql), rollbackSha256: digest(rollbackSql),
  rollbackInputs: rollbackPaths.map(path => ({ path, sha256: digest(read(path)) })),
}, null, 2) + '\n')
console.log(JSON.stringify({ directory: dir, migrations: names.length, installSha256: digest(installSql), rollbackSha256: digest(rollbackSql) }))
