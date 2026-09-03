import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

/*
 * A card shows the reader localize(title_i18n, title). Two things have to hold
 * for that title to behave like the listing's title:
 *
 *   1. Every column list that fetches `title` for a card also fetches
 *      `title_i18n` — otherwise localize() silently falls back to the
 *      author's language (seller page, 2026-09-03).
 *   2. search_items_fuzzy matches the translated title/description too —
 *      otherwise typing the title the card showed you finds nothing
 *      (migration 20260903030000).
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const MIGRATION = path.join(root, 'supabase/migrations/20260903030000_search_items_fuzzy_matches_translations.sql')
const PRIOR_BODY_MIGRATION = path.join(root, 'supabase/migrations/20260717092804_secure_public_write_boundaries.sql')

// ---------------------------------------------------------------------------
// 1. Client column lists
// ---------------------------------------------------------------------------

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(full)
  }
  return out
}

function balancedSlice(source, openIndex) {
  let depth = 0
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openIndex + 1, i)
    }
  }
  return null
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

/** Every literal column list that reads from items: select('…'), items(…), *_ITEM_FIELDS = '…'. */
function itemColumnLists(source) {
  const lists = []
  for (const match of source.matchAll(/from\('items'\)\s*\.select\(\s*'([^']*)'/g)) {
    lists.push({ columns: match[1], line: lineOf(source, match.index) })
  }
  for (const match of source.matchAll(/\bitems\(/g)) {
    const columns = balancedSlice(source, match.index + 'items'.length)
    if (columns !== null) lists.push({ columns, line: lineOf(source, match.index) })
  }
  for (const match of source.matchAll(/const \w*ITEM_FIELDS\w* =\s*'([^']*)'/g)) {
    lists.push({ columns: match[1], line: lineOf(source, match.index) })
  }
  return lists
}

function selectsBareTitle(columns) {
  return /(^|[\s,(])title(?=\s*[,)]|\s*$)/.test(columns)
}

test('every column list that fetches an item title also fetches title_i18n, because cards localize it', async () => {
  const files = await walk(path.join(root, 'app/src'))
  const offenders = []
  const localizingPages = new Set()
  let examined = 0

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const relative = path.relative(root, file)
    if (/localize\([\w.]+\.title_i18n\b/.test(source)) localizingPages.add(relative)
    for (const { columns, line } of itemColumnLists(source)) {
      if (!selectsBareTitle(columns)) continue
      examined += 1
      if (!/\btitle_i18n\b/.test(columns)) offenders.push(`${relative}:${line}`)
    }
  }

  // Controls: the scan has to have found real column lists and real callers,
  // or an empty offenders list proves nothing.
  assert.ok(examined >= 3, `only ${examined} item column lists select title — the scan is not seeing the app`)
  assert.ok(localizingPages.size >= 3, `only ${localizingPages.size} pages localize title_i18n: ${[...localizingPages].join(', ')}`)
  assert.ok(selectsBareTitle('id, title, price'))
  assert.ok(!selectsBareTitle('id, title_i18n, price'), 'title_i18n alone must not count as title')

  assert.deepEqual(offenders, [],
    `these fetch title without title_i18n, so localize() shows the author's language:\n  ${offenders.join('\n  ')}`)
})

// ---------------------------------------------------------------------------
// 2. The search RPC, on a throwaway local cluster
// ---------------------------------------------------------------------------

const PG_BIN = [
  process.env.PG_BIN_DIR,
  '/opt/homebrew/opt/postgresql@17/bin',
  '/opt/homebrew/opt/postgresql@16/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
].find(dir => dir && existsSync(path.join(dir, 'initdb')))

const SIGNATURE = 'terms_in text[], category_in item_category, condition_in item_condition, '
  + 'price_min_in numeric, price_max_in numeric, user_id_in uuid, listing_type_in text, '
  + 'limit_in integer, offset_in integer, location_in text, verified_only_in boolean'

const LAMP = '11111111-1111-4111-8111-111111111111'
const CHAIR = '22222222-2222-4222-8222-222222222222'
const SOLD_LAMP = '33333333-3333-4333-8333-333333333333'
const TEXTBOOK = '44444444-4444-4444-8444-444444444444'

const FIXTURE = `
CREATE SCHEMA extensions;
CREATE EXTENSION pg_trgm SCHEMA extensions;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated;
CREATE TYPE public.item_category AS ENUM ('furniture', 'electronics', 'books', 'other');
CREATE TYPE public.item_condition AS ENUM ('new', 'like_new', 'good', 'fair');
CREATE TYPE public.item_status AS ENUM ('active', 'reserved', 'sold', 'deleted');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  nickname text,
  avatar_url text,
  location text,
  is_illini_verified boolean DEFAULT false,
  status_text text,
  status_emoji text
);
CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id),
  title text NOT NULL,
  description text DEFAULT '',
  title_i18n jsonb,
  description_i18n jsonb,
  source_lang text,
  price numeric,
  category public.item_category,
  condition public.item_condition,
  status public.item_status DEFAULT 'active',
  listing_type text DEFAULT 'sell',
  location text,
  location_verified boolean DEFAULT false,
  images text[] DEFAULT '{}',
  image_dimensions jsonb,
  view_count integer DEFAULT 0,
  favorite_count integer DEFAULT 0,
  negotiable boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
INSERT INTO public.profiles (id, nickname) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'seller');
INSERT INTO public.items (id, user_id, title, description, title_i18n, description_i18n, source_lang, status, category) VALUES
  ('${LAMP}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Desk lamp, warm white LED', 'Barely used',
   '{"en": "Desk lamp, warm white LED", "zh": "台灯，暖白色LED"}', '{"en": "Barely used", "zh": "几乎没用过"}', 'en', 'active', 'electronics'),
  ('${CHAIR}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '木椅子', '实木',
   '{"zh": "木椅子", "en": "Wooden chair"}', '{"zh": "实木", "en": "Solid oak"}', 'zh', 'active', 'furniture'),
  ('${SOLD_LAMP}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Floor lamp', '',
   '{"en": "Floor lamp", "zh": "落地台灯"}', NULL, 'en', 'sold', 'electronics'),
  ('${TEXTBOOK}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ECE 110 textbook', 'Some notes inside',
   NULL, NULL, 'en', 'active', 'books');
`

/** The body production ran before this migration (20260717092804 §12), so OR REPLACE is exercised against it. */
async function priorFunctionSql() {
  const source = await readFile(PRIOR_BODY_MIGRATION, 'utf8')
  const start = source.indexOf('CREATE OR REPLACE FUNCTION public.search_items_fuzzy(')
  const end = source.indexOf('$function$;', start) + '$function$;'.length
  assert.ok(start > 0 && end > start, 'the 20260717092804 search_items_fuzzy body is where this test expects it')
  return source.slice(start, end)
}

class LocalCluster {
  constructor() {
    this.dir = mkdtempSync(path.join(tmpdir(), 'illini-search-i18n-'))
    this.data = path.join(this.dir, 'data')
    this.socket = path.join(this.dir, 'socket')
    this.port = 5400 + Math.floor(Math.random() * 1000)
  }

  bin(name) { return path.join(PG_BIN, name) }

  start() {
    execFileSync(this.bin('initdb'), ['-D', this.data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale'], { stdio: 'pipe' })
    execFileSync('mkdir', ['-m', '700', this.socket])
    execFileSync(this.bin('pg_ctl'), [
      '-D', this.data, '-w', '-l', path.join(this.dir, 'postgres.log'),
      '-o', `-k ${this.socket} -c listen_addresses='' -p ${this.port}`,
      'start',
    ], { stdio: 'pipe' })
  }

  psql(args, input) {
    return execFileSync(this.bin('psql'), [
      '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', this.socket, '-p', String(this.port), '-U', 'postgres', '-d', 'postgres', ...args,
    ], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  }

  exec(sql) { this.psql([], sql) }

  scalar(sql) { return this.psql(['-A', '-t', '-c', sql]).trim() }

  ids(terms) {
    const literal = `ARRAY[${terms.map(t => `'${t.replace(/'/g, "''")}'`).join(', ')}]::text[]`
    return JSON.parse(this.scalar(
      `SELECT COALESCE(json_agg(r.id ORDER BY r.rank DESC, r.created_at DESC), '[]') FROM public.search_items_fuzzy(${literal}) AS r`,
    ))
  }

  stop() {
    try {
      execFileSync(this.bin('pg_ctl'), ['-D', this.data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' })
    } finally {
      if (path.basename(this.dir).startsWith('illini-search-i18n-')) rmSync(this.dir, { recursive: true, force: true })
    }
  }
}

test('search_items_fuzzy finds a listing by the translated title and description a reader was shown',
  { skip: PG_BIN ? false : 'PostgreSQL initdb not installed' }, async () => {
    const cluster = new LocalCluster()
    cluster.start()
    try {
      cluster.exec(FIXTURE)
      cluster.exec(await priorFunctionSql())
      cluster.exec('GRANT EXECUTE ON FUNCTION public.search_items_fuzzy(text[], public.item_category, public.item_condition, numeric, numeric, uuid, text, integer, integer, text, boolean) TO anon, authenticated;')

      // The defect, on the body production runs today: the zh reader saw 台灯
      // on the card and search returns nothing for it.
      assert.deepEqual(cluster.ids(['台灯']), [], 'the prior body was expected to miss the translated title (fixture sanity)')
      assert.deepEqual(cluster.ids(['lamp']), [LAMP], 'the prior body matches the original title (fixture sanity)')

      cluster.psql(['-f', MIGRATION])

      // Translated title, both directions.
      assert.deepEqual(cluster.ids(['台灯']), [LAMP], 'a zh reader searching the zh title they were shown gets the listing')
      assert.deepEqual(cluster.ids(['Wooden']), [CHAIR], 'an en reader searching the en title they were shown gets the listing')
      // Translated description, both directions.
      assert.deepEqual(cluster.ids(['没用过']), [LAMP], 'description_i18n.zh is searched')
      assert.deepEqual(cluster.ids(['oak']), [CHAIR], 'description_i18n.en is searched')

      // Controls: the original columns still match, nonsense still matches
      // nothing, and a sold listing whose zh title contains 台灯 stays hidden.
      assert.deepEqual(cluster.ids(['lamp']), [LAMP])
      assert.deepEqual(cluster.ids(['textbook']), [TEXTBOOK])
      assert.deepEqual(cluster.ids(['qzxv']), [])
      assert.equal(cluster.scalar(`SELECT status FROM public.items WHERE id = '${SOLD_LAMP}'`), 'sold')

      // The contract the client and scripts/deployed-rpc-contract.test.mjs pin:
      // one overload, the same 11 arguments, grants carried through OR REPLACE.
      assert.equal(cluster.scalar("SELECT count(*) FROM pg_proc WHERE proname = 'search_items_fuzzy'"), '1')
      assert.equal(cluster.scalar("SELECT pg_get_function_identity_arguments('public.search_items_fuzzy'::regproc)"), SIGNATURE)
      assert.equal(cluster.scalar("SELECT has_function_privilege('anon', 'public.search_items_fuzzy'::regproc, 'EXECUTE')"), 't')
      assert.equal(cluster.scalar("SELECT prosecdef FROM pg_proc WHERE proname = 'search_items_fuzzy'"), 'f')
      assert.match(cluster.scalar("SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE proname = 'search_items_fuzzy'"), /search_path=pg_catalog, public, extensions/)
    } finally {
      cluster.stop()
    }
  })
