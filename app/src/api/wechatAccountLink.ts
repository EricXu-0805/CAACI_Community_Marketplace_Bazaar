import { platformFetch } from '../composables/useSupabase'
import { BASE_URL } from '../config/runtime'
import { readBoundedJsonResponse } from './boundedJson'

export type WechatAction = 'capabilities' | 'login' | 'link_status' | 'link_issue' | 'link_preview' | 'link_confirm'
export interface WechatLinkPreview { nickname: string; email_label: string; expires_at: string; confirmation: string }

/** Never persist or put link codes, provider codes or confirmation proofs in URLs. */
export async function wechatAccountRequest<T = Record<string, any>>(
  action: WechatAction, fields: Record<string, unknown> = {}, accessToken = '',
): Promise<T> {
  const response = await platformFetch(`${BASE_URL}/api/auth/wechat-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ ...fields, action }),
  })
  const payload = await readBoundedJsonResponse<Record<string, any>>(response, 64 * 1024)
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'link_unavailable')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('link_unavailable')
  return payload as T
}

export async function wechatCapabilities(): Promise<{ login: boolean; account_link: boolean; unavailable: boolean }> {
  try {
    const result = await wechatAccountRequest('capabilities')
    if (typeof result.login !== 'boolean' || typeof result.account_link !== 'boolean') throw new Error('link_unavailable')
    return { login: result.login, account_link: result.login && result.account_link, unavailable: false }
  } catch (error) {
    // Only the server's explicit release gate means "not available yet".
    // A timeout or malformed response should offer retry, not pretend that
    // the user's sign-in method no longer exists.
    return { login: false, account_link: false,
      unavailable: !(error instanceof Error && error.message === 'wechat_login_disabled') }
  }
}

export function freshWechatCode(): Promise<string> {
  // #ifndef MP-WEIXIN
  return Promise.reject(new Error('wechat_login_only_available_on_mp_weixin'))
  // #endif
  // #ifdef MP-WEIXIN
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish('', new Error('wechat_exchange_unavailable')), 15_000)
    function finish(code: string, error?: Error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(code)
    }
    try {
      uni.login({ provider: 'weixin',
        success: (res: any) => res?.code ? finish(res.code) : finish('', new Error('wechat_code_rejected')),
        fail: () => finish('', new Error('wechat_exchange_unavailable')),
      })
    } catch { finish('', new Error('wechat_exchange_unavailable')) }
  })
  // #endif
}

export function wechatErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (['reauth_required','already_linked','link_expired','link_conflict','wechat_account_not_linked','rate_limited','account_changed'].includes(code)) {
    return `wechat.${code}`
  }
  return 'wechat.unavailable'
}
