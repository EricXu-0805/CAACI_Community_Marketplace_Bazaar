/*
 * mp-only WeChat content-security gate (store-review requirement).
 *
 * Reviewers submit violating text/images and expect interception; our
 * keyword table doesn't cover their test vocabulary, WeChat's free
 * classifiers do. Two hooks, both no-ops outside MP-WEIXIN:
 *
 *   mpTextGate(content, scene)  — synchronous verdict via
 *     /api/wechat-seccheck (msg_sec_check v2). Throws
 *     'moderation_block:wechat' on a risky verdict so existing catch
 *     sites surface the standard 「内容未通过审核」 copy via
 *     friendlyErrorMessage. Every other failure (network, missing
 *     session, degraded server) passes — the DB keyword trigger stays
 *     the floor, and this gate must never take posting down.
 *
 *   mpImageCheck(storagePath)   — fire-and-forget async submit
 *     (media_check_async). Verdict lands on /api/wechat-callback which
 *     deletes a risky object server-side; nothing to await here.
 *
 * openid: msg_sec_check v2 wants the openid of a user who opened the mp
 * recently. WeChat-login users resolve server-side from their profile;
 * email-login users get a silent wx.login js_code attached. The server
 * echoes the resolved openid and we cache it to skip future exchanges.
 */
import { BASE_URL } from '../config/runtime'
import { useSupabase, platformFetch } from './useSupabase'

const OPENID_KEY = 'wechat_seccheck_openid'

/* Scene codes from the msg_sec_check API: 1 资料 2 评论 3 论坛 4 社交日志. */
export type SecScene = 1 | 2 | 3 | 4

async function bearerToken(): Promise<string | null> {
  try {
    const { supabase } = useSupabase()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  } catch {
    return null
  }
}

function cachedOpenid(): string {
  try { return uni.getStorageSync(OPENID_KEY) || '' } catch { return '' }
}

function cacheOpenid(openid: string) {
  try { uni.setStorageSync(OPENID_KEY, openid) } catch { /* best effort */ }
}

async function freshJsCode(): Promise<string> {
  return await new Promise((resolve) => {
    try {
      uni.login({
        provider: 'weixin',
        success: (r: UniApp.LoginRes) => resolve(r.code || ''),
        fail: () => resolve(''),
      })
    } catch {
      resolve('')
    }
  })
}

async function callSeccheck(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const token = await bearerToken()
  if (!token) return null
  const body: Record<string, unknown> = { ...payload }
  const openid = cachedOpenid()
  if (openid) body.openid = openid
  else body.js_code = await freshJsCode()
  const res = await platformFetch(`${BASE_URL}/api/wechat-seccheck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const data = await res.json()
  if (data?.openid && typeof data.openid === 'string') cacheOpenid(data.openid)
  return data
}

export async function mpTextGate(content: string, scene: SecScene): Promise<void> {
  // #ifdef MP-WEIXIN
  if (!content || !content.trim()) return
  let data: Record<string, unknown> | null = null
  try {
    data = await callSeccheck({ kind: 'text', content, scene })
  } catch {
    return
  }
  if (data && data.ok === false && data.suggest === 'risky') {
    throw new Error('moderation_block:wechat')
  }
  // #endif
}

export function mpImageCheck(storagePath: string, bucket = 'item-images'): void {
  // #ifdef MP-WEIXIN
  if (!storagePath) return
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const mediaUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`
  callSeccheck({ kind: 'image', media_url: mediaUrl, bucket, storage_path: storagePath })
    .catch(() => { /* fire-and-forget */ })
  // #endif
}
