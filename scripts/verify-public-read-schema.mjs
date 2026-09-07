#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

// Zero-row reads exercise the real PostgREST projection and join planner.
// Missing columns must fail before launching hundreds of browser cases.
export async function verifyPublicReadSchema({ url, key, fetchImpl = fetch }) {
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url || '')) {
    throw new Error('public_schema_invalid_project_url')
  }
  let anonymous = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key || '')
  if (!anonymous) {
    try { anonymous = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon' }
    catch { /* Privileged or unknown credentials are never sent. */ }
  }
  if (!anonymous) throw new Error('public_schema_requires_publishable_or_anon_key')
  const headers = { apikey: key }
  if (!key.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${key}`
  const checks = [
    ['item category details', 'items', 'id,listing_details'],
    ['plaza attached item details', 'posts', 'id,item:items(id,listing_details)'],
  ]
  const results = []
  for (const [name, table, select] of checks) {
    const target = new URL(`/rest/v1/${table}`, url)
    target.search = new URLSearchParams({ select, limit: '0' }).toString()
    const response = await fetchImpl(target, {
      headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`public_schema_mismatch: ${name} returned HTTP ${response.status}; apply the reviewed migrations to this test target before testing the candidate`)
    }
    // No data should be returned by a valid limit=0 projection.
    const body = await response.json()
    if (!Array.isArray(body) || body.length !== 0) throw new Error('public_schema_unexpected_response')
    results.push({ name, status: response.status })
  }
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublicReadSchema({
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }).then(results => console.log(JSON.stringify({ publicReadSchema: results })))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
