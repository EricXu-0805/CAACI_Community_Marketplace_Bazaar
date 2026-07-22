const ITEM_IMAGE_PUBLIC_MARKER = '/storage/v1/object/public/item-images/'
const ITEM_IMAGE_RENDER_MARKER = '/storage/v1/render/image/public/item-images/'

/**
 * Convert one of our public/rendered item image URLs back to the object path
 * accepted by Supabase Storage.  The ownership check is deliberately local:
 * callers must never be able to turn an arbitrary URL into another user's
 * delete target, even if a future bucket policy is accidentally widened.
 */
export function ownedItemImagePath(url: string, userId: string, expectedOrigin: string): string | null {
  if (!url || !userId || !expectedOrigin) return null

  try {
    const parsed = new URL(url)
    const storageOrigin = new URL(expectedOrigin).origin
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.origin !== storageOrigin
    ) return null

    const marker = parsed.pathname.includes(ITEM_IMAGE_PUBLIC_MARKER)
      ? ITEM_IMAGE_PUBLIC_MARKER
      : parsed.pathname.includes(ITEM_IMAGE_RENDER_MARKER)
        ? ITEM_IMAGE_RENDER_MARKER
        : ''
    if (!marker) return null

    const encodedPath = parsed.pathname.slice(parsed.pathname.indexOf(marker) + marker.length)
    const path = decodeURIComponent(encodedPath)
    const segments = path.split('/')
    if (
      segments.length < 3 ||
      segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0')) ||
      segments[0] !== 'items' ||
      segments[1] !== userId
    ) {
      return null
    }
    return path
  } catch {
    return null
  }
}

export function ownedItemImagePaths(
  urls: Array<string | null | undefined>,
  userId: string,
  expectedOrigin: string,
): string[] {
  return [...new Set(
    urls
      .map(url => ownedItemImagePath(url || '', userId, expectedOrigin))
      .filter((path): path is string => !!path),
  )]
}
