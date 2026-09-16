/** Durable private object keys only. Never accept URLs, tokens, or old public uploads. */
export const CHAT_MEDIA_BUCKET = 'chat-media'
export const CHAT_MEDIA_URL_TTL = 60
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY = new RegExp(`^items/(${UUID})/(${UUID})/(${UUID})\\.(jpg|png|webp|gif|mp4|mov|webm)$`)
export function validChatMediaPath(path: unknown, type: unknown, sender?: unknown, conversation?: unknown, messageId?: unknown): path is string {
  if (typeof path !== 'string') return false
  const match = KEY.exec(path)
  if (!match || (type !== 'image' && type !== 'video')) return false
  if (sender && sender !== match[1] || conversation && conversation !== match[2] || messageId && messageId !== match[3]) return false
  return type === 'image' ? ['jpg','png','webp','gif'].includes(match[4]) : ['mp4','mov','webm'].includes(match[4])
}
