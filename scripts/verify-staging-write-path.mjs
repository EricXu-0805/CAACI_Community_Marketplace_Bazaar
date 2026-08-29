#!/usr/bin/env node
/**
 * Can a real signed-in user actually publish, and is the gate still shut?
 *
 * Everything a beta student does is a write, and until now nothing exercised
 * one. The 17 Playwright specs sign in and sweep pages; the file itself says
 * "Read-only; no writes." scripts/verify-deployed-rpcs.mjs proves the functions
 * the client calls exist, which is a different question from whether a write
 * survives the policies and triggers stacked on top of them.
 *
 * One INSERT into public.items crosses, in order:
 *
 *   RLS "Authenticated users can create items"  auth.uid() = user_id
 *   authoritative_public_write_boundary          payload shape
 *   enforce_actor_items                          actor identity
 *   moderate_items                               content_moderation_check
 *   trg_block_currency_exchange                  category
 *   trg_rl_items_before_insert                   10/hour, 30/day, no dupe title
 *
 * Any one of those can be broken by a migration that never reached this
 * database, and the only symptom is that nobody can post. That is exactly what
 * happened in production: moderate_items refused "Selling my TV, Xbox and a
 * desk" for weeks because two latin keywords were matched against the copy with
 * every space removed. It was found by reading a migration comment, not by any
 * check. This runs that sentence through the real trigger.
 *
 * TWO ASSERTIONS, NOT ONE
 * -----------------------
 * A test that only proves "a write lands" passes just as well with moderation
 * deleted. So the ordinary listing must be accepted AND an obvious evasion must
 * still be refused. The second is the one that keeps the first honest.
 *
 * WHY IT CANNOT TOUCH PRODUCTION
 * ------------------------------
 * Three independent refusals, following app/e2e/hosted/realtime-contract.ts:
 * the target ref must equal the reviewed staging ref, must not be a known
 * production ref, and the operator must have attested that both the account and
 * the dataset are synthetic. A privileged key anywhere in the environment is
 * also refused — this has to run as an ordinary user or it proves nothing about
 * RLS.
 *
 * WHAT IT LEAVES BEHIND
 * ---------------------
 * Nothing. The row is hard-deleted in the same run, which also releases it from
 * the hourly rate-limit window, so repeated runs neither accumulate rows nor
 * walk into 'rate_limit_items_hour'. Any row a killed run left behind is swept
 * by prefix before this one starts.
 *
 * Usage:  node scripts/verify-staging-write-path.mjs
 */

/** Public identifiers, not credentials. An independent deny that survives an
 *  operator making every other expected value self-consistent. */
export const KNOWN_PRODUCTION_PROJECT_REFS = new Set(['lfhvgprfphyfvhidegum'])

/** Present in the environment only when someone is holding more power than this
 *  check may use. Running as service_role would bypass the RLS it exists to
 *  prove. */
export const FORBIDDEN_ENV_KEYS = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
]

/** Every row this check creates starts with it, so a sweep can find strays. */
export const TITLE_PREFIX = '[ci write-path]'

/**
 * The sentence production refused. Keeping the real one means this check is a
 * live regression guard on 20260818162716 rather than a generic smoke test.
 */
export const ACCEPTED_TITLE = `${TITLE_PREFIX} Selling my TV, Xbox and a desk`

/** An evasion nobody should be able to post. The control. */
export const REFUSED_TITLE = `${TITLE_PREFIX} add me on wechat`

export const DESCRIPTION = 'Created by the CI write-path check and deleted moments later.'

/**
 * Refuse to run anywhere but the reviewed synthetic staging project.
 * Returns the project ref; throws with the reason it refused.
 */
export function assertSafeTarget(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''
  const expectedRef = env.SMOKE_EXPECTED_SUPABASE_PROJECT_REF || ''

  for (const key of FORBIDDEN_ENV_KEYS) {
    if (env[key]) {
      throw new Error(`${key} is set. This must run as an ordinary signed-in user, `
        + 'or it proves nothing about the policies a real user meets.')
    }
  }
  if (!/^[a-z0-9]{20}$/.test(expectedRef)) {
    throw new Error('SMOKE_EXPECTED_SUPABASE_PROJECT_REF is missing or not a project ref.')
  }
  if (KNOWN_PRODUCTION_PROJECT_REFS.has(expectedRef)) {
    throw new Error(`${expectedRef} is a production project. This check writes rows; it never runs there.`)
  }
  if (url !== `https://${expectedRef}.supabase.co`) {
    throw new Error('SUPABASE_URL does not match the reviewed staging project ref.')
  }
  if (env.SMOKE_ACCOUNT_IS_SYNTHETIC !== 'true' || env.SMOKE_DATASET_IS_SYNTHETIC !== 'true') {
    throw new Error('The synthetic account/dataset attestation is incomplete. '
      + 'This check publishes and deletes a listing; it only runs against data nobody owns.')
  }
  if (!env.SMOKE_EMAIL || !env.SMOKE_PASSWORD) {
    throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required.')
  }
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY
    || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  if (!key) throw new Error('A public Supabase key is required.')
  return { url, key, ref: expectedRef }
}

/**
 * The moderation trigger raises `moderation_block:<category>` as a bare
 * RAISE EXCEPTION, which PostgREST returns as 400 with that text in `message`.
 *
 * Matching the sentinel rather than merely "the insert failed" matters: a
 * revoked grant, a broken RLS policy and a tripped rate limit all fail too, and
 * treating those as "the gate works" would hide the gate being gone.
 */
export function moderationRefusal(status, body) {
  const message = String(body?.message || '')
  if (!message.startsWith('moderation_block:')) return null
  return { status, category: message.slice('moderation_block:'.length) }
}

/** Titles carry a per-run suffix: the rate limiter rejects a repeat within 60s. */
export function uniqueTitles(runId) {
  return { accepted: `${ACCEPTED_TITLE} ${runId}`, refused: `${REFUSED_TITLE} ${runId}` }
}

/* ------------------------------------------------------------------ client */

function rest(url, key, token, path, init = {}) {
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

async function readJson(response) {
  try { return await response.json() } catch { return null }
}

async function signIn(url, key, email, password) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await readJson(response)
  if (!response.ok) {
    // Never echo the body: it is an auth response.
    throw new Error(`sign-in failed with HTTP ${response.status}`)
  }
  const token = body?.access_token
  const userId = body?.user?.id
  if (!token || !userId) throw new Error('sign-in returned no session')
  return { token, userId }
}

async function signOut(url, key, token) {
  try {
    await fetch(`${url}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    })
  } catch {
    // A session left open is untidy, not a reason to fail the check. The
    // sweep at the start of the next run is what keeps this database clean.
  }
}

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

async function main() {
  let target
  try {
    target = assertSafeTarget(process.env)
  } catch (error) {
    fail(error.message)
    return
  }
  const { url, key } = target
  const runId = String(Date.now())
  const titles = uniqueTitles(runId)

  const { token, userId } = await signIn(url, key, process.env.SMOKE_EMAIL, process.env.SMOKE_PASSWORD)
  const expectedUserId = (process.env.SMOKE_EXPECTED_USER_ID || '').toLowerCase()
  if (expectedUserId && userId.toLowerCase() !== expectedUserId) {
    await signOut(url, key, token)
    fail('signed in as a different account than the reviewed synthetic user.')
    return
  }

  let created = null
  let cleanupFailed = false
  try {
    // Sweep anything a killed run left behind, so its rows cannot age into the
    // rate-limit window and fail this one for the wrong reason.
    const swept = await rest(url, key, token,
      `items?user_id=eq.${userId}&title=like.${encodeURIComponent(`${TITLE_PREFIX}%`)}`,
      { method: 'DELETE', headers: { Prefer: 'return=representation' } })
    const sweptRows = await readJson(swept)
    if (Array.isArray(sweptRows) && sweptRows.length) {
      console.warn(`⚠ swept ${sweptRows.length} row(s) left by an earlier run`)
    }

    // 1. An ordinary listing must land.
    const insert = await rest(url, key, token, 'items', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        title: titles.accepted,
        description: DESCRIPTION,
        price: 25,
        category: 'other',
        condition: 'good',
      }),
    })
    const insertBody = await readJson(insert)
    if (!insert.ok) {
      const refusal = moderationRefusal(insert.status, insertBody)
      if (refusal) {
        throw new Error(`the moderation gate refused an ordinary listing as '${refusal.category}'. `
          + `Title: ${titles.accepted}. This is the 20260818162716 failure shape — a latin `
          + 'keyword matching against the separator-stripped copy. Nobody can post.')
      }
      throw new Error(`publishing failed with HTTP ${insert.status}: `
        + `${insertBody?.message || '(no message)'}. A policy, grant or trigger on `
        + 'public.items is not what this client expects.')
    }
    created = Array.isArray(insertBody) ? insertBody[0] : insertBody
    if (!created?.id) throw new Error('the insert returned no row')
    console.log(`✓ published a listing through the real policies and triggers (${created.id})`)

    // 2. The gate must still be shut. Without this, deleting moderation
    //    entirely would leave the check above passing.
    const blocked = await rest(url, key, token, 'items', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        title: titles.refused,
        description: DESCRIPTION,
        price: 25,
        category: 'other',
        condition: 'good',
      }),
    })
    if (blocked.ok) {
      const stray = await readJson(blocked)
      const strayId = (Array.isArray(stray) ? stray[0] : stray)?.id
      if (strayId) {
        await rest(url, key, token, `items?id=eq.${strayId}`, { method: 'DELETE' })
      }
      throw new Error(`the moderation gate accepted "${titles.refused}". Contact-info `
        + 'evasion is no longer refused on this database.')
    }
    const refusal = moderationRefusal(blocked.status, await readJson(blocked))
    if (!refusal) {
      throw new Error(`the evasion was rejected with HTTP ${blocked.status}, but not by the `
        + 'moderation gate. Something else refused it, so this run says nothing about '
        + 'whether the gate works.')
    }
    console.log(`✓ contact-info evasion still refused as '${refusal.category}'`)
  } finally {
    if (created?.id) {
      const removed = await rest(url, key, token, `items?id=eq.${created.id}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=representation' },
      })
      const removedRows = await readJson(removed)
      if (!removed.ok || !Array.isArray(removedRows) || removedRows.length !== 1) {
        // Reported, not thrown: a failure already in flight is the more useful
        // one to surface, and the next run sweeps this row by prefix.
        console.error(`✖ could not delete ${created.id} (HTTP ${removed.status}) — still on staging`)
        cleanupFailed = true
      } else {
        console.log('✓ withdrew the listing; nothing left behind')
      }
    }
    await signOut(url, key, token)
  }

  if (cleanupFailed) throw new Error('the listing could not be withdrawn from staging')
  console.log('✓ a real user can publish on this database, and the gate is still shut')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => fail(error?.message || String(error)))
}
