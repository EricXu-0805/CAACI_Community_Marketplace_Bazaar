#!/usr/bin/env node
/*
 * scripts/admin-token-mint.mjs — issue a per-admin bearer token.
 *
 * Use after applying migration 036_admin_tokens.sql. Generates a
 * 32-byte random token, prints it ONCE in plaintext, then stores
 * only its SHA-256 hash in public.admin_tokens.
 *
 * The plaintext is the admin's responsibility from that point on:
 *   1. Save it in their browser localStorage under key "admin_token"
 *      via the admin dashboard's first-visit prompt
 *   2. (Optional) keep a backup in 1Password / a vault
 *   3. If lost, re-mint a new one and revoke the old via
 *      `node scripts/admin-token-revoke.mjs <token_id>` (TODO),
 *      or via the dashboard's "Active Sessions" panel.
 *
 * Usage:
 *   export SUPABASE_URL=https://<project>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
 *   node scripts/admin-token-mint.mjs --name "Alice" --email "alice@example.edu"
 *
 * Optional flags:
 *   --admin-id <uuid>  — link to an existing profiles.id; this is
 *                        what populates admin_audit_log.actor_id.
 *                        If omitted, the row's admin_id is NULL and
 *                        audit log shows admin_name only.
 *   --apply             — actually write to DB (default is dry-run
 *                        which prints the plaintext but doesn't
 *                        persist the hash). Useful for sanity-
 *                        checking the env vars before committing.
 *
 * Get the service_role key from:
 *   Supabase Dashboard → Project Settings → API → service_role (secret)
 * Do NOT commit it. Export in shell only for the duration of this run.
 *
 * Token format: "iam_admin_" + 32 bytes base64url-encoded.
 *   Total length ≈ 53 chars. The "iam_admin_" prefix lets GitHub's
 *   secret-scanning catch accidental commits without giving an
 *   attacker an easy grep target.
 */

import crypto from 'node:crypto'
import { argv, env, exit, stdout } from 'node:process'

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

const APPLY    = argv.includes('--apply')
const NAME     = flag('--name')
const EMAIL    = flag('--email')
const ADMIN_ID = flag('--admin-id')

if (!NAME || !EMAIL) {
  console.error('Usage: node scripts/admin-token-mint.mjs --name "<display name>" --email "<email>" [--admin-id <uuid>] [--apply]')
  exit(1)
}

if (NAME.length < 1 || NAME.length > 100) {
  console.error('--name must be 1-100 characters')
  exit(1)
}
if (EMAIL.length < 3 || EMAIL.length > 200 || !EMAIL.includes('@')) {
  console.error('--email must look like an email (3-200 chars, contain @)')
  exit(1)
}
if (ADMIN_ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ADMIN_ID)) {
  console.error('--admin-id must be a UUID')
  exit(1)
}

const REST = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const HEADERS = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

const tokenBytes = crypto.randomBytes(32)
const tokenB64u = tokenBytes.toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '')
const plaintext = `iam_admin_${tokenB64u}`
const hashHex = crypto.createHash('sha256').update(plaintext).digest('hex')

async function ensureTableExists() {
  const r = await fetch(`${REST}/admin_tokens?select=id&limit=1`, { headers: HEADERS })
  if (r.status === 404) {
    console.error('admin_tokens table not found. Apply supabase/migrations/036_admin_tokens.sql first.')
    exit(2)
  }
  if (!r.ok && r.status !== 401) {
    const text = await r.text()
    console.error(`Probe failed: HTTP ${r.status}: ${text}`)
    exit(2)
  }
}

async function insertHash() {
  const r = await fetch(`${REST}/admin_tokens`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      token_hash:  hashHex,
      admin_id:    ADMIN_ID || null,
      admin_name:  NAME,
      admin_email: EMAIL,
    }),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`Insert failed: HTTP ${r.status}: ${text}`)
  }
  return await r.json()
}

await ensureTableExists()

console.log('')
console.log('═'.repeat(60))
console.log(APPLY ? '🚀 APPLY mode — hash will be written to admin_tokens' : '🔍 DRY-RUN — no DB write (use --apply to commit)')
console.log('═'.repeat(60))
console.log('')
console.log(`  Admin name:  ${NAME}`)
console.log(`  Admin email: ${EMAIL}`)
if (ADMIN_ID) console.log(`  Admin id:    ${ADMIN_ID}`)
console.log(`  Hash (hex):  ${hashHex}`)
console.log('')

if (APPLY) {
  try {
    const inserted = await insertHash()
    const row = Array.isArray(inserted) ? inserted[0] : inserted
    console.log(`✓ Stored as admin_tokens.id = ${row?.id || '(unknown)'}`)
  } catch (e) {
    console.error('✗', e.message)
    exit(3)
  }
}

console.log('')
console.log('▼ TOKEN PLAINTEXT — copy this into the admin dashboard prompt or 1Password ▼')
console.log('')
console.log('   ' + plaintext)
console.log('')
console.log('▲ Save it now — this is the only time it will be displayed. ▲')
console.log('')

if (!APPLY) {
  console.log('Re-run with --apply to commit the hash to admin_tokens.')
}

if (stdout.isTTY) {
  console.log('')
  console.log('Tip: pipe through `pbcopy` on macOS to copy the token to clipboard:')
  console.log(`  node scripts/admin-token-mint.mjs --name "${NAME}" --email "${EMAIL}" ${ADMIN_ID ? `--admin-id ${ADMIN_ID} ` : ''}--apply 2>/dev/null | grep '^   iam_admin_' | tr -d '[:space:]' | pbcopy`)
}
