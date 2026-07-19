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
 *     friendlyErrorMessage. A fully unconfigured server may explicitly report
 *     `not_configured`; once enabled, network/provider/payload failures and
 *     missing/mismatched auth identity fail closed before the write.
 *
 *   mpImageCheck(storagePath)   — awaited durable async handoff
 *     (media_check_async). The upload is not exposed to a post/message until
 *     the API has persisted trace_id → object; otherwise the caller removes
 *     the unreferenced object and surfaces an upload failure. The verdict then
 *     lands on /api/wechat-callback, which deletes risky objects server-side.
 *
 * openid: msg_sec_check v2 wants the openid of a user who opened the mp
 * recently. The client never stores or supplies an openid: the server first
 * resolves the current JWT user's trusted profile binding, then (only for an
 * unbound email account) exchanges this request's fresh wx.login js_code.
 * This avoids carrying account A's stable WeChat identity into account B on
 * a shared device.
 */
import { BASE_URL } from '../config/runtime'
import { useSupabase, platformFetch } from './useSupabase'
import { readBoundedJson } from '../api/responseBody'
import {
  hasDurableWechatMediaHandoff,
  wechatTextGateOutcome,
} from '../api/wechatSecCheckContract'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  type AccountRequestToken,
} from './accountScope'
import {
  registerAccountPrivateStateHydrate,
  removeAccountPrivateStorage,
} from '../api/accountLocalPrivacy'

// Retired unscoped cache from older clients. It is never read again; remove it
// eagerly and at every auth generation change so a shared device does not keep
// a previous visitor's stable WeChat identifier at rest.
const LEGACY_OPENID_KEY = 'wechat_seccheck_openid'
const MAX_WECHAT_GATE_RESPONSE_BYTES = 64 * 1024

function clearLegacyOpenidCache() {
  removeAccountPrivateStorage(LEGACY_OPENID_KEY)
}

clearLegacyOpenidCache()
registerAccountPrivateStateHydrate(clearLegacyOpenidCache)

/* Scene codes from the msg_sec_check API: 1 资料 2 评论 3 论坛 4 社交日志. */
export type SecScene = 1 | 2 | 3 | 4

class WechatIdentityBoundaryError extends Error {
  readonly code = 'wechat_identity_unavailable'

  constructor() {
    super('wechat_identity_unavailable')
    this.name = 'WechatIdentityBoundaryError'
  }
}

function identityBoundaryError(): WechatIdentityBoundaryError {
  return new WechatIdentityBoundaryError()
}

interface AuthenticatedBearer {
  token: string
  accountToken: AccountRequestToken
}

async function authenticatedBearer(
  expectedAccountToken?: AccountRequestToken,
): Promise<AuthenticatedBearer> {
  try {
    const { supabase } = useSupabase()
    const entryUserId = getActiveAccountId()
    const accountToken = expectedAccountToken
      || (entryUserId ? captureAccountRequest(entryUserId) : null)
    if (!accountToken || !isAccountRequestCurrent(accountToken)) throw identityBoundaryError()
    const { data: { session } } = await supabase.auth.getSession()
    if (
      !session?.user?.id
      || !session.access_token
      || session.user.id !== accountToken.userId
      || !isAccountRequestCurrent(accountToken)
    ) throw identityBoundaryError()
    return { token: session.access_token, accountToken }
  } catch {
    throw identityBoundaryError()
  }
}

function assertAccountCurrent(accountToken: AccountRequestToken) {
  if (!isAccountRequestCurrent(accountToken)) throw identityBoundaryError()
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

async function callSeccheck(
  payload: Record<string, unknown>,
  options: { failureCode: 'moderation_gate_unavailable' | 'wechat_media_check_unavailable' },
  expectedAccountToken?: AccountRequestToken,
): Promise<Record<string, unknown>> {
  const { token, accountToken } = await authenticatedBearer(expectedAccountToken)
  assertAccountCurrent(accountToken)
  const body: Record<string, unknown> = { ...payload }
  const jsCode = await freshJsCode()
  assertAccountCurrent(accountToken)
  if (jsCode) body.js_code = jsCode
  assertAccountCurrent(accountToken)
  let res: Response
  try {
    res = await platformFetch(`${BASE_URL}/api/wechat-seccheck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    assertAccountCurrent(accountToken)
    throw new Error(options.failureCode)
  }
  assertAccountCurrent(accountToken)
  if (!res.ok) {
    const detail = await readBoundedJson<any>(res, {
      maxBytes: MAX_WECHAT_GATE_RESPONSE_BYTES,
      timeoutMs: 10_000,
    }).catch(() => null)
    assertAccountCurrent(accountToken)
    if (detail?.error === 'wechat_identity_unavailable') throw identityBoundaryError()
    throw new Error(options.failureCode)
  }
  let data: unknown
  try {
    data = await readBoundedJson(res, {
      maxBytes: MAX_WECHAT_GATE_RESPONSE_BYTES,
      timeoutMs: 10_000,
    })
  } catch {
    assertAccountCurrent(accountToken)
    throw new Error(options.failureCode)
  }
  assertAccountCurrent(accountToken)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(options.failureCode)
  }
  return data as Record<string, unknown>
}

export async function mpTextGate(
  content: string,
  scene: SecScene,
  expectedAccountToken?: AccountRequestToken,
): Promise<void> {
  // #ifdef MP-WEIXIN
  if (!content || !content.trim()) return
  const data = await callSeccheck(
    { kind: 'text', content, scene },
    { failureCode: 'moderation_gate_unavailable' },
    expectedAccountToken,
  )
  const outcome = wechatTextGateOutcome(data)
  if (outcome === 'disabled' || outcome === 'pass') return
  if (outcome === 'block') {
    throw new Error('moderation_block:wechat')
  }
  throw new Error('moderation_gate_unavailable')
  // #endif
}

export async function mpImageCheck(
  storagePath: string,
  bucket = 'item-images',
  expectedAccountToken?: AccountRequestToken,
): Promise<void> {
  // #ifdef MP-WEIXIN
  if (!storagePath) return
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const mediaUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`
  const result = await callSeccheck(
    { kind: 'image', media_url: mediaUrl, bucket, storage_path: storagePath },
    { failureCode: 'wechat_media_check_unavailable' },
    expectedAccountToken,
  )
  if (!hasDurableWechatMediaHandoff(result)) {
    throw new Error('wechat_media_check_unavailable')
  }
  // #endif
}
