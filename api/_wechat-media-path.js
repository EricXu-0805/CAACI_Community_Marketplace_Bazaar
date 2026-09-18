// A signed URL is a capability. Only mint one for the caller's own canonical
// chat photo; participant/object authorization is then checked by Storage RLS.
export function isOwnWechatChatPhoto(path, owner) {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const match = typeof path === 'string'
    && new RegExp(`^items/(${uuid})/(${uuid})/(${uuid})\\.(jpg|png|gif)$`).exec(path)
  return !!match && match[1] === owner
}

export function trustedWechatPhotoUrl(signedUrl, supabaseUrl, path) {
  if (typeof signedUrl !== 'string' || signedUrl.length > 8192) return null
  try {
    const base = new URL(supabaseUrl)
    const url = new URL(signedUrl, `${base.origin}/storage/v1/`)
    // Storage's REST response is /object/sign/..., relative to /storage/v1.
    if (signedUrl.startsWith('/object/sign/')) url.pathname = `/storage/v1${url.pathname}`
    if (url.origin !== base.origin || url.username || url.password || url.hash
      || url.pathname !== `/storage/v1/object/sign/chat-media/${path}`
      || !url.searchParams.get('token')) return null
    return url.href
  } catch { return null }
}
