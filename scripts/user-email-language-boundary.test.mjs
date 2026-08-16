// Per-user email language: the ACL shape of the preference store, and the
// deploy-order tolerance the two senders need.
//
// The table is deliberately NOT a column on public.profiles. get_my_profile()
// returns public.profiles, so PG17 deparses the Plaza RLS policies with the
// table's full composite alias, which 20260719151729 pins as a 33-column
// literal and whose bytes are frozen. Widening profiles would leave the _ops
// PRECHECK/VERIFY diagnostics failing against production forever after.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const url = rel => new URL(`../${rel}`, import.meta.url)
const read = rel => readFile(url(rel), 'utf8')

const MIGRATION = 'supabase/migrations/20260815185833_user_email_language.sql'
const SENDERS = ['api/notification-digest.js', 'api/meetup-notify.js']

test('the preference store grants nothing to anon or authenticated', async () => {
  const sql = await read(MIGRATION)

  // REVOKE FROM PUBLIC alone is not enough on this stack — anon and
  // authenticated hold grants in their own right (the durable 064/069 lesson).
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON TABLE public\\.user_email_prefs FROM ${role};`),
      `table privileges are not revoked from ${role}`,
    )
  }
  assert.doesNotMatch(
    sql,
    /GRANT[^;]*ON TABLE public\.user_email_prefs/,
    'the table must have no direct grants: the RPC is the only write path',
  )
  assert.match(sql, /ALTER TABLE public\.user_email_prefs ENABLE ROW LEVEL SECURITY;/)
  assert.match(sql, /ALTER TABLE public\.user_email_prefs FORCE ROW LEVEL SECURITY;/)
})

test('the write RPC derives its row from auth.uid() and is execute-gated', async () => {
  const sql = await read(MIGRATION)

  assert.match(sql, /SECURITY DEFINER/)
  assert.match(sql, /SET search_path = public, pg_temp/)
  // The row must come from auth.uid(), never from an argument — otherwise the
  // RPC becomes a way to set another account's language.
  assert.match(sql, /v_uid uuid := auth\.uid\(\);/)
  assert.match(sql, /VALUES \(v_uid, p_lang, now\(\)\)/)
  assert.doesNotMatch(sql, /p_user_id|p_uid/, 'the RPC must not accept a target user')
  // An unknown language is rejected, not coerced to a default.
  assert.match(sql, /p_lang NOT IN \('zh', 'en'\)/)

  for (const role of ['PUBLIC', 'anon']) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.set_my_email_language\\(text\\) FROM ${role};`),
      `EXECUTE is not revoked from ${role}`,
    )
  }
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.set_my_email_language\(text\) TO authenticated;/,
  )
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/)
})

test('both senders survive the window where the table does not exist yet', async () => {
  // Merging to main deploys these handlers and applies no migration, so between
  // the merge and the apply the lookup 404s. A meetup confirmation is worth far
  // more than its own language: the lookup must fail soft to bilingual.
  for (const rel of SENDERS) {
    const source = await read(rel)
    const lookup = source.indexOf('user_email_prefs')
    assert.notEqual(lookup, -1, `${rel} never reads the preference`)

    const guarded = /try \{[\s\S]{0,600}?user_email_prefs[\s\S]{0,600}?\} catch/.test(source)
    assert.ok(guarded, `${rel} reads user_email_prefs outside a try/catch`)
  }
})

const CJK = /[一-鿿]/
const LATIN = /[A-Za-z]/

// copyFor is a pure string table with no imports, so lifting it out and calling
// it is both possible and far less brittle than pattern-matching a ternary
// chain that legitimately nests ternaries inside its own strings.
async function loadCopyFor(rel) {
  const source = await read(rel)
  const start = source.indexOf('function copyFor(lang)')
  assert.notEqual(start, -1, `${rel} has no copyFor`)
  const body = source.slice(start, start + source.slice(start).indexOf('\n}\n') + 3)
  return new Function(`${body}\nreturn copyFor`)()
}

test('an unknown language renders exactly the bilingual email that shipped before', async () => {
  // Nobody has a stored preference on day one. If the fallback drifted, the
  // rollout would silently change every recipient's email instead of none.
  const KIND = { title: '新的见面提议 · Meetup proposed', titleZh: '新的见面提议', titleEn: 'Meetup proposed' }

  for (const rel of SENDERS) {
    const copyFor = await loadCopyFor(rel)
    const render = (lang) => Object.values(copyFor(lang)).map(value => (
      typeof value === 'function'
        ? String(rel.includes('meetup') ? value(KIND) : value(2))
        : String(value)
    ))

    // Bilingual is a property of the rendered email, not of each string: the
    // unsubscribe line has always been a Chinese prompt followed by a
    // `一键退订 Unsubscribe` link, so neither half carries both scripts alone.
    const fallback = render(null).join(' ')
    assert.ok(CJK.test(fallback) && LATIN.test(fallback),
      `${rel} is not bilingual for a reader who never chose a language`)
    assert.ok(
      render(null).some(text => CJK.test(text) && LATIN.test(text)),
      `${rel} fallback reads as two monolingual halves rather than bilingual copy`,
    )
    // Per entry: whenever the two languages actually differ, the fallback must
    // not have collapsed onto the English one. That is the shape a dropped
    // third arm takes — `zh ? '打开集市' : 'Open Illini Market'` reads fine until
    // you notice every reader who never chose a language now gets English.
    const [nul, zh, en] = [render(null), render('zh'), render('en')]
    for (const [i, english] of en.entries()) {
      if (english === zh[i]) continue
      assert.notEqual(
        nul[i], english,
        `${rel} entry ${i} lost its unknown-language arm: a reader who never `
          + `chose a language now gets the English-only "${english}"`,
      )
    }
    for (const [i, text] of render('en').entries()) {
      assert.ok(!CJK.test(text), `${rel} entry ${i} leaks Chinese into an English email: "${text}"`)
    }
    for (const [i, text] of render('zh').entries()) {
      assert.ok(CJK.test(text), `${rel} entry ${i} has no Chinese in a Chinese email: "${text}"`)
    }

    assert.match(await read(rel), /lang = null/, `${rel} must default lang to null, not to a language`)
  }
})
