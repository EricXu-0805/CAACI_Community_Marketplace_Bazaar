import { useSupabase, platformFetch } from './useSupabase'
import { isAccountRequestCurrent, type AccountRequestToken } from './accountScope'
import { compressImage, detectImageMimeType } from '../utils'
import { CHAT_MEDIA_BUCKET, validChatMediaPath } from '../utils/chatMedia'
// #ifdef MP-WEIXIN
import { uploadMiniChatPhoto } from '../api/miniChatPhoto'
// #endif

const TYPES: Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'}
export function useChatMedia() {
  const { supabase } = useSupabase()
  async function upload(file: string, type: 'image'|'video', conversationId: string, messageId: string, token: AccountRequestToken): Promise<string> {
    const current = () => { if (!isAccountRequestCurrent(token)) throw new Error('account_changed') }
    current()
    // #ifdef H5
    const source = type === 'image' ? await compressImage(file, {entryPoint:'chat',maxLongEdge:1600,quality:0.86}) : file
    current()
    const response = await platformFetch(source)
    const blob = await response.blob()
    const mime = type === 'image' ? await detectImageMimeType(blob) : blob.type
    if (!TYPES[mime] || !mime.startsWith(`${type}/`)) throw new Error('chat_media_invalid_file')
    if (!blob.size || blob.size > (type === 'image' ? 5 : 20)*1024*1024) throw new Error('chat_media_too_large')
    const path = `items/${token.userId}/${conversationId}/${messageId}.${TYPES[mime]}`
    if (!validChatMediaPath(path,type,token.userId,conversationId,messageId)) throw new Error('chat_media_invalid_reference')
    current()
    const result = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path,blob,{contentType:mime,cacheControl:'0',upsert:false})
    if (result.error) throw result.error
    current()
    return path
    // #endif
    // #ifdef MP-WEIXIN
    if (type === 'image' && import.meta.env.VITE_WECHAT_CHAT_PHOTOS_ENABLED === 'true') {
      return await uploadMiniChatPhoto(file, conversationId, messageId, token)
    }
    // #endif
    // #ifndef H5
    throw new Error('chat_media_platform_unavailable')
    // #endif
  }
  return { upload }
}
