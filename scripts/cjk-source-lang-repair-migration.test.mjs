/**
 * Migration 20260903061500 relabels the listings and posts that were filed
 * under English while carrying the author's Chinese.
 *
 * It is a data migration, so the only honest way to test it is to run it: build
 * a throwaway PostgreSQL 17 cluster, plant the exact row shapes production is
 * carrying today, apply the file verbatim, and read the rows back.
 *
 * The rows that must NOT move matter as much as the rows that must. A migration
 * that relabels everything would pass a test made only of broken rows, so the
 * fixture carries five controls: a correctly-filed English listing, a
 * correctly-filed Chinese one, a Chinese listing whose 'en' entry is a genuine
 * translation, an English title with accented Latin (proves the guard means
 * "CJK", not "non-ASCII"), and a correctly-filed Chinese post.
 *
 * Skips when PostgreSQL 17 is not installed locally.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATION = resolve(
  repoRoot,
  'supabase/migrations/20260903061500_relabel_cjk_content_filed_as_english.sql',
)
const PG_BIN = '/opt/homebrew/opt/postgresql@17/bin'
const havePg = ['initdb', 'pg_ctl', 'psql'].every(b => existsSync(join(PG_BIN, b)))

const FIXTURE = `
CREATE TABLE public.items (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  title_i18n jsonb,
  description_i18n jsonb,
  source_lang text
);
CREATE TABLE public.posts (
  id text PRIMARY KEY,
  content text NOT NULL,
  content_i18n jsonb,
  source_lang text
);

-- Broken: the production row from 2026-08-31, seeded key only.
INSERT INTO public.items VALUES (
  'broken-crate', '宠物航空箱 XL', '宠物航空箱 32.225''''',
  '{"en": "宠物航空箱 XL"}', '{"en": "宠物航空箱 32.225''''"}', 'en');

-- Broken and inverted: Chinese under 'en', its English rendering under 'zh'.
INSERT INTO public.items VALUES (
  'broken-inverted', 'Bose QC45 降噪耳机 八成新', '用了一年，音质很好，配件齐全。',
  '{"en": "Bose QC45 降噪耳机 八成新"}',
  '{"en": "用了一年，音质很好，配件齐全。", "zh": "Used for a year, sound quality is great."}',
  'en');

-- Broken in the description only; title is genuinely English.
INSERT INTO public.items VALUES (
  'broken-desc-only', 'Dyson V8 vacuum', '九成新，配件齐全，校内自取。',
  '{"en": "Dyson V8 vacuum"}', '{"en": "九成新，配件齐全，校内自取。"}', 'en');

-- Control: a real English listing, already translated both ways.
INSERT INTO public.items VALUES (
  'ok-english', 'Bookshelf, white, 3 tiers', 'Solid wood, no scratches.',
  '{"en": "Bookshelf, white, 3 tiers", "zh": "书架，白色，3层"}',
  '{"en": "Solid wood, no scratches.", "zh": "实木，无划痕。"}', 'en');

-- Control: a Chinese listing that was already filed correctly.
INSERT INTO public.items VALUES (
  'ok-chinese', '宠物航空箱 XL', '九成新。',
  '{"zh": "宠物航空箱 XL", "en": "Pet crate XL"}',
  '{"zh": "九成新。", "en": "Barely used."}', 'zh');

-- Control: mislabelled, but the 'en' entry is a genuine translation. Dropping
-- it would cost an English reader a rendering they already have.
INSERT INTO public.items VALUES (
  'ok-real-translation', '宠物航空箱 XL', '九成新。',
  '{"en": "Pet crate XL"}', '{"en": "Barely used."}', 'en');

-- Control: non-ASCII is not CJK.
INSERT INTO public.items VALUES (
  'ok-accented', 'Café résumé lamp', 'Naïve façade, très bien.',
  '{"en": "Café résumé lamp"}', '{"en": "Naïve façade, très bien."}', 'en');

-- Broken post.
INSERT INTO public.posts VALUES (
  'broken-post', '求购二手自行车，ISR 附近交易，价格面议。',
  '{"en": "求购二手自行车，ISR 附近交易，价格面议。"}', 'en');

-- Control: a post that was already filed correctly.
INSERT INTO public.posts VALUES (
  'ok-post', '求购二手自行车，校内交易，价格面议。',
  '{"zh": "求购二手自行车，校内交易，价格面议。", "en": "Looking to buy a bicycle."}', 'zh');
`

const READBACK = `
SELECT jsonb_pretty(jsonb_build_object(
  'items', (SELECT jsonb_object_agg(id, jsonb_build_object(
     'source_lang', source_lang, 'title_i18n', title_i18n,
     'description_i18n', description_i18n)) FROM public.items),
  'posts', (SELECT jsonb_object_agg(id, jsonb_build_object(
     'source_lang', source_lang, 'content_i18n', content_i18n)) FROM public.posts)
));
`

test('20260903061500 relabels CJK content filed as English and leaves everything else alone', { skip: havePg ? false : `PostgreSQL 17 not found at ${PG_BIN}` }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cjk-source-lang-'))
  const data = join(dir, 'data')
  const sock = join(dir, 'sock')
  const pg = (bin, args, opts = {}) =>
    execFileSync(join(PG_BIN, bin), args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
  const psql = (args, input) =>
    pg('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', 'postgres', '-d', 'postgres', ...args], { input })

  try {
    execFileSync('mkdir', ['-p', sock])
    // en_US.UTF-8, deliberately: a bracket-expression range is ordered by the
    // collation, so a C-locale cluster would let a broken migration pass.
    pg('initdb', ['-D', data, '--encoding=UTF8', '--locale=en_US.UTF-8', '-U', 'postgres'])
    pg('pg_ctl', ['-D', data, '-o', `-c listen_addresses='' -k ${sock}`, '-w', '-l', join(dir, 'log'), 'start'])

    try {
      assert.equal(
        psql(['-A', '-t', '-c', 'SELECT datcollate FROM pg_database WHERE datname = current_database()']).trim(),
        'en_US.UTF-8',
        'the cluster must not be C-locale or the collation-sensitivity control is void',
      )
      psql([], FIXTURE)

      const migration = readFileSync(MIGRATION, 'utf8')
      // Control: the file under test must actually contain the repair.
      assert.match(migration, /UPDATE public\.items/)
      assert.match(migration, /UPDATE public\.posts/)
      psql([], migration)

      const after = JSON.parse(psql(['-A', '-t', '-c', READBACK]))

      // The author's Chinese moves to the key that names its language, and the
      // 'en' key is dropped so the reader side falls through to translation.
      assert.deepEqual(after.items['broken-crate'], {
        source_lang: 'zh',
        title_i18n: { zh: '宠物航空箱 XL' },
        description_i18n: { zh: "宠物航空箱 32.225''" },
      })
      // The inverted English rendering under 'zh' is overwritten, not kept.
      assert.deepEqual(after.items['broken-inverted'], {
        source_lang: 'zh',
        title_i18n: { zh: 'Bose QC45 降噪耳机 八成新' },
        description_i18n: { zh: '用了一年，音质很好，配件齐全。' },
      })
      // Only the field that was actually mis-keyed moves.
      assert.deepEqual(after.items['broken-desc-only'], {
        source_lang: 'zh',
        title_i18n: { en: 'Dyson V8 vacuum' },
        description_i18n: { zh: '九成新，配件齐全，校内自取。' },
      })

      assert.deepEqual(after.items['ok-english'], {
        source_lang: 'en',
        title_i18n: { en: 'Bookshelf, white, 3 tiers', zh: '书架，白色，3层' },
        description_i18n: { en: 'Solid wood, no scratches.', zh: '实木，无划痕。' },
      })
      assert.deepEqual(after.items['ok-chinese'], {
        source_lang: 'zh',
        title_i18n: { zh: '宠物航空箱 XL', en: 'Pet crate XL' },
        description_i18n: { zh: '九成新。', en: 'Barely used.' },
      })
      assert.deepEqual(after.items['ok-real-translation'], {
        source_lang: 'en',
        title_i18n: { en: 'Pet crate XL' },
        description_i18n: { en: 'Barely used.' },
      })
      assert.deepEqual(after.items['ok-accented'], {
        source_lang: 'en',
        title_i18n: { en: 'Café résumé lamp' },
        description_i18n: { en: 'Naïve façade, très bien.' },
      })

      assert.deepEqual(after.posts['broken-post'], {
        source_lang: 'zh',
        content_i18n: { zh: '求购二手自行车，ISR 附近交易，价格面议。' },
      })
      assert.deepEqual(after.posts['ok-post'], {
        source_lang: 'zh',
        content_i18n: { zh: '求购二手自行车，校内交易，价格面议。', en: 'Looking to buy a bicycle.' },
      })

      // Idempotent: a replay is a no-op, not a second rewrite.
      psql([], migration)
      assert.deepEqual(JSON.parse(psql(['-A', '-t', '-c', READBACK])), after)
    } finally {
      pg('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
