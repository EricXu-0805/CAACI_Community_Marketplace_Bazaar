import { isAccountRequestCurrent, type AccountRequestToken } from '../composables/accountScope'
import { mpImageCheck } from '../composables/useWechatSecCheck'
import { useSupabase, platformFetch } from '../composables/useSupabase'
import { compressImage } from '../utils'
import { CHAT_MEDIA_BUCKET, validChatMediaPath } from '../utils/chatMedia'
import { waitForChatVideoReview } from './chatVideoReview'
import { preferredSupabasePublicKey } from '../utils/supabaseKeys'

function deadline<T>(work: Promise<T>, ms = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([work, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('chat_media_timeout')), ms)
  })]).finally(() => clearTimeout(timer))
}

/** Private upload and durable moderation handoff; never writes a message. */
export async function uploadMiniChatPhoto(file: string, conversationId: string, messageId: string, token: AccountRequestToken, mediaType: 'image' | 'video' = 'image'): Promise<string> {
  const current = () => { if (!isAccountRequestCurrent(token)) throw new Error('account_changed') }
  current()
  const { supabase } = useSupabase()
  const { data: { session } } = await deadline(supabase.auth.getSession())
  current()
  if (!session?.access_token || session.user.id !== token.userId) throw new Error('account_changed')
  const source = mediaType === 'image' ? await deadline(compressImage(file, { entryPoint: 'chat', maxLongEdge: 1600, quality: 0.86 })) : file
  current()
  const [image, info] = await deadline(Promise.all([
    mediaType === 'image'
      ? new Promise<{ type?: string; duration?: number }>((resolve, reject) => uni.getImageInfo({ src: source, success: resolve, fail: reject }))
      : new Promise<{ type?: string; duration?: number }>((resolve, reject) => uni.getVideoInfo({ src: source, success: resolve, fail: reject })),
    new Promise<{ size: number }>((resolve, reject) => uni.getFileInfo({ filePath: source, success: resolve, fail: reject })),
  ]))
  current()
  const formats: Record<string, string> = mediaType === 'image' ? { jpeg: 'jpg', jpg: 'jpg', png: 'png', gif: 'gif' } : { mp4: 'mp4', mov: 'mov', quicktime: 'mov' }
  const extension = formats[String(image.type || '').toLowerCase()]
  if (mediaType === 'video' && (!Number.isFinite(image.duration) || image.duration! <= 0 || image.duration! > 60)) throw new Error('chat_media_invalid_file')
  if (!extension) throw new Error('chat_media_invalid_file')
  if (!Number.isFinite(info.size) || info.size <= 0 || info.size > (mediaType === 'image' ? 5 : 20) * 1024 * 1024) throw new Error('chat_media_too_large')
  const path = `items/${token.userId}/${conversationId}/${messageId}.${extension}`
  if (!validChatMediaPath(path, mediaType, token.userId, conversationId, messageId)) throw new Error('chat_media_invalid_reference')
  const base = import.meta.env.VITE_SUPABASE_URL
  const apikey = preferredSupabasePublicKey(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, import.meta.env.VITE_SUPABASE_ANON_KEY)
  if (!apikey) throw new Error('chat_media_platform_unavailable')
  // Cleanup uses the initiating account's bearer, never a later account's
  // session. Storage RLS refuses deletion if this photo is already delivered.
  const cleanup = async () => {
    try {
      await platformFetch(`${base}/storage/v1/object/${CHAT_MEDIA_BUCKET}`, {
        method: 'DELETE', headers: { apikey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }),
      })
    } catch { /* The existing orphan collector retries abandoned uploads. */ }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false, timedOut = false
      let task: { abort?: () => void } | undefined
      const timer = setTimeout(() => {
        if (settled) return
        settled = true; timedOut = true
        try { task?.abort?.() } catch {}
        reject(new Error('chat_media_timeout'))
      }, 45_000)
      try {
        task = uni.uploadFile({
          url: `${base}/storage/v1/object/${CHAT_MEDIA_BUCKET}/${path}`,
          filePath: source, name: 'file', formData: { cacheControl: '0' },
          header: { apikey, Authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
          success: response => {
            if (timedOut) { void cleanup(); return }
            if (settled) return
            settled = true; clearTimeout(timer)
            if (response.statusCode >= 200 && response.statusCode < 300) resolve()
            else reject(new Error('chat_media_upload_failed'))
          },
          fail: error => {
            if (timedOut) { void cleanup(); return }
            if (settled) return
            settled = true; clearTimeout(timer); reject(error)
          },
        }) as unknown as { abort?: () => void }
      } catch (error) { settled = true; clearTimeout(timer); reject(error) }
    })
    current()
    if (mediaType === 'image') await mpImageCheck(path, CHAT_MEDIA_BUCKET, token)
    else await waitForChatVideoReview(path, token)
    current()
    return path
  } catch (error) { void cleanup(); throw error }
}
