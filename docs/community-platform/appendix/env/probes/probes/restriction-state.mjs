import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { client } from './probe-data.mjs'

function isSuspensionActive(state, nowMs = Date.now()) {
  if (!state?.suspension_level || state.suspension_level < 2) return false
  if (!state.suspended_until || /^infinity$/i.test(state.suspended_until)) return true
  const endMs = Date.parse(state.suspended_until)
  return !Number.isFinite(endMs) || endMs > nowMs
}

const results = []
const logoutPath = `${process.env.EV}/session-logouts.json`
const logouts = existsSync(logoutPath) ? JSON.parse(await readFile(logoutPath, 'utf8')) : []
for (const account of ['A', 'B', 'C']) {
  const statuses = []
  const db = client(statuses)
  let signedIn = false
  try {
    const auth = await db.auth.signInWithPassword({
      email: process.env[`SYN_${account}_EMAIL`],
      password: process.env[`SYN_${account}_PASSWORD`],
    })
    if (auth.error || !auth.data.user) throw new Error('restriction_auth_failed')
    signedIn = true
    const profile = await db.rpc('get_my_profile')
    if (profile.error || !profile.data) throw new Error('restriction_profile_failed')
    const result = { account, restricted: isSuspensionActive(profile.data) }
    results.push(result)
    console.log(JSON.stringify(result))
  } finally {
    if (signedIn) {
      try { await db.auth.signOut({ scope: 'local' }) } catch {}
      const status = statuses.at(-1) ?? null
      logouts.push({
        phase: 'sdk_logout', account, kind: 'sdk', probe: 'restriction-state',
        status, residualCount: status !== null && status >= 200 && status < 300 ? 0 : 1,
        at: new Date().toISOString(),
      })
      await writeFile(logoutPath, JSON.stringify(logouts, null, 2))
    }
  }
}
await writeFile(`${process.env.EV}/restriction-state.json`, JSON.stringify(results, null, 2))
