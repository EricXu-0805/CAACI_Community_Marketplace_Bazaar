export const config = { runtime: 'edge' }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://lfhvgprfphyfvhidegum.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

export default async function handler() {
  const key = SERVICE_KEY || ANON_KEY
  const using = SERVICE_KEY ? 'service_role' : 'anon'
  const result = { using, status_columns: null, reports_post_check: null, hints: [] }

  try {
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,status_text,status_emoji&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    result.status_columns = r1.ok ? 'OK (migration 021 applied)' : `FAIL (${r1.status}) - ${(await r1.text()).slice(0, 200)}`
  } catch (e) {
    result.status_columns = `ERR ${e.message}`
  }

  if (SERVICE_KEY) {
    try {
      const r2 = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          target_type: 'post',
          target_id: '00000000-0000-0000-0000-000000000000',
          reason: 'probe_022',
          reporter_id: '00000000-0000-0000-0000-000000000000',
        }),
      })
      const body = await r2.text()
      if (r2.ok) {
        result.reports_post_check = 'OK (022 applied) - cleaning up test row'
        const created = JSON.parse(body)?.[0]
        if (created?.id) {
          await fetch(`${SUPABASE_URL}/rest/v1/reports?id=eq.${created.id}`, {
            method: 'DELETE',
            headers: { apikey: key, Authorization: `Bearer ${key}` },
          })
        }
      } else {
        const parsed = (() => { try { return JSON.parse(body) } catch { return { message: body } } })()
        if (parsed.code === '23514') {
          result.reports_post_check = 'FAIL (022 NOT applied) - CHECK constraint rejected target_type=post'
          result.hints.push('Go to Supabase SQL Editor and run migration 022 from RUN_PENDING_MIGRATIONS.sql')
        } else if (parsed.code === '23503') {
          result.reports_post_check = 'OK (022 applied) - CHECK passed, FK failed on fake UUIDs as expected'
        } else {
          result.reports_post_check = `UNKNOWN code=${parsed.code} msg=${parsed.message?.slice(0, 200)}`
        }
      }
    } catch (e) {
      result.reports_post_check = `ERR ${e.message}`
    }
  } else {
    result.reports_post_check = 'SKIPPED (no SUPABASE_SERVICE_ROLE_KEY env var on Vercel)'
    result.hints.push('Add SUPABASE_SERVICE_ROLE_KEY to Vercel env vars to enable this probe, or just verify by using the app.')
  }

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}
