// First-party campaign attribution: a tab session, never a cross-site identity.
// All exceptions are contained; attribution must never delay core actions.
// #ifdef H5
import { useSupabase } from '../composables/useSupabase'
import { captureAccountIdentityGeneration, getActiveAccountId, isAccountIdentityGenerationCurrent, onAccountTransition } from '../composables/accountScope'
const KEY = 'illini_campaign_session_v1'
const SOURCES = new Set(['caaci', 'wechat_students', 'wechat_local', 'xiaohongshu', 'facebook', 'reddit', 'instagram', 'x', 'linkedin'])
type Campaign = { source: string; id: string; started: number }
let campaign: Campaign | null = null
let visit: Promise<boolean> | null = null
let attributedUser = ''
let started = false
function allowed() {
  return typeof window !== 'undefined' && ['illinimarket.com', 'www.illinimarket.com'].includes(window.location.hostname)
    && navigator.doNotTrack !== '1' && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
}
async function send(event: 'visit' | 'signup', value: Campaign, bearer = '') {
  const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 4000)
  try {
    const response = await fetch('/api/acquisition', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: abort.signal,
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ event, source: value.source, visit_id: value.id }),
    })
    return response.status === 204
  } catch { return false } finally { clearTimeout(timer) }
}
export function startAcquisition() {
  if (started || !allowed()) return
  started = true
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    if (saved && SOURCES.has(saved.source) && typeof saved.id === 'string' && Number.isFinite(saved.started)
      && saved.started <= Date.now() && saved.started > Date.now() - 86400000) campaign = saved
    if (!campaign) {
      const source = new URLSearchParams(window.location.search).get('utm_source') || ''
      if (!SOURCES.has(source)) return
      campaign = { source, id: crypto.randomUUID(), started: Date.now() }
      sessionStorage.setItem(KEY, JSON.stringify(campaign))
    }
    visit = send('visit', campaign!)
    // Initial anonymous -> signed-in transition retains the campaign. A later
    // sign-out or account switch discards it before another account can claim it.
    onAccountTransition(transition => {
      if (transition.previousUserId) {
        campaign = null; visit = null; attributedUser = ''
        try { sessionStorage.removeItem(KEY) } catch {}
      }
    })
  } catch { campaign = null }
}
export async function attributeNewAccount(userId: string, consentVersion: string) {
  if (!allowed() || !campaign || consentVersion < '2026-09-19' || attributedUser === userId) return
  const snapshot = campaign, generation = captureAccountIdentityGeneration()
  try {
    if (!(await visit) || !isAccountIdentityGenerationCurrent(generation, userId) || getActiveAccountId() !== userId || campaign !== snapshot) return
    const { data } = await useSupabase().supabase.auth.getSession()
    if (!isAccountIdentityGenerationCurrent(generation, userId) || getActiveAccountId() !== userId || data.session?.user.id !== userId || campaign !== snapshot) return
    if (await send('signup', snapshot, data.session.access_token)) attributedUser = userId
  } catch { /* collection failures never affect authentication */ }
}
// #endif
