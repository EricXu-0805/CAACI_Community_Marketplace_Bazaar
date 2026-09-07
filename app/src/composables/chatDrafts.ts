import { isAccountRequestCurrent, onAccountTransition, type AccountRequestToken } from './accountScope'
import type { Message } from '../types'

export interface ChatDraft {
  text: string
  reply: Pick<Message, 'content' | 'message_type'> | null
}

// Private text only lives in this tab's memory. An account boundary erases it,
// including sign-out and forced reauthentication of the same account.
const drafts = new Map<string, ChatDraft>()
onAccountTransition(() => drafts.clear())

function copy(draft: ChatDraft): ChatDraft {
  return { text: draft.text, reply: draft.reply ? { ...draft.reply } : null }
}

export function readChatDraft(token: AccountRequestToken | null, conversationId: string): ChatDraft | null {
  if (!isAccountRequestCurrent(token)) return null
  const draft = drafts.get(conversationId)
  return draft ? copy(draft) : null
}

export function writeChatDraft(token: AccountRequestToken | null, conversationId: string, draft: ChatDraft): void {
  if (!conversationId || !isAccountRequestCurrent(token)) return
  if (!draft.text && !draft.reply) drafts.delete(conversationId)
  else drafts.set(conversationId, copy(draft))
}
