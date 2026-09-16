import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { captureAccountRequest, getActiveAccountId, isAccountRequestCurrent, onAccountTransition } from './accountScope'

const hiddenIds = ref<Set<string>>(new Set())
const changing = ref(false)
let loadedAt = 0
let loadVersion = 0
onAccountTransition(() => { hiddenIds.value = new Set(); changing.value = false; loadedAt = 0; loadVersion++ })

/** Private account feedback. A failed sync must not masquerade as an empty set. */
export function useDiscovery() {
  const { supabase } = useSupabase()
  async function loadHiddenItems(force = false) {
    const uid = getActiveAccountId()
    if (!uid) return
    if (!force && loadedAt && Date.now() - loadedAt < 30_000) return
    const token = captureAccountRequest(uid), version = ++loadVersion
    const { data, error } = await supabase.from('hidden_items').select('item_id').eq('user_id', uid).limit(1000)
    if (!isAccountRequestCurrent(token) || version !== loadVersion) return
    if (error || !Array.isArray(data)) throw error || new Error('discovery_preferences_unavailable')
    hiddenIds.value = new Set(data.map(row => row.item_id))
    loadedAt = Date.now()
  }
  async function setHidden(itemId: string, hidden: boolean) {
    const uid = getActiveAccountId()
    if (!uid || changing.value) return false
    const token = captureAccountRequest(uid)
    changing.value = true
    // An older preference read cannot undo this explicit choice.
    loadVersion++
    try {
      const result = hidden
        ? await supabase.from('hidden_items').insert({ user_id: uid, item_id: itemId }).select('item_id').single()
        : await supabase.from('hidden_items').delete().eq('user_id', uid).eq('item_id', itemId).select('item_id')
      if (!isAccountRequestCurrent(token)) return false
      if (result.error && !(hidden && result.error.code === '23505')) throw result.error
      loadVersion++
      const next = new Set(hiddenIds.value)
      if (hidden) next.add(itemId); else next.delete(itemId)
      hiddenIds.value = next
      loadedAt = 0
      return true
    } finally { if (isAccountRequestCurrent(token)) changing.value = false }
  }
  async function restoreAllHidden() {
    const uid = getActiveAccountId()
    if (!uid || changing.value) return false
    const token = captureAccountRequest(uid)
    changing.value = true; loadVersion++
    try {
      const { error } = await supabase.from('hidden_items').delete().eq('user_id', uid)
      if (!isAccountRequestCurrent(token)) return false
      if (error) throw error
      loadedAt = 0
      await loadHiddenItems(true)
      return isAccountRequestCurrent(token) && hiddenIds.value.size === 0
    } finally { if (isAccountRequestCurrent(token)) changing.value = false }
  }
  return { hiddenIds, changing, loadHiddenItems, setHidden, restoreAllHidden }
}
