// Only move an object in the author's own upload folder. Database image URLs
// are user input; neither another origin nor a normalized traversal is trusted.
export function moderationObjectKeys(images, ownerId, supabaseUrl) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId || '')) return []
  let expectedOrigin
  try { expectedOrigin = new URL(supabaseUrl).origin } catch { return [] }
  const prefix = '/storage/v1/object/public/item-images/'
  const keys = new Set()
  for (const raw of Array.isArray(images) ? images : []) {
    if (typeof raw !== 'string') continue
    let parsed, key
    try {
      parsed = new URL(raw)
      if (parsed.origin !== expectedOrigin || parsed.username || parsed.password || !parsed.pathname.startsWith(prefix)) continue
      key = decodeURIComponent(parsed.pathname.slice(prefix.length))
    } catch { continue }
    const segments = key.split('/')
    if (segments.length !== 3 || segments[0] !== 'items' || segments[1] !== ownerId) continue
    if (!segments[2] || ['.', '..'].includes(segments[2]) || /[\\\u0000-\u001f\u007f]/.test(key)) continue
    keys.add(key)
  }
  return [...keys]
}

// Storage may encode a missing source as HTTP 400 with its own 404 status.
// Accept only that exact object-not-found result, never arbitrary 400 errors.
export function mediaMoveSucceeded(response, text) {
  if (response.ok || response.status === 404) return true
  if (response.status !== 400) return false
  try {
    const body = JSON.parse(text)
    return String(body.statusCode) === '404' && body.error === 'not_found'
      && body.message === 'Object not found'
  } catch { return false }
}
