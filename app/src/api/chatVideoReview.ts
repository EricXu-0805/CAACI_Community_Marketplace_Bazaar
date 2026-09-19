import { isAccountRequestCurrent, type AccountRequestToken } from '../composables/accountScope'
import { useSupabase } from '../composables/useSupabase'

/** Only a server verdict permits delivery; never convert timeout into approval. */
export async function waitForChatVideoReview(path: string, token: AccountRequestToken): Promise<void> {
  const { supabase } = useSupabase()
  const end = Date.now() + 180_000
  while (Date.now() < end) {
    if (!isAccountRequestCurrent(token)) throw new Error('account_changed')
    let timer: ReturnType<typeof setTimeout> | undefined
    const { data, error } = await Promise.race([
      supabase.rpc('chat_video_review_status', { path_in: path }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('chat_video_review_timeout')), 10_000) }),
    ]).finally(() => { if (timer) clearTimeout(timer) })
    if (!isAccountRequestCurrent(token)) throw new Error('account_changed')
    if (error) throw new Error('chat_video_review_unavailable')
    if (data === 'passed') return
    if (!['pending', 'submitting', 'processing'].includes(data)) throw new Error('chat_video_review_unavailable')
    await new Promise(resolve => setTimeout(resolve, 2500))
  }
  throw new Error('chat_video_review_timeout')
}
