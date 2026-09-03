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
 * THE LISTING CARRIES A PHOTO
 * ---------------------------
 * A text-only listing leaves the whole media path unproven, and a marketplace
 * of listings with no pictures is not one anybody uses. Attaching one crosses a
 * second, independent stack:
 *
 *   storage "Authenticated users can upload to own folder"   items/<uid>/…
 *   account_deletion_tombstone_blocks_item_image_insert      tombstone check
 *   private.assert_local_media_array                         URL shape, and the
 *                                                            object must exist
 *   private.public_write_request_origin                      the JWT iss claim
 *   private.assert_image_dimensions                          one entry per image
 *
 * public_write_request_origin returns NULL for any issuer that is not
 * `https://<ref>.supabase.co/auth/v1`, and assert_local_media_array turns that
 * NULL into item_images_issuer_unverifiable. So a deployment can reach the
 * state where publishing text works for everyone and publishing a photo works
 * for nobody, with nothing else to see. Only a real upload finds that.
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
 * walk into 'rate_limit_items_hour'. The uploaded object is deleted with it.
 * Rows and objects a killed run left behind are swept by prefix before this one
 * starts.
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
 * The sentence production refused. Its latin letters close up into other words
 * once content_moderation_check strips the separators — 'TV, Xbox' becomes
 * 'tvxbox' — which is how the trigger came to refuse anyone selling a console
 * (20260818162716). Keeping a real sentence of that shape means this check is a
 * live regression guard on the stripped-copy matcher, not a generic smoke test.
 */
export const ACCEPTED_TITLE = `${TITLE_PREFIX} Selling my TV, Xbox and a desk`

/**
 * A term the keyword lexicon blocks. The control: a check that only proves "a
 * listing lands" passes just as well against a database whose moderation
 * trigger has been dropped. Contact details became publishable on 2026-09-03,
 * so the previous probe ('add me on wechat') is now an ordinary listing and
 * would have turned this control green with no gate at all.
 */
export const REFUSED_TITLE = `${TITLE_PREFIX} cannabis for sale`

export const DESCRIPTION = 'Created by the CI write-path check and deleted moments later.'

/** The bucket every listing photo lives in. */
export const MEDIA_BUCKET = 'item-images'

/** Every object this check uploads starts with it, so a sweep can find strays. */
export const OBJECT_PREFIX = 'ci-write-path-'

/**
 * A 1x1 PNG, 69 bytes. The point is to cross the policies, not to test an
 * encoder, and assert_image_dimensions accepts w/h of 1.
 */
export const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM40W0FAAOsAY61GfG3AAAAAElFTkSuQmCC'

/**
 * Not a user on any database — the folder an upload must be refused from. A
 * check that only proves "an upload lands" passes just as well with the folder
 * clause deleted from the storage policy.
 */
export const FOREIGN_OWNER = '00000000-0000-4000-8000-000000000000'

/** The path the app itself writes: items/<owner>/<file>. */
export function mediaObjectName(owner, runId) {
  return `items/${owner}/${OBJECT_PREFIX}${runId}.png`
}

/**
 * The canonical public URL. private.local_item_media_object_name parses exactly
 * this shape back out and rejects render URLs, query strings and fragments, so
 * the listing insert only accepts a URL built this way.
 */
export function publicMediaUrl(url, objectName) {
  return `${url}/storage/v1/object/public/${MEDIA_BUCKET}/${objectName}`
}

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

function storage(url, key, token, path, init = {}) {
  return fetch(`${url}/storage/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
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

/**
 * Objects a killed run left behind. Unlike rows these do not expire, and the
 * listing insert refuses a duplicate URL, so they would accumulate silently.
 */
async function sweepObjects(url, key, token, userId) {
  const listed = await storage(url, key, token, `object/list/${MEDIA_BUCKET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: `items/${userId}/`, limit: 100 }),
  })
  if (!listed.ok) {
    console.warn(`⚠ could not list ${MEDIA_BUCKET} to sweep (HTTP ${listed.status})`)
    return
  }
  const entries = await readJson(listed)
  if (!Array.isArray(entries)) return
  const folder = `items/${userId}/`
  const strays = entries
    .map(entry => entry?.name)
    .filter(name => typeof name === 'string')
    // Supabase returns names relative to the prefix. Tolerate the absolute form
    // too: guessing wrong here would silently sweep nothing.
    .map(name => (name.startsWith(folder) ? name.slice(folder.length) : name))
    .filter(name => name.startsWith(OBJECT_PREFIX))
  for (const name of strays) {
    await storage(url, key, token, `object/${MEDIA_BUCKET}/${folder}${name}`,
      { method: 'DELETE' })
  }
  if (strays.length) console.warn(`⚠ swept ${strays.length} object(s) left by an earlier run`)
}

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

/**
 * Exported so scripts/staging-write-path-contract.test.mjs can drive the whole
 * sequence against a stubbed fetch. The steps only ever run for real on main
 * (the protected-account job is skipped on pull requests), so without this the
 * cleanup path would ship unexecuted — which is how a `process.exit()` inside
 * the try block once skipped the finally and left a listing on staging.
 */
export async function main() {
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

  const objectName = mediaObjectName(userId, runId)
  const mediaUrl = publicMediaUrl(url, objectName)
  const pixel = Buffer.from(PIXEL_PNG_BASE64, 'base64')

  let created = null
  let uploaded = false
  let strayObject = null
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
    await sweepObjects(url, key, token, userId)

    // 1. A photo must upload into the user's own folder.
    const upload = await storage(url, key, token, `object/${MEDIA_BUCKET}/${objectName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: pixel,
    })
    if (!upload.ok) {
      const body = await readJson(upload)
      throw new Error(`uploading a listing photo failed with HTTP ${upload.status}: `
        + `${body?.message || body?.error || '(no message)'}. Either the storage policy on `
        + `${MEDIA_BUCKET} no longer accepts items/<uid>/, or the account-deletion `
        + 'tombstone check refuses this account. Nobody can attach a photo.')
    }
    uploaded = true
    console.log(`✓ uploaded a listing photo to ${objectName}`)

    // 2. It must be readable with no session at all: every card thumbnail and
    //    every share card's og:image is an anonymous GET of exactly this URL.
    const publicRead = await fetch(mediaUrl)
    const contentType = publicRead.headers.get('content-type') || ''
    if (!publicRead.ok || !contentType.startsWith('image/')) {
      throw new Error(`the uploaded photo is not publicly readable: HTTP ${publicRead.status} `
        + `content-type '${contentType}'. Thumbnails and share previews are anonymous GETs `
        + `of ${MEDIA_BUCKET}; if the bucket stopped being public they are all broken.`)
    }
    console.log(`✓ the photo is readable with no session (${contentType})`)

    // 3. Another user's folder must refuse it. Without this, deleting the
    //    folder clause from the storage policy would leave step 1 passing.
    const foreignName = mediaObjectName(FOREIGN_OWNER, runId)
    const foreign = await storage(url, key, token, `object/${MEDIA_BUCKET}/${foreignName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: pixel,
    })
    if (foreign.ok) {
      strayObject = foreignName
      throw new Error(`the storage policy accepted an upload into ${foreignName}. Any signed-in `
        + "user can write into another user's photo folder.")
    }
    console.log(`✓ an upload into another user's folder is still refused (HTTP ${foreign.status})`)

    // 4. An ordinary listing carrying that photo must land.
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
        images: [mediaUrl],
        image_dimensions: [{ w: 1, h: 1 }],
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
      const message = String(insertBody?.message || '')
      if (message.startsWith('public_write_boundary:item_image')) {
        throw new Error(`the write boundary refused the listing's own photo as '${message}'. `
          + `The object is uploaded and publicly readable at ${mediaUrl}, so the disagreement `
          + 'is between the database and the URL the app builds — issuer origin, folder shape '
          + 'or dimensions. Publishing text still works; publishing a photo does not.')
      }
      throw new Error(`publishing failed with HTTP ${insert.status}: `
        + `${insertBody?.message || '(no message)'}. A policy, grant or trigger on `
        + 'public.items is not what this client expects.')
    }
    created = Array.isArray(insertBody) ? insertBody[0] : insertBody
    if (!created?.id) throw new Error('the insert returned no row')
    console.log(`✓ published a listing with its photo through the real policies and `
      + `triggers (${created.id})`)

    // 5. The gate must still be shut. Without this, deleting moderation
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
      throw new Error(`the moderation gate accepted "${titles.refused}". A blocklisted `
        + 'term is no longer refused on this database.')
    }
    const refusal = moderationRefusal(blocked.status, await readJson(blocked))
    if (!refusal) {
      throw new Error(`the probe was rejected with HTTP ${blocked.status}, but not by the `
        + 'moderation gate. Something else refused it, so this run says nothing about '
        + 'whether the gate works.')
    }
    if (!refusal.category.endsWith(':sensitive_word')) {
      throw new Error(`the gate refused as '${refusal.category}', not the lexicon branch this `
        + 'probe aims at. Some other rule caught it first, so the run says nothing about '
        + 'whether the keyword lexicon still works.')
    }
    console.log(`✓ a blocklisted term is still refused as '${refusal.category}'`)
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
        console.log('✓ withdrew the listing')
      }
    }
    if (uploaded) {
      const dropped = await storage(url, key, token, `object/${MEDIA_BUCKET}/${objectName}`,
        { method: 'DELETE' })
      if (!dropped.ok) {
        console.error(`✖ could not delete ${objectName} (HTTP ${dropped.status}) — still on staging`)
        cleanupFailed = true
      } else {
        console.log('✓ removed the photo; nothing left behind')
      }
    }
    if (strayObject) {
      // Only reachable when the folder clause is already gone, and the DELETE
      // policy carries the same clause — so this usually cannot be undone from
      // here. Say so rather than report a clean run.
      const dropped = await storage(url, key, token, `object/${MEDIA_BUCKET}/${strayObject}`,
        { method: 'DELETE' })
      console.error(dropped.ok
        ? `⚠ removed ${strayObject}, which should never have been writable`
        : `✖ ${strayObject} was written into another user's folder and cannot be deleted `
          + `from this account (HTTP ${dropped.status})`)
      if (!dropped.ok) cleanupFailed = true
    }
    await signOut(url, key, token)
  }

  if (cleanupFailed) throw new Error('staging was not left as it was found')
  console.log('✓ a real user can publish a listing with a photo, and the gate is still shut')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => fail(error?.message || String(error)))
}
