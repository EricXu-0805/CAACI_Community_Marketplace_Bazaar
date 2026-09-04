import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * 20260903060000 changes what the database refuses, and the only honest way to
 * measure that is to run the real function over real text.
 *
 * The harness boots a throwaway PostgreSQL 17 cluster, installs the keyword
 * rows and the two function bodies that production was running on 2026-09-03
 * (copied out of pg_get_functiondef), and FIRST asserts the pre-change numbers:
 * 25 of 45 evasion variants refused, 9 of 21 benign secondhand sentences
 * refused. Until that baseline reproduces, nothing measured afterwards means
 * anything — the harness would be grading itself.
 *
 * Then it applies 20260903023000 (the sibling that switches 29 everyday words
 * off as bare keywords — this migration depends on it and does not repeat it)
 * followed by 20260903060000, and asserts the new policy.
 *
 * Skips when initdb is absent, which is every CI runner today.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const MIGRATION = path.join(
  ROOT,
  'supabase/migrations/20260903060000_allow_contact_info_and_layer_ad_detection.sql',
)

const MIGRATION_20260904060000 = path.join(
  ROOT,
  'supabase/migrations/20260904060000_ad_signals_stop_catching_ordinary_listings.sql',
)

const PG_BIN_CANDIDATES = [
  '/opt/homebrew/opt/postgresql@17/bin',
  '/usr/local/opt/postgresql@17/bin',
  '/opt/homebrew/opt/postgresql@16/bin',
]

function findPgBin() {
  for (const dir of PG_BIN_CANDIDATES) {
    if (existsSync(path.join(dir, 'initdb'))) return dir
  }
  return null
}

// ---------------------------------------------------------------------------
// The two corpora, verbatim.
// ---------------------------------------------------------------------------

/**
 * 45 evasion variants. 40 are ads; the last 5 are contact handles and nothing
 * else, which the 2026-09-03 policy says are not ads at all.
 */
const VARIANTS = [
  // plain simplified
  ['ad01', true, '专业代购 需要的私信'],
  ['ad02', true, '长期代购各大品牌，价格优惠'],
  ['ad03', true, '招聘兼职，日结工资，有意者联系'],
  ['ad04', true, '代写作业 代考网课 包过'],
  ['ad05', true, '办证刻章，各种证件齐全'],
  ['ad06', true, '刷单兼职，日结，靠谱'],
  ['ad07', true, '低息贷款，无抵押，秒到账'],
  ['ad08', true, '换汇秒到，人民币美元都可以'],
  ['ad09', true, '诚信换钱，价格优惠，长期做'],
  // traditional
  ['ad10', true, '專業代購，需要的私信'],
  ['ad11', true, '代寫作業 代考網課 包過'],
  ['ad12', true, '辦證刻章，各種證件齊全'],
  ['ad13', true, '誠招兼職，日結工資，長期有效'],
  ['ad14', true, '刷單兼職，日結靠譜'],
  ['ad15', true, '低息貸款，無抵押，秒到賬'],
  // split by a separator
  ['ad16', true, '代 购 专业，需要的私信'],
  ['ad17', true, '代-写 作业，包过'],
  ['ad18', true, '代・购 专业 长期 加V：lisa2024'],
  ['ad19', true, '代#购 一手渠道 有货'],
  ['ad20', true, '代🔥购 靠谱 长期'],
  ['ad21', true, '代​购 需要的私信'],
  // full-width, pinyin, homophone, radical split, mixed script, vertical
  ['ad22', true, '专业ｄａｉｇｏｕ 需要的私信 vx lisa'],
  ['ad23', true, 'daigou 长期靠谱 wechat: lisa2024'],
  ['ad24', true, 'daixie 作业包过 私聊'],
  ['ad25', true, 'jianzhi shuadan 日结'],
  ['ad26', true, 'banzheng 各种证件 秒出 tg @ban001'],
  ['ad27', true, 'daikuan 低息 无抵押 当天放款'],
  ['ad28', true, 'huanhui 秒到 价格优惠'],
  ['ad29', true, 'daikao 网课包过 保过'],
  ['ad30', true, '带写作业 包过 靠谱'],
  ['ad31', true, '戴考 保过 当天出分 电话13812345678'],
  ['ad32', true, '黛购 专业长期 邮箱 lisa2024@gmail.com'],
  ['ad33', true, '亻弋购 专业，需要的私信'],
  ['ad34', true, '加V daigou 长期靠谱'],
  ['ad35', true, '代\n购\n专\n业\n长期'],
  // the noun is ordinary; only the solicitation signal makes it an ad
  ['ad36', true, '招代理 日结 有意者可私'],
  ['ad37', true, '全职招人，长期靠谱，欢迎咨询'],
  ['ad38', true, '助考 保过 当天出分'],
  ['ad39', true, '兼职刷单 日结'],
  ['ad40', true, 'ＪＩＡＮＺＨＩ 日結 招人'],
  // contact only — allowed from 2026-09-03
  ['contact1', false, 'V: lisa2024'],
  ['contact2', false, 'wx：lisa'],
  ['contact3', false, 'WhatsApp 217 555 0199'],
  ['contact4', false, '加我vx: lisa_2024'],
  ['contact5', false, '小红书同名 私我'],
]

/** 21 things a UIUC student would really post. None of them is an ad. */
const BENIGN = [
  ['benign01', '全新不穿，便宜出'],
  ['benign02', '冬天羽绒服不穿了，30刀带走'],
  ['benign03', '帮忙代购的包，闲置转让'],
  ['benign04', 'iPhone 代理商保修一年，还剩半年'],
  ['benign05', '带发票，限量款，淘宝买的'],
  ['benign06', '兼职时间不够所以出'],
  ['benign07', '全套教材 ECE 210，有笔记'],
  ['benign08', '书已到货，Green St 面交'],
  ['benign09', '自拍杆两个，一起 10 刀'],
  ['benign10', 'IKEA 书桌 40 刀，需要自取，Urbana'],
  ['benign11', '搬家清仓：微波炉、台灯、地毯，周末面交'],
  ['benign12', '宜家单人床垫，睡了一学期，60 刀'],
  ['benign13', 'Bus pass 转让，还剩两个月'],
  ['benign14', 'CS 225 教材第九版，几乎全新'],
  ['benign15', '公寓转租 6-8 月，Green St 沿线，可议价'],
  ['benign16', '自行车 Trek 26 寸，带锁，80 刀'],
  ['benign17', '厨房锅具三件套，用了两个月'],
  ['benign18', 'PS5 手柄两个，成色好'],
  ['benign19', '打印机墨盒未拆封，20 刀'],
  ['benign20', '小冰箱，宿舍用，可以帮忙送'],
  ['benign21', 'Nintendo Switch 游戏卡带三张，打包出'],
]

/*
 * Layer 4 pairs a dual-meaning noun with a solicitation signal, anywhere in the
 * same text, with no proximity. Not one of the 21 sentences above pairs the
 * two, so that corpus is structurally blind to the whole rule — it could not
 * go red no matter what the signal list contained. Every sentence here does
 * pair them, and every one is an ordinary listing: 兼职 is the seller's own
 * part-time job, 当天 is same-day pickup, 一手 is original-owner, 详谈 is
 * "price negotiable", 换钱 is only there as a substring of 换钱包.
 */
const BENIGN_INTENT = [
  ['intent1', '兼职时间不够所以出，当天可自取'],
  ['intent2', '代购的包，价格可详谈'],
  ['intent3', '全职上班没时间用了，长期闲置'],
  ['intent4', '日本代购的化妆品，一手未拆'],
  ['intent5', '换钱包了，长期闲置的旧钱包出'],
  ['intent6', '代理商保修还剩半年，需要的可以问我'],
]

/** Controls. Nothing here is part of either corpus number. */
const CONTROLS = [
  // still refused, and this migration must not touch them
  ['block1', '傻逼'],
  ['block2', '强奸'],
  ['block3', '鸦片'],
  // the words 20260903023000 switched off
  ['pass1', '全新不穿'],
  ['pass2', '带发票'],
  ['pass3', '限量'],
  ['pass4', '淘宝买的'],
  // the two collisions this migration had to design around
  ['pass5', '书桌带写字台，一起出'],
  ['pass6', '租房需要哪些证件'],
  // contact info, which is now allowed however it is written
  ['contactctl1', '微信 lisa2024'],
  ['contactctl2', '加我v信详聊'],
  ['contactctl3', 'reach me at lisa@illinois.edu'],
  ['contactctl4', '13812345678'],
  ['contactctl5', '联系电话 217-555-0199'],
  ['contactctl6', 'QQ 12345678'],
  // 20260818162716's regressions, which must stay fixed
  ['pass7', 'Selling my TV, Xbox and a desk'],
  ['pass8', 'text me and we chat about pickup'],
]

const ALL_ROWS = [
  ...VARIANTS.map(([id, , text]) => [id, text]),
  ...BENIGN,
  ...BENIGN_INTENT,
  ...CONTROLS,
]

// ---------------------------------------------------------------------------
// Production, as it stood on 2026-09-03.
// ---------------------------------------------------------------------------

/**
 * The rows of moderation_keywords that any sentence in either corpus can
 * reach, copied read-only out of production on 2026-09-03 with their real
 * category and severity. Everything else in the 2374-row lexicon is
 * irrelevant here, and the baseline assertion below is what proves that.
 */
const PRODUCTION_KEYWORDS = [
  ['代写', 'academic', 3], ['代考', 'academic', 3],
  ['换汇', 'currency', 3],
  ['贷款', 'financial', 2],
  ['办证', 'fraud', 3],
  ['刷单', 'spam', 3],
  ['QQ', 'lexicon', 2], ['不穿', 'lexicon', 2], ['专业代', 'lexicon', 2],
  ['代理', 'lexicon', 2], ['代购', 'lexicon', 2], ['傻逼', 'lexicon', 2],
  ['全套', 'lexicon', 2], ['全职', 'lexicon', 2], ['兼职', 'lexicon', 2],
  ['到货', 'lexicon', 2], ['助考', 'lexicon', 2], ['发票', 'lexicon', 2],
  ['强奸', 'lexicon', 2], ['微店', 'lexicon', 2], ['扣扣', 'lexicon', 2],
  ['招聘', 'lexicon', 2], ['有意者', 'lexicon', 2], ['淘宝', 'lexicon', 2],
  ['聯繫電', 'lexicon', 2], ['自拍', 'lexicon', 2], ['證件', 'lexicon', 2],
  ['辦證', 'lexicon', 2], ['限量', 'lexicon', 2], ['鸦片', 'lexicon', 2],
]

const SCHEMA = `
CREATE TABLE public.moderation_keywords (
  id         bigserial PRIMARY KEY,
  keyword    text NOT NULL,
  category   text NOT NULL DEFAULT 'generic',
  severity   smallint NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 3),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX moderation_keywords_kw_uniq
  ON public.moderation_keywords (LOWER(keyword));
CREATE ROLE anon;
CREATE ROLE authenticated;
`

/** pg_get_functiondef, production, 2026-09-03. Do not tidy: it is evidence. */
const PRODUCTION_FUNCTIONS = String.raw`
CREATE OR REPLACE FUNCTION public.content_moderation_normalize(raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT LOWER(
    regexp_replace(
      regexp_replace(
        normalize(COALESCE(raw, ''), NFKC),
        E'[\\s\\-\\._,。，、]+', '', 'g'),
      E'[\\u00AD\\u034F\\u061C\\u180E\\u200B-\\u200F\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\uFE00-\\uFE0F]', '', 'g'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.content_moderation_check(raw text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  norm   text;
  folded text;
  spaced text;
  kw     record;
BEGIN
  IF raw IS NULL OR length(raw) = 0 THEN
    RETURN NULL;
  END IF;

  norm   := public.content_moderation_normalize(raw);
  folded := LOWER(normalize(COALESCE(raw, ''), NFKC));
  spaced := regexp_replace(
    regexp_replace(
      regexp_replace(
        LOWER(normalize(COALESCE(raw, ''), NFKC)),
        E'[\\-\\._,。，、]+', '', 'g'),
      E'[\\u00AD\\u034F\\u061C\\u180E\\u200B-\\u200F\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\uFE00-\\uFE0F]', '', 'g'),
    E'\\s+', ' ', 'g');

  IF norm ~ '(?<![0-9])1[3-9][0-9]{9}(?![0-9])' THEN
    RETURN 'contact_info';
  END IF;
  IF folded ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' THEN
    RETURN 'contact_info';
  END IF;
  IF norm ~ '(微信|weixin|加v|加微|v信|v我)' THEN
    RETURN 'contact_info';
  END IF;
  IF spaced ~ '(?<![a-z])(wechat|vx)(?![a-z])' THEN
    RETURN 'contact_info';
  END IF;

  FOR kw IN
    SELECT LOWER(keyword) AS k
    FROM public.moderation_keywords
    WHERE active = true
  LOOP
    IF kw.k ~ '^[a-z0-9]{1,4}$' THEN
      IF folded ~ ('\y' || kw.k || '\y') THEN
        RETURN 'sensitive_word';
      END IF;
    ELSIF norm LIKE '%' || replace(replace(kw.k, '_', ''), ' ', '') || '%' THEN
      RETURN 'sensitive_word';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;
`

/**
 * 20260903023000, which this migration depends on and deliberately does not
 * repeat. Reproduced here (not read from disk) because it is in flight on its
 * own branch; the words are the ones its VALUES list names.
 */
const SIBLING_20260903023000 = `
UPDATE public.moderation_keywords
SET active = false
WHERE category = 'lexicon'
  AND active = true
  AND keyword IN (
    '不穿', '丝袜', '内裤', '代理', '代购', '到货', '全套', '全职', '兼职',
    '写真', '刺激', '和弦', '客服', '招聘', '本店', '淘宝', '网购', '网络',
    '火辣', '狗粮', '自拍', '限量', '铃声', '发票', '發票', '開票', '起诉',
    '死刑', '崩盘', '咪咪'
  );
`

// ---------------------------------------------------------------------------

function sqlLiteral(value) {
  const body = [...value].map(char => {
    const code = char.codePointAt(0)
    if (char === "'") return "\\'"
    if (char === '\\') return '\\\\'
    if (code < 0x20) return `\\u${code.toString(16).padStart(4, '0')}`
    return char
  }).join('')
  return `E'${body}'`
}

const VERDICT_QUERY = `
SELECT v.id, COALESCE(public.content_moderation_check(v.t), 'null')
FROM (VALUES
${ALL_ROWS.map(([id, text]) => `  (${sqlLiteral(id)}, ${sqlLiteral(text)})`).join(',\n')}
) AS v(id, t)
ORDER BY v.id;
`

const pgBin = findPgBin()
const MIGRATION_SQL = pgBin ? readFileSync(MIGRATION, 'utf8') : ''
const MIGRATION_20260904060000_SQL = pgBin
  ? readFileSync(MIGRATION_20260904060000, 'utf8')
  : ''

describe('moderation policy: contact info allowed, ads caught in four layers', {
  skip: pgBin ? false : 'no local initdb (PostgreSQL 17) — nothing to run against',
  concurrency: 1,
}, () => {
  let clusterDir = null

  function psql(sql) {
    return execFileSync(path.join(pgBin, 'psql'), [
      '-X', '--quiet', '--tuples-only', '--no-align', '--field-separator=\t',
      '--set=ON_ERROR_STOP=1', '-d', 'postgres',
    ], {
      input: `SET client_min_messages = warning;\n${sql}`,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        PGHOST: clusterDir,
        PGUSER: 'postgres',
        PGDATABASE: 'postgres',
        PGCLIENTENCODING: 'UTF8',
        PGPASSFILE: path.join(clusterDir, 'no-pgpass'),
        PGSERVICEFILE: path.join(clusterDir, 'no-pgservice'),
        PGCONNECT_TIMEOUT: '10',
      },
      maxBuffer: 8 * 1024 * 1024,
    })
  }

  /** id -> verdict ('null' when the text is allowed). */
  function verdicts() {
    const out = psql(VERDICT_QUERY)
    const map = new Map()
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const [id, verdict] = line.split('\t')
      map.set(id, verdict)
    }
    assert.equal(map.size, ALL_ROWS.length, 'the corpus did not come back whole')
    return map
  }

  const blocked = (map, ids) => ids.filter(id => map.get(id) !== 'null')

  before(() => {
    clusterDir = mkdtempSync(path.join(tmpdir(), 'caaci-moderation-'))
    const data = path.join(clusterDir, 'data')
    const locales = ['en_US.UTF-8', 'C.UTF-8', 'zh_CN.UTF-8', null]
    let started = false
    let lastError = null
    for (const locale of locales) {
      try {
        execFileSync(path.join(pgBin, 'initdb'), [
          '-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-sync',
          ...(locale ? ['--locale', locale] : []),
        ], { stdio: 'pipe' })
        started = true
        break
      } catch (error) {
        lastError = error
        rmSync(data, { recursive: true, force: true })
      }
    }
    if (!started) throw lastError

    execFileSync(path.join(pgBin, 'pg_ctl'), [
      '-D', data, '-w', '-l', path.join(clusterDir, 'log'),
      '-o', `-c listen_addresses='' -k ${clusterDir}`, 'start',
    ], { stdio: 'pipe' })

    psql(SCHEMA)
    psql(`INSERT INTO public.moderation_keywords (keyword, category, severity) VALUES\n${
      PRODUCTION_KEYWORDS
        .map(([kw, category, severity]) => `  (${sqlLiteral(kw)}, '${category}', ${severity})`)
        .join(',\n')};`)
    psql(PRODUCTION_FUNCTIONS)
  })

  after(() => {
    if (!clusterDir) return
    try {
      execFileSync(path.join(pgBin, 'pg_ctl'), [
        '-D', path.join(clusterDir, 'data'), '-m', 'immediate', 'stop',
      ], { stdio: 'pipe' })
    } catch { /* the cluster is disposable; the directory goes either way */ }
    rmSync(clusterDir, { recursive: true, force: true })
  })

  // -- baseline: prove the harness is production ----------------------------

  it('reproduces production 2026-09-03: 25 of 45 variants and 9 of 21 benign sentences refused', () => {
    const map = verdicts()

    const variantsBlocked = blocked(map, VARIANTS.map(([id]) => id))
    assert.equal(
      variantsBlocked.length, 25,
      `expected production's 25 of 45, got ${variantsBlocked.length}: ${variantsBlocked.join(' ')}`,
    )
    // BENIGN only: BENIGN_INTENT is about a rule that did not exist yet, and
    // this assertion is a fixed historical reproduction.
    const benignBlocked = blocked(map, BENIGN.map(([id]) => id))
    assert.deepEqual(
      benignBlocked,
      ['benign01', 'benign02', 'benign03', 'benign04', 'benign05',
        'benign06', 'benign07', 'benign08', 'benign09'],
      'the 9 wrongly-refused benign sentences are not the ones production refuses',
    )

    // Which rule did the refusing matters: most of the interesting evasions
    // were only caught because the ad carried a handle.
    const byContactRule = variantsBlocked.filter(id => map.get(id) === 'contact_info')
    assert.deepEqual(
      byContactRule.sort(),
      ['ad18', 'ad22', 'ad23', 'ad31', 'ad32', 'ad34', 'contact4'],
      'the contact rules are not catching what they caught in production',
    )
  })

  // -- after the change -----------------------------------------------------

  describe('after 20260903023000 and 20260903060000', () => {
    let map = null

    before(() => {
      psql(SIBLING_20260903023000)
      psql(MIGRATION_SQL)
      psql(MIGRATION_20260904060000_SQL)
      map = verdicts()
    })

    it('refuses every one of the 40 ads', () => {
      const ads = VARIANTS.filter(([, isAd]) => isAd).map(([id]) => id)
      const missed = ads.filter(id => map.get(id) === 'null')
      assert.deepEqual(missed, [], `${missed.length} ads got through: ${missed.join(' ')}`)
      assert.equal(ads.length, 40)
    })

    it('allows a text that is only a contact handle', () => {
      for (const [id, isAd, text] of VARIANTS) {
        if (isAd) continue
        assert.equal(map.get(id), 'null', `${id} (${text}) is a handle, not an ad`)
      }
    })

    it('refuses none of the 21 benign secondhand sentences', () => {
      const refused = blocked(map, BENIGN.map(([id]) => id))
      assert.deepEqual(refused, [], `still refusing: ${refused.join(' ')}`)
    })

    /*
     * 20260903060000 shipped layer 4 with eight signals that are ordinary
     * listing copy — 需要的, 长期, 靠谱, 当天, 一手, 详谈, bare 咨询, 可私 —
     * and the rule fires on a noun and a signal anywhere in the same text. It
     * put three of the sentences 20260903023000 had just un-broken straight
     * back, and worse: the client mirror carries none of these rules, so the
     * composer accepts the text and every photo uploads before the trigger
     * refuses, with copy that names no word.
     */
    it('refuses none of the listings that merely contain a noun and a signal', () => {
      const refused = blocked(map, BENIGN_INTENT.map(([id]) => id))
      assert.deepEqual(refused, [], `layer 4 is still catching ordinary listings: ${refused.join(' ')}`)
      assert.ok(BENIGN_INTENT.length >= 6, 'lost the corpus that exercises layer 4 at all')
    })

    it('every block is still sensitive_word, so the triggers and the copy keep working', () => {
      const verdictValues = new Set([...map.values()])
      assert.deepEqual([...verdictValues].sort(), ['null', 'sensitive_word'])
    })

    it('keeps the controls: profanity blocked, everyday words and contact info allowed', () => {
      assert.deepEqual(
        ['block1', 'block2', 'block3'].map(id => map.get(id)),
        ['sensitive_word', 'sensitive_word', 'sensitive_word'],
      )
      for (const [id, text] of CONTROLS) {
        if (id.startsWith('block')) continue
        assert.equal(map.get(id), 'null', `${id} (${text}) must be allowed`)
      }
    })
  })

  // -- mutations: show each layer is load-bearing ---------------------------

  describe('mutations', () => {
    // Both migrations are idempotent, so re-applying makes this suite
    // independent of the one above rather than a continuation of it.
    before(() => {
      psql(SIBLING_20260903023000)
      psql(MIGRATION_SQL)
      psql(MIGRATION_20260904060000_SQL)
    })

    it('reverting the traditional fold loses exactly the traditional-only ads', () => {
      psql(`CREATE OR REPLACE FUNCTION public.content_moderation_fold_han(raw text)
            RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
            AS $$ SELECT COALESCE(raw, '') $$;`)
      const mutated = verdicts()
      const lost = VARIANTS
        .filter(([, isAd]) => isAd)
        .map(([id]) => id)
        .filter(id => mutated.get(id) === 'null')
      // ad40 (ＪＩＡＮＺＨＩ 日結 招人) joined this set in 20260904060000: with
      // jianzhi moved from a bare keyword to an intent noun it needs two
      // signals, and without the fold 日結 never becomes 日结.
      assert.deepEqual(lost, ['ad10', 'ad13', 'ad14', 'ad15', 'ad40'])
      psql(MIGRATION_SQL)
      psql(MIGRATION_20260904060000_SQL)
    })

    it('emptying the intent table loses exactly the pair-only ads', () => {
      psql('UPDATE public.moderation_intent_rules SET active = false;')
      const mutated = verdicts()
      const lost = VARIANTS
        .filter(([, isAd]) => isAd)
        .map(([id]) => id)
        .filter(id => mutated.get(id) === 'null')
      // ad31/ad32/ad40 joined this set in 20260904060000. Their keywords —
      // 戴考, 黛购, jianzhi — were bare substrings that also matched 戴考虑一下,
      // 黛购物袋 and the name Jian Zhi, so they became intent nouns instead and
      // now depend on this table like the other pair-only ads.
      assert.deepEqual(
        lost,
        ['ad02', 'ad09', 'ad13', 'ad16', 'ad18', 'ad19', 'ad20', 'ad21',
          'ad30', 'ad31', 'ad32', 'ad33', 'ad35', 'ad37', 'ad40'],
      )
      psql('UPDATE public.moderation_intent_rules SET active = true;')
    })

    it('putting the WeChat rule back refuses contact info again', () => {
      psql(PRODUCTION_FUNCTIONS.slice(PRODUCTION_FUNCTIONS.indexOf('CREATE OR REPLACE FUNCTION public.content_moderation_check')))
      const mutated = verdicts()
      const refused = ['contact4', 'contactctl1', 'contactctl2', 'contactctl3', 'contactctl4']
      for (const id of refused) {
        assert.equal(mutated.get(id), 'contact_info', `${id} should be refused again`)
      }
      psql(MIGRATION_SQL)
      psql(MIGRATION_20260904060000_SQL)
    })
  })
})
