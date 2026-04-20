/*
 * Client device fingerprint.
 *
 * Produces a stable-enough hash per browser/device for abuse-detection
 * signals only. This is NOT a PII identifier — it exists to detect:
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
 *   · Two users on the same campus-issued laptop with the same Chrome
 *     will collide. That's intentional — we want shared family
 *     devices to NOT trip as ban-evasion. The localStorage salt
 *     differentiates distinct installs on the same hardware class.
 *   · The raw signal is hashed SHA-256 before it ever leaves the
 *     device. Server only ever sees the hex digest.
 */

const SALT_KEY = 'device_salt_v1'

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  try {
    (globalThis as any).crypto?.getRandomValues?.(bytes)
  } catch {}
  let fallback = false
  if (bytes.every((b) => b === 0)) fallback = true
  if (fallback) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getOrCreateSalt(): string {
  try {
    const existing = uni.getStorageSync(SALT_KEY)
    if (typeof existing === 'string' && existing.length === 32) return existing
    const fresh = randomSalt()
    uni.setStorageSync(SALT_KEY, fresh)
    return fresh
  } catch {
    return 'nosalt'
  }
}

function collectSignal(): string {
  const parts: string[] = []
  parts.push('v1')
  parts.push(getOrCreateSalt())

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

function fnv1aHex(s: string): string {
  let h1 = 0x811c9dc5 >>> 0
  let h2 = 0x12345678 >>> 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 ^= c
    h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0
    h2 ^= c
    h2 = (h2 + ((h2 << 2) + (h2 << 3) + (h2 << 5) + (h2 << 11) + (h2 << 20))) >>> 0
  }
  const pad = (n: number) => n.toString(16).padStart(8, '0')
  return (pad(h1) + pad(h2) + pad(h1 ^ h2) + pad((h1 + h2) >>> 0)).padEnd(32, '0')
}

export async function deviceFingerprintHash(): Promise<string> {
  const signal = collectSignal()
  const web = await sha256HexWebCrypto(signal)
  if (web) return web
  return fnv1aHex(signal)
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
