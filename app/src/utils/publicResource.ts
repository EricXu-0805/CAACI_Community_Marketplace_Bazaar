const MAX_PUBLIC_URL_BYTES = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_OBJECT_SUFFIX_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,299}$/
const I18N_KEYS = new Set(['zh', 'en', 'ja', 'ko', 'zh-Hant'])
const PUBLIC_OBJECT_MARKER = '/storage/v1/object/public/'
const PUBLIC_IMAGE_RENDER_MARKER = '/storage/v1/render/image/public/'
const MANAGED_BANNER_PATH_RE = /^\/storage\/v1\/object\/public\/banners\/managed\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{64}\.(?:png|jpg|webp)$/i

function configuredSupabaseOrigin(): string {
  const raw = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.search || url.hash) return ''
    // Hosted production must be HTTPS.  Exact localhost origins remain usable
    // for the local Supabase stack and are never accepted by a production build
    // unless that exact origin was deliberately compiled into it.
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return ''
    return url.origin
  } catch {
    return ''
  }
}

export const PUBLIC_STORAGE_ORIGIN = configuredSupabaseOrigin()

/**
 * Public banners are renderable only after the admin upload saga has produced
 * a deterministic managed object. This client-side check is intentionally
 * redundant with the admin API and database trigger: historical/direct rows
 * must never turn the carousel into a third-party tracking-pixel surface.
 */
export function safeManagedBannerUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || !PUBLIC_STORAGE_ORIGIN) return ''
  if (raw.length > MAX_PUBLIC_URL_BYTES || utf8Length(raw) > MAX_PUBLIC_URL_BYTES) return ''
  try {
    const url = new URL(raw)
    if (
      url.origin !== PUBLIC_STORAGE_ORIGIN
      || url.username
      || url.password
      || url.search
      || url.hash
      || !MANAGED_BANNER_PATH_RE.test(url.pathname)
    ) return ''
    return url.href
  } catch {
    return ''
  }
}

export function utf8Length(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit <= 0x7f) {
      bytes += 1
    } else if (unit <= 0x7ff) {
      bytes += 2
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        // WHATWG UTF-8 encoders replace an unpaired surrogate with U+FFFD.
        bytes += 3
      }
    } else {
      // BMP code points and unpaired low surrogates both occupy three bytes
      // after replacement. No TextEncoder/Blob/Web API is required on JSCore.
      bytes += 3
    }
  }
  return bytes
}

function parseOwnedItemObject(
  raw: unknown,
  expectedOwner?: string | null,
): { url: string; owner: string; objectName: string } | null {
  if (typeof raw !== 'string' || !raw || !PUBLIC_STORAGE_ORIGIN) return null
  if (raw.length > MAX_PUBLIC_URL_BYTES || utf8Length(raw) > MAX_PUBLIC_URL_BYTES) return null
  try {
    const url = new URL(raw)
    if (
      url.origin !== PUBLIC_STORAGE_ORIGIN
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return null

    const prefix = '/storage/v1/object/public/item-images/items/'
    if (!url.pathname.startsWith(prefix)) return null
    const remainder = url.pathname.slice(prefix.length)
    const slash = remainder.indexOf('/')
    if (slash <= 0) return null
    const owner = remainder.slice(0, slash)
    const suffix = remainder.slice(slash + 1)
    if (!UUID_RE.test(owner)) return null
    if (expectedOwner && owner.toLowerCase() !== expectedOwner.toLowerCase()) return null
    if (
      !SAFE_OBJECT_SUFFIX_RE.test(suffix)
      || suffix.includes('//')
      || suffix.includes('/./')
      || suffix.includes('/../')
      || suffix.endsWith('.')
      || suffix.endsWith('/')
    ) return null

    return {
      url: url.href,
      owner,
      objectName: `items/${owner}/${suffix}`,
    }
  } catch {
    return null
  }
}

export function safeItemMediaUrl(raw: unknown, expectedOwner?: string | null): string {
  return parseOwnedItemObject(raw, expectedOwner)?.url || ''
}

export function safeAvatarUrl(raw: unknown, expectedOwner?: string | null): string {
  return safeItemMediaUrl(raw, expectedOwner)
}

/**
 * Validate an avatar and its owning profile before constructing the Supabase
 * image-transform URL.  Unlike the generic thumb helper, this API requires an
 * owner so raw profile rows from any fetch surface cannot accidentally render
 * another account's object.
 */
export function safeAvatarThumbUrl(
  raw: unknown,
  expectedOwner: string | null | undefined,
): string {
  if (typeof expectedOwner !== 'string' || !UUID_RE.test(expectedOwner)) return ''
  const safeUrl = safeAvatarUrl(raw, expectedOwner)
  if (!safeUrl) return ''
  return `${safeUrl.replace(PUBLIC_OBJECT_MARKER, PUBLIC_IMAGE_RENDER_MARKER)}?width=96&height=96&quality=75&resize=cover`
}

export function safeItemMediaUrls(raw: unknown, expectedOwner?: string | null): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const safe: string[] = []
  for (const candidate of raw) {
    const url = safeItemMediaUrl(candidate, expectedOwner)
    if (url && !seen.has(url)) {
      seen.add(url)
      safe.push(url)
    }
  }
  return safe
}

type UnknownRecord = Record<string, any>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function sanitizeProfileResource<T>(profile: T): T {
  if (!isRecord(profile)) return profile
  return {
    ...profile,
    avatar_url: safeAvatarUrl(profile.avatar_url, typeof profile.id === 'string' ? profile.id : null),
  } as T
}

function safeDimensions(raw: unknown, imageCount: number): Array<{ w: number; h: number }> {
  if (!Array.isArray(raw) || raw.length === 0) return []
  if (raw.length !== imageCount) return []
  const result: Array<{ w: number; h: number }> = []
  for (const entry of raw) {
    if (!isRecord(entry)) return []
    const keys = Object.keys(entry)
    if (keys.length !== 2 || !keys.includes('w') || !keys.includes('h')) return []
    const w = entry.w
    const h = entry.h
    if (
      !Number.isInteger(w)
      || !Number.isInteger(h)
      || w < 1
      || h < 1
      || w > 8192
      || h > 8192
      || w * h > 24_000_000
    ) return []
    result.push({ w, h })
  }
  return result
}

export function sanitizeItemResources<T>(item: T): T {
  if (!isRecord(item)) return item
  const owner = typeof item.user_id === 'string' ? item.user_id : null
  const images = safeItemMediaUrls(item.images, owner)
  return {
    ...item,
    images,
    image_dimensions: safeDimensions(item.image_dimensions, images.length),
    profile: item.profile ? sanitizeProfileResource(item.profile) : item.profile,
  } as T
}

export function sanitizePostResources<T>(post: T): T {
  if (!isRecord(post)) return post
  const owner = typeof post.user_id === 'string' ? post.user_id : null
  const images = safeItemMediaUrls(post.images, owner)
  const postItems = Array.isArray(post.post_items)
    ? post.post_items.map((entry: any) => (
      isRecord(entry) && entry.item
        ? { ...entry, item: sanitizeItemResources(entry.item) }
        : entry
    ))
    : post.post_items
  return {
    ...post,
    images,
    image_dimensions: safeDimensions(post.image_dimensions, images.length),
    profile: post.profile ? sanitizeProfileResource(post.profile) : post.profile,
    post_items: postItems,
  } as T
}

export function sanitizeConversationResources<T>(conversation: T): T {
  if (!isRecord(conversation)) return conversation
  return {
    ...conversation,
    item: conversation.item ? sanitizeItemResources(conversation.item) : conversation.item,
    buyer: conversation.buyer ? sanitizeProfileResource(conversation.buyer) : conversation.buyer,
    seller: conversation.seller ? sanitizeProfileResource(conversation.seller) : conversation.seller,
  } as T
}

export function sanitizeMessageResources<T>(message: T): T {
  if (!isRecord(message)) return message
  return {
    ...message,
    // Historical media lived in a public listing bucket.  Keep the durable row
    // and type for evidence/preview text, but never auto-load its public URL.
    content: message.message_type === 'text' ? message.content : '',
    sender: message.sender ? sanitizeProfileResource(message.sender) : message.sender,
  } as T
}

export function assertPublicMediaWrite(
  urls: unknown,
  owner: string,
  cap: number,
  dimensions?: unknown,
): asserts urls is string[] {
  if (!Array.isArray(urls) || urls.length > cap) throw new Error('invalid_public_media')
  const safe = safeItemMediaUrls(urls, owner)
  if (safe.length !== urls.length) throw new Error('invalid_public_media')
  if (dimensions !== undefined && safeDimensions(dimensions, urls.length).length !== (Array.isArray(dimensions) ? dimensions.length : -1)) {
    // Empty dimensions is the explicit legacy/unknown form; non-empty must be
    // an exact one-to-one array.
    if (!Array.isArray(dimensions) || dimensions.length !== 0) {
      throw new Error('invalid_image_dimensions')
    }
  }
}

export function assertI18nWrite(
  payload: unknown,
  maximumValueChars: number,
  maximumValueBytes: number,
  maximumTotalBytes: number,
): void {
  if (payload == null) return
  if (!isRecord(payload)) throw new Error('invalid_i18n_payload')
  const entries = Object.entries(payload)
  if (entries.length < 1 || entries.length > 5) throw new Error('invalid_i18n_payload')
  if (utf8Length(JSON.stringify(payload)) > maximumTotalBytes) throw new Error('invalid_i18n_payload')
  for (const [key, value] of entries) {
    if (!I18N_KEYS.has(key) || typeof value !== 'string') throw new Error('invalid_i18n_payload')
    if (!value.trim() || value.length > maximumValueChars || utf8Length(value) > maximumValueBytes) {
      throw new Error('invalid_i18n_payload')
    }
  }
}
