import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const sessions = new Set()

export const target = 'https://hygkwxugskijadgfisji.supabase.co'
if (process.env.VITE_SUPABASE_URL !== target
  || !['A', 'B', 'C'].every(k => process.env[`SYN_${k}_EMAIL`]?.endsWith('@example.test'))) {
  throw new Error('staging_probe_target_or_synthetic_identity_invalid')
}
export function client(logoutStatuses) {
  return createClient(target, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const response = await fetch(input, init)
        if (String(input).includes('/auth/v1/logout')) logoutStatuses?.push(response.status)
        return response
      },
    },
  })
}
export async function identity(account) {
  const logoutStatuses = []
  const db = client(logoutStatuses)
  const { data, error } = await db.auth.signInWithPassword({
    email: process.env[`SYN_${account}_EMAIL`],
    password: process.env[`SYN_${account}_PASSWORD`],
  })
  console.log(JSON.stringify({ action: 'auth', identity: account, status: error?.status ?? 200, code: error?.code ?? null, userId: data.user?.id ?? null }))
  if (error || !data.user) throw new Error('synthetic_auth_failed')
  sessions.add({ db, account, logoutStatuses })
  return { db, id: data.user.id }
}
export async function recordSessionLogout(account, kind, statuses) {
  const path = `${process.env.EV}/session-logouts.json`
  const events = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : []
  const status = statuses.at(-1) ?? null
  const residualCount = status !== null && status >= 200 && status < 300 ? 0 : 1
  const row = { phase: kind === 'ui' ? 'ui_logout' : 'sdk_logout', account, kind, status, residualCount, at: new Date().toISOString() }
  console.log(JSON.stringify(row))
  events.push(row)
  await writeFile(path, JSON.stringify(events, null, 2))
  if (residualCount) {
    const residualPath = `${process.env.EV}/session-residuals.json`
    const residuals = existsSync(residualPath) ? JSON.parse(await readFile(residualPath, 'utf8')) : []
    residuals.push({ account, kind, count: 1, status, at: row.at })
    await writeFile(residualPath, JSON.stringify(residuals, null, 2))
  }
}
export async function signOutIdentities() {
  for (const session of sessions) {
    try { await session.db.auth.signOut({ scope: 'local' }) } catch {}
    await recordSessionLogout(session.account, 'sdk', session.logoutStatuses)
    sessions.delete(session)
  }
}
export function requireResult(result, action) {
  console.log(JSON.stringify({ action, status: result.status, code: result.error?.code ?? null, count: Array.isArray(result.data) ? result.data.length : Number(Boolean(result.data)) }))
  if (result.error || !result.data) throw new Error(`${action}_failed`)
  return result.data
}
