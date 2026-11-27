import { onUnmounted, ref, watch } from 'vue'
import { captureActiveAccountRequest, isAccountRequestCurrent, type AccountRequestToken } from '../../../composables/accountScope'
import {
  readAccountPrivateStorage, registerAccountPrivateStateReset,
  removeAccountPrivateStorage, writeAccountPrivateStorage,
} from '../../../api/accountLocalPrivacy'
import { createClientMessageId } from '../../../api/clientMessageId'

// Editable form state; postId belongs to the logical publication, not a retry.
interface MemberEventDraft {
  readonly postId: string
  title: string
  content: string
  location: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  outcomeUncertain: boolean
}
const KEY = 'events_create_draft_v1'
const fresh = (): MemberEventDraft => ({
  postId: createClientMessageId(), title: '', content: '', location: '',
  startDate: '', startTime: '', endDate: '', endTime: '', outcomeUncertain: false,
})

export function useMemberEventDraft() {
  const draft = ref<MemberEventDraft>(fresh())
  let owner: AccountRequestToken | null = null
  const isCurrent = () => isAccountRequestCurrent(owner)
  const persist = () => isCurrent() && writeAccountPrivateStorage(KEY, draft.value)
  function restore() {
    owner = captureActiveAccountRequest()
    const saved = readAccountPrivateStorage<unknown>(KEY, null).value
    if (saved && typeof saved === 'object'
      && 'postId' in saved && typeof saved.postId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.postId)
      && 'title' in saved && typeof saved.title === 'string'
      && 'content' in saved && typeof saved.content === 'string'
      && 'location' in saved && typeof saved.location === 'string'
      && 'startDate' in saved && typeof saved.startDate === 'string'
      && 'startTime' in saved && typeof saved.startTime === 'string'
      && 'endDate' in saved && typeof saved.endDate === 'string'
      && 'endTime' in saved && typeof saved.endTime === 'string'
      && 'outcomeUncertain' in saved && typeof saved.outcomeUncertain === 'boolean') {
      draft.value = {
        postId: saved.postId, title: saved.title, content: saved.content, location: saved.location,
        startDate: saved.startDate, startTime: saved.startTime, endDate: saved.endDate, endTime: saved.endTime,
        outcomeUncertain: saved.outcomeUncertain,
      }
    } else draft.value = fresh()
  }
  function clear() {
    const current = isCurrent()
    owner = null
    if (current) removeAccountPrivateStorage(KEY)
    draft.value = fresh()
  }
  watch(draft, () => { persist() }, { deep: true })
  const unregister = registerAccountPrivateStateReset(() => {
    owner = null
    draft.value = fresh()
  })
  onUnmounted(unregister)
  return { draft, restore, persist, clear, isCurrent }
}
