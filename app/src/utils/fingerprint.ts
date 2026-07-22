/*
 * Client device fingerprint.
 *
 * Produces a stable-enough, pseudonymous hash per app/browser installation
 * for abuse-review signals only. It is personal-data-adjacent and must never
 * be treated as proof that two accounts belong to the same person. It helps
 * reviewers notice:
 *   · one person operating multiple accounts to evade a ban
 *   · one device rotating through burner accounts to spam
 *
 * Design trade-offs:
 *   · We intentionally AVOID canvas/webgl/font enumeration. Those
 *     identify an individual too precisely and invite privacy
 *     complaints. We use only coarse, hash-on-device signals:
 *       - screen resolution bucket
 *       - hardware concurrency bucket
 *       - timezone offset
 *       - language / platform
 *       - persistent localStorage salt (per-install random)
 *   · Clearing app/browser storage, private browsing, changing browsers, or
 *     reinstalling creates a new identifier. Multiple people can also share
 *     one installation. The signal is therefore neither a physical-device ID
 *     nor a safe basis for automatic enforcement.
 *   · The raw signal is hashed SHA-256 before it ever leaves the
 *     device. Server only ever sees the hex digest.
 *   · If secure randomness, durable storage, or SHA-256 is unavailable, the
 *     function returns null and records nothing. A weak/colliding fallback is
 *     worse than a missing advisory signal.
 */

const SALT_KEY = 'device_salt_v1'

function secureRandomSalt(): string | null {
  const bytes = new Uint8Array(16)
  try {
    const cryptoApi = (globalThis as any).crypto
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') return null
    cryptoApi.getRandomValues(bytes)
  } catch { return null }
  if (bytes.every((byte) => byte === 0)) return null
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getOrCreateSalt(): string | null {
  try {
    const existing = uni.getStorageSync(SALT_KEY)
    if (typeof existing === 'string' && /^[0-9a-f]{32}$/.test(existing)) return existing
    const fresh = secureRandomSalt()
    if (!fresh) return null
    uni.setStorageSync(SALT_KEY, fresh)
    // A storage engine that acknowledges but drops writes would otherwise
    // generate a different hash on every launch and pollute the abuse table.
    return uni.getStorageSync(SALT_KEY) === fresh ? fresh : null
  } catch {
    return null
  }
}

function collectSignal(salt: string): string {
  const parts: string[] = []
  parts.push('v1')
  parts.push(salt)

  // #ifdef H5
  try {
    if (typeof navigator !== 'undefined') {
      parts.push(navigator.platform || '')
      parts.push(navigator.language || '')
      parts.push(String((navigator as any).hardwareConcurrency || 0))
    }
    if (typeof screen !== 'undefined') {
      const w = Math.round((screen.width || 0) / 64) * 64
      const h = Math.round((screen.height || 0) / 64) * 64
      parts.push(`${w}x${h}`)
      parts.push(String(screen.colorDepth || 0))
    }
    parts.push(String(new Date().getTimezoneOffset()))
  } catch {}
  // #endif

  // #ifndef H5
  try {
    const info = uni.getSystemInfoSync()
    parts.push(info.platform || '')
    parts.push(info.osVersion || '')
    parts.push(info.brand || '')
    parts.push(info.model || '')
    parts.push(info.language || '')
    const w = Math.round((info.screenWidth || 0) / 64) * 64
    const h = Math.round((info.screenHeight || 0) / 64) * 64
    parts.push(`${w}x${h}`)
  } catch {}
  // #endif

  return parts.join('|')
}

async function sha256HexWebCrypto(s: string): Promise<string | null> {
  try {
    const subtle = (globalThis as any).crypto?.subtle
    if (!subtle) return null
    const buf = new TextEncoder().encode(s)
    const digest = await subtle.digest('SHA-256', buf)
    const bytes = new Uint8Array(digest)
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export async function deviceFingerprintHash(): Promise<string | null> {
  const salt = getOrCreateSalt()
  if (!salt) return null
  return sha256HexWebCrypto(collectSignal(salt))
}

export function deviceUASnippet(): string {
  try {
    // #ifdef H5
    if (typeof navigator !== 'undefined') {
      return (navigator.userAgent || '').slice(0, 120)
    }
    // #endif
    // #ifndef H5
    const info = uni.getSystemInfoSync()
    return `${info.platform || ''}/${info.osVersion || ''}/${info.brand || ''}/${info.model || ''}`.slice(0, 120)
    // #endif
  } catch {
    return ''
  }
  return ''
}
