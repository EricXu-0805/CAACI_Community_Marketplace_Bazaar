#!/usr/bin/env node
/*
 * scripts/admin-token-revoke.mjs — companion to admin-token-mint.mjs.
 *
 * Sets admin_tokens.revoked_at to now() so the row stops matching
 * admin_token_validate() but stays in the table for audit-log
 * provenance (every audit_log entry pointing at this admin_id
 * remains resolvable).
 *
 * Three modes:
 *   --list                       List active + revoked tokens
 *   --id <uuid>                  Revoke a single token by row id
 *   --email <addr>               Revoke ALL active tokens for an email
 *
 * Default is dry-run: prints what *would* be revoked but doesn't
 * touch the DB. Add --apply to execute. Same convention as
 * admin-token-mint.mjs so the two scripts feel symmetric.
 *
 * Usage:
 *   export SUPABASE_URL=https://<project>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
 *
 *   # Inventory check — who has active tokens?
 *   node scripts/admin-token-revoke.mjs --list
 *
 *   # Revoke a specific token (after looking up its id from --list)
 *   node scripts/admin-token-revoke.mjs --id 9f2c… --apply
 *
 *   # Revoke every active token for a departed admin
 *   node scripts/admin-token-revoke.mjs --email kenny@illinois.edu --apply
 *
 *   # Include revoked entries in the listing (post-incident audit)
 *   node scripts/admin-token-revoke.mjs --list --show-revoked
 *
 * Get the service_role key from:
 *   Supabase Dashboard → Project Settings → API → service_role (secret)
 * Do NOT commit it. Export in shell only for the duration of this run.
 *
 * Why direct PostgREST PATCH instead of an RPC?
 *   migration 036 grants service_role UPDATE on public.admin_tokens.
 *   A dedicated `admin_token_revoke()` RPC would just wrap the same
 *   UPDATE, adding a deploy step (NOTIFY pgrst, schema reload) for
 *   every code change. PATCH stays correct as long as the table
 *   shape doesn't change; if we ever need server-side validation
 *   beyond "set revoked_at", that's the trigger to add an RPC.
 */

import { argv, env, exit } from 'node:process'

const SUPABASE_URL = env.SUPABASE_URL
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  console.error('Dashboard → Project Settings → API → service_role (secret)')
  exit(1)
}

function flag(name) {
  const i = argv.indexOf(name)
  if (i === -1) return null
  return argv[i + 1] ?? null
}

const APPLY        = argv.includes('--apply')
const LIST         = argv.includes('--list')
const SHOW_REVOKED = argv.includes('--show-revoked')
const ID           = flag('--id')
const EMAIL        = flag('--email')

if (!LIST && !ID && !EMAIL) {
  console.error('Usage:')
  console.error('  node scripts/admin-token-revoke.mjs --list [--show-revoked]')
  console.error('  node scripts/admin-token-revoke.mjs --id <uuid> [--apply]')
  console.error('  node scripts/admin-token-revoke.mjs --email <email> [--apply]')
  exit(1)
}

if (ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ID)) {
  console.error('--id must be a UUID')
  exit(1)
}

if (EMAIL && (!EMAIL.includes('@') || EMAIL.length < 3 || EMAIL.length > 200)) {
  console.error('--email must look like an email (3-200 chars, contain @)')
  exit(1)
}

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const HEADERS = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
}

/*
 * Fetch the current admin_tokens roster via the admin_token_list()
 * RPC defined in migration 036. The RPC returns rows ordered by
 * (revoked_at NULLS FIRST, created_at DESC) — i.e. active tokens at
 * the top, then revoked, newest first within each bucket.
 */
async function fetchTokens() {
  const r = await fetch(`${REST}/rpc/admin_token_list`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({}),
  })
  if (!r.ok) {
    const text = await r.text()
    if (r.status === 404) {
      throw new Error(
        'admin_token_list() not found. Apply supabase/migrations/036_admin_tokens.sql first.',
      )
    }
    throw new Error(`admin_token_list failed: HTTP ${r.status}: ${text}`)
  }
  const rows = await r.json()
  return Array.isArray(rows) ? rows : []
}

function formatTimestamp(ts) {
  if (!ts) return '—'
  // PostgREST returns ISO 8601; trim to YYYY-MM-DD HH:MM for readability
  return ts.replace('T', ' ').slice(0, 16)
}

function printRoster(rows, { includeRevoked }) {
  const filtered = includeRevoked ? rows : rows.filter(r => !r.revoked_at)
  if (filtered.length === 0) {
    console.log(includeRevoked ? '(no tokens at all)' : '(no active tokens)')
    return
  }
  // Compact tabular layout — two-line entries with id on its own
  // line so it's easy to copy without picking up surrounding text.
  console.log('')
  for (const row of filtered) {
    const status = row.revoked_at
      ? `\x1b[2mREVOKED\x1b[0m`
      : `\x1b[32mACTIVE\x1b[0m`
    console.log(`  ${status}  ${row.admin_name}  <${row.admin_email}>`)
    console.log(`         id: ${row.id}`)
    console.log(`         created: ${formatTimestamp(row.created_at)}   `
              + `last_used: ${formatTimestamp(row.last_used_at)}`
              + (row.revoked_at ? `   revoked: ${formatTimestamp(row.revoked_at)}` : ''))
    console.log('')
  }
  const activeCount  = rows.filter(r => !r.revoked_at).length
  const revokedCount = rows.filter(r =>  r.revoked_at).length
  console.log(`  Summary: ${activeCount} active, ${revokedCount} revoked, ${rows.length} total`)
}

async function revokeById(id) {
  const r = await fetch(
    `${REST}/admin_tokens?id=eq.${encodeURIComponent(id)}&revoked_at=is.null`,
    {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    },
  )
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`PATCH failed: HTTP ${r.status}: ${text}`)
  }
  const rows = await r.json()
  return Array.isArray(rows) ? rows : []
}

// ──────────────────────────────────────────────────────────
// Mode: --list
// ──────────────────────────────────────────────────────────
if (LIST) {
  const rows = await fetchTokens()
  console.log('')
  console.log('═'.repeat(60))
  console.log(SHOW_REVOKED
    ? '📋 admin_tokens — ALL (active + revoked)'
    : '📋 admin_tokens — active only (use --show-revoked for full)')
  console.log('═'.repeat(60))
  printRoster(rows, { includeRevoked: SHOW_REVOKED })
  console.log('')
  console.log('To revoke:')
  console.log('  node scripts/admin-token-revoke.mjs --id <uuid> --apply')
  console.log('  node scripts/admin-token-revoke.mjs --email <addr> --apply')
  console.log('')
  exit(0)
}

// ──────────────────────────────────────────────────────────
// Mode: --id <uuid>
// ──────────────────────────────────────────────────────────
if (ID) {
  const rows = await fetchTokens()
  const target = rows.find(r => r.id === ID)
  if (!target) {
    console.error(`No token with id=${ID}`)
    exit(2)
  }
  if (target.revoked_at) {
    console.error(`Token ${ID} is already revoked at ${formatTimestamp(target.revoked_at)}`)
    exit(2)
  }

  console.log('')
  console.log('═'.repeat(60))
  console.log(APPLY
    ? '🚀 APPLY mode — revoked_at will be set to now()'
    : '🔍 DRY-RUN — no DB write (use --apply to commit)')
  console.log('═'.repeat(60))
  console.log('')
  console.log('  Will revoke:')
  console.log(`    ${target.admin_name}  <${target.admin_email}>`)
  console.log(`    id: ${target.id}`)
  console.log(`    created: ${formatTimestamp(target.created_at)}   `
            + `last_used: ${formatTimestamp(target.last_used_at)}`)
  console.log('')

  if (APPLY) {
    try {
      const updated = await revokeById(ID)
      const row = updated[0]
      if (!row) {
        console.error('✗ PATCH returned no rows — concurrent revoke?')
        exit(3)
      }
      console.log(`✓ Revoked at ${formatTimestamp(row.revoked_at)}`)
    } catch (e) {
      console.error('✗', e.message)
      exit(3)
    }
  } else {
    console.log('Re-run with --apply to commit.')
  }
  console.log('')
  exit(0)
}

// ──────────────────────────────────────────────────────────
// Mode: --email <addr>
// ──────────────────────────────────────────────────────────
if (EMAIL) {
  const rows = await fetchTokens()
  const targets = rows.filter(r => r.admin_email === EMAIL && !r.revoked_at)
  if (targets.length === 0) {
    console.error(`No active tokens for email=${EMAIL}`)
    console.error('(Use --list --show-revoked to see revoked tokens for this address)')
    exit(2)
  }

  console.log('')
  console.log('═'.repeat(60))
  console.log(APPLY
    ? `🚀 APPLY mode — ${targets.length} token(s) will be revoked`
    : `🔍 DRY-RUN — ${targets.length} token(s) match (use --apply to commit)`)
  console.log('═'.repeat(60))
  console.log('')
  for (const target of targets) {
    console.log('  Will revoke:')
    console.log(`    ${target.admin_name}  <${target.admin_email}>`)
    console.log(`    id: ${target.id}`)
    console.log(`    created: ${formatTimestamp(target.created_at)}   `
              + `last_used: ${formatTimestamp(target.last_used_at)}`)
    console.log('')
  }

  if (APPLY) {
    let ok = 0
    let failed = 0
    for (const target of targets) {
      try {
        const updated = await revokeById(target.id)
        if (updated[0]) {
          console.log(`✓ Revoked ${target.id}`)
          ok++
        } else {
          console.warn(`⚠ ${target.id}: PATCH returned no rows`)
          failed++
        }
      } catch (e) {
        console.error(`✗ ${target.id}: ${e.message}`)
        failed++
      }
    }
    console.log('')
    console.log(`Done: ${ok} revoked, ${failed} failed.`)
    if (failed > 0) exit(3)
  } else {
    console.log('Re-run with --apply to commit.')
  }
  console.log('')
  exit(0)
}
