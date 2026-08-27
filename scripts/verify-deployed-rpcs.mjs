#!/usr/bin/env node
/**
 * Does the deployed database actually have the RPCs this client calls?
 *
 * Merging a PR pushes the frontend. Nothing pushes `supabase/migrations/`, so a
 * release whose client depends on a new function ships the caller and leaves
 * the callee behind, and nothing says so. That has now happened twice:
 *
 *   2026-08-06  the consent constant advanced to 2026-08-01 while production's
 *               record_consent still accepted only 2026-07-18. Every existing
 *               and new user hit 400 on "I agree" and could not get in. Hours,
 *               nobody alerted.
 *   2026-08-16  set_my_email_language landed in the repo and in production but
 *               never in staging. main's authenticated smoke has been red ever
 *               since, as two anonymous `404` lines inside a console-error
 *               assertion — true, but it took reading the bundle to learn which
 *               resource was missing.
 *
 * HOW IT ASKS
 * -----------
 * Not from PostgREST's OpenAPI document: Supabase answers that endpoint with
 * `401 Only secret API keys can be used for this endpoint`, and a lint is not
 * worth putting a service-role key into CI.
 *
 * Instead each RPC is resolved by posting the argument NAMES the client sends,
 * all null. PostgREST resolves a function by name *and* argument set, so the
 * status code separates the cases before anything runs:
 *
 *   404  no function of that name takes those arguments  → the gap
 *   401  it exists; anon may not call it                 → present
 *   4xx  it exists; the null arguments were rejected     → present
 *   200  it exists and ran                               → present
 *
 * Verified against production 2026-08-27: a nonexistent name gives 404,
 * set_my_email_language gives 401, and the same function with one parameter
 * renamed gives 404 — so a signature that drifts is caught too.
 *
 * WHAT IT COSTS
 * -------------
 * Functions revoked from anon are refused at the permission gate, so their
 * bodies never execute. Two are anon-callable — search_items_fuzzy and
 * search_posts_fuzzy — and those do run, as a STABLE search over null terms.
 * Nothing is written. `Prefer: tx=rollback` is sent as a second belt.
 *
 * Usage:  node scripts/verify-deployed-rpcs.mjs
 *         SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (or the VITE_ prefixed pair)
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SRC = join(REPO_ROOT, 'app', 'src')

/* ------------------------------------------------------------------ client */

/**
 * Split an object body on the commas that separate its own entries.
 *
 * Splitting on lines loses `{ a: 1, b: 2 }`, and splitting on every comma loses
 * `{ a: f(x, y) }` — so depth is tracked, and quoted text is skipped whole so a
 * brace or comma inside a string cannot move it.
 */
function topLevelSegments(body) {
  const segments = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '{' || ch === '[' || ch === '(') depth += 1
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      segments.push(body.slice(start, i))
      start = i + 1
    }
  }
  segments.push(body.slice(start))
  return segments
}

/**
 * `supabase.rpc('name')` or `.rpc('name', { a: 1, b: 2 })`.
 *
 * The argument object is read by scanning forward from the opening brace and
 * tracking depth, so a nested object inside one argument does not end the list
 * early. Only keys at the object's own level are arguments.
 *
 * A spread (`...commonLegacyArgs(params)`) contributes keys this scan cannot
 * see, so the call is marked `partial` and its argument list is treated as a
 * subset — never as the complete set. Claiming an argument is missing when the
 * spread supplies it would be a false alarm, and a checker that cries wolf gets
 * turned off.
 */
export function extractRpcCalls(source, file = '') {
  const calls = []
  const re = /\.rpc\(\s*'([a-z0-9_]+)'\s*(,)?/g
  let match
  while ((match = re.exec(source)) !== null) {
    const [, name, hasArgs] = match
    const call = { name, file, args: new Set(), partial: false }
    if (hasArgs) {
      const open = source.indexOf('{', re.lastIndex)
      // `.rpc('name', someVariable)` — an argument object we cannot read at all.
      if (open === -1 || source.slice(re.lastIndex, open).trim() !== '') {
        call.partial = true
      } else {
        let depth = 0
        let i = open
        for (; i < source.length; i += 1) {
          const ch = source[i]
          if (ch === '{' || ch === '[' || ch === '(') depth += 1
          else if (ch === '}' || ch === ']' || ch === ')') {
            depth -= 1
            if (depth === 0) break
          }
        }
        for (const segment of topLevelSegments(source.slice(open + 1, i))) {
          const trimmed = segment.trim()
          if (trimmed.startsWith('...')) { call.partial = true; continue }
          const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(trimmed)
          if (key) call.args.add(key[1])
        }
      }
    }
    calls.push(call)
  }
  return calls
}

async function sourceFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await sourceFiles(path))
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(path)
  }
  return out
}

export async function clientRpcCalls(root = CLIENT_SRC) {
  const calls = []
  for (const file of await sourceFiles(root)) {
    calls.push(...extractRpcCalls(await readFile(file, 'utf8'), relative(REPO_ROOT, file)))
  }
  return calls
}

/* ---------------------------------------------------------------- deployed */

/** The statuses that mean "this function, with these arguments, is not here". */
const NOT_FOUND = new Set([404])

/**
 * Resolve one call against the deployed database.
 *
 * Returns 'present', 'missing', or 'unreachable' — the third kept distinct so a
 * network fault can never be reported as a schema gap.
 */
export async function probeRpc(baseUrl, key, call, fetchImpl = fetch) {
  const body = {}
  for (const arg of call.args) body[arg] = null
  let response
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${call.name}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'tx=rollback',
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    return { status: 'unreachable', detail: error?.message || String(error) }
  }
  if (NOT_FOUND.has(response.status)) return { status: 'missing', detail: `HTTP ${response.status}` }
  return { status: 'present', detail: `HTTP ${response.status}` }
}

/* ------------------------------------------------------------------ verify */

/** One entry per distinct RPC, with every argument any call site sends. */
export function mergeCalls(calls) {
  const byName = new Map()
  for (const call of calls) {
    const existing = byName.get(call.name)
    if (existing) {
      for (const arg of call.args) existing.args.add(arg)
      existing.partial = existing.partial || call.partial
      existing.files.add(call.file)
    } else {
      byName.set(call.name, { ...call, args: new Set(call.args), files: new Set([call.file]) })
    }
  }
  return [...byName.values()].map(c => ({ ...c, files: [...c.files] }))
}

/**
 * A spread hides argument names from the scan, so the probe would post an
 * incomplete set and PostgREST would answer 404 for a function that is present.
 * Those are reported as unverified rather than as gaps — a checker that cries
 * wolf gets turned off, and the two calls in that shape are the anon-callable
 * searches, which the logged-out page sweep already exercises.
 */
export function classify(merged, results) {
  const missing = []
  const unverified = []
  const unreachable = []
  let present = 0
  for (const call of merged) {
    const result = results.get(call.name)
    if (!result || result.status === 'unreachable') {
      unreachable.push({ ...call, detail: result?.detail || 'no result' })
    } else if (result.status === 'present') {
      present += 1
    } else if (call.partial) {
      unverified.push({ ...call, detail: result.detail })
    } else {
      missing.push({ ...call, detail: result.detail })
    }
  }
  return { missing, unverified, unreachable, present }
}

/**
 * The way this check fails usefully is by going red. The way it fails uselessly
 * is by finding nothing and calling that agreement — an empty client scan
 * matches every database, and a run where nothing could be reached proves
 * nothing about the schema. Both are broken-checker states, so they are stated
 * as their own contract rather than left implicit in main().
 */
export function scanIsMeaningless(merged, classified) {
  if (merged.length === 0) {
    return 'found no supabase.rpc() calls in app/src — the scan is broken, not the database'
  }
  if (classified.unreachable.length === merged.length) {
    return 'every probe failed to reach the database, so nothing was learned about '
      + 'the schema. Not treating this as "all present".'
  }
  return null
}

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || ''
  if (!url || !key) {
    fail('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required. Both are public '
      + 'values that already ship inside the browser bundle.')
  }

  const merged = mergeCalls(await clientRpcCalls())
  const results = new Map()
  for (const call of merged) {
    results.set(call.name, await probeRpc(url, key, call))
  }
  const classified = classify(merged, results)

  const meaningless = scanIsMeaningless(merged, classified)
  if (meaningless) fail(meaningless)

  console.log(`probed ${merged.length} RPCs the client calls: `
    + `${classified.present} present, ${classified.missing.length} missing, `
    + `${classified.unverified.length} unverified, ${classified.unreachable.length} unreachable`)

  for (const call of classified.unverified) {
    console.warn(`⚠ ${call.name} answered ${call.detail}, but its call site spreads arguments `
      + `the scan cannot read (${call.files.join(', ')}) — not treated as missing`)
  }
  for (const call of classified.unreachable) {
    console.warn(`⚠ ${call.name} could not be reached: ${call.detail}`)
  }
  for (const call of classified.missing) {
    console.error(`✖ ${call.name}(${[...call.args].join(', ')}) is called by `
      + `${call.files.join(', ')} and this database has no such function`)
  }

  if (classified.missing.length) {
    fail('the client is ahead of this database. Apply the migrations in '
      + 'supabase/migrations/ that define the functions above, then re-run. '
      + 'Merging deploys the frontend only — see RUNBOOK "Schema-coupled release order".')
  }
  console.log('✓ every RPC the client calls resolves on this database, with the arguments it sends')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => fail(error?.message || String(error)))
}
