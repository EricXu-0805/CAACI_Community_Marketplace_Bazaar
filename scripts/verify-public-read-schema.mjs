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
    ['item category and street details', 'items', 'id,listing_details,location_verified,location_checked_at'],
    ['plaza attached item details', 'posts', 'id,item:items(id,listing_details)'],
    ['public comment translations', 'post_comments', 'id,content_i18n'],
    ['community topic columns', 'posts', 'id,title,category,region'],
    ['community topic activity columns', 'posts', 'id,last_activity_at,answered_at,is_featured,locked_at'],
    ['community events', 'community_events', 'id,source_type,starts_at,availability'],
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
  // The functions the client reads through ship with those columns; a read-only call proves each exists.
  const functions = [
    ['community search rpc', 'search_community_posts', { terms_in: ['x'], limit_in: 1 }],
    ['community events rpc', 'list_community_events', { limit_in: 1 }],
  ]
  for (const [name, routine, args] of functions) {
    const rpc = await fetchImpl(new URL(`/rest/v1/rpc/${routine}`, url), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    await rpc.body?.cancel()
    if (!rpc.ok) {
      throw new Error(`public_schema_mismatch: ${name} returned HTTP ${rpc.status}; apply the reviewed migrations to this test target before testing the candidate`)
    }
    results.push({ name, status: rpc.status })
  }
  // P3.6: the topic page asks this function why a topic cannot be read. It ships in one transaction
  // with the watch and save tables and the author's hidden-topic list, which the publishable key
  // cannot reach, so its answer stands for them too. Asking about a topic that does not exist
  // reads no row.
  const state = await fetchImpl(new URL('/rest/v1/rpc/community_post_state', url), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id_in: '00000000-0000-0000-0000-000000000000' }),
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  })
  if (!state.ok) {
    await state.body?.cancel()
    throw new Error(`public_schema_mismatch: community topic state rpc returned HTTP ${state.status}; apply the reviewed migrations to this test target before testing the candidate`)
  }
  if (await state.json() !== 'missing') throw new Error('public_schema_unexpected_response')
  results.push({ name: 'community topic state rpc', status: state.status })
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPublicReadSchema({
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  }).then(results => console.log(JSON.stringify({ publicReadSchema: results })))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
