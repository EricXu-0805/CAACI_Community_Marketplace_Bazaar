import { ref } from 'vue'
import type { Item, Post } from '../types'
import {
  readAccountPrivateStorage,
  registerAccountPrivateStateHydrate,
  registerAccountPrivateStateReset,
  removeAccountPrivateStorage,
  writeAccountPrivateStorage,
} from '../api/accountLocalPrivacy'

const MAX_HISTORY = 30
const history = ref<Item[]>([])
const postHistory = ref<Post[]>([])

function parseHistory<T>(raw: unknown): T[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) as T[] : []
  } catch {
    return []
  }
}

function hydrateHistoryMemory() {
  const saved = readAccountPrivateStorage<unknown>('viewHistory', '')
  const savedPosts = readAccountPrivateStorage<unknown>('postViewHistory', '')
  history.value = saved.allowed ? parseHistory<Item>(saved.value) : []
  postHistory.value = savedPosts.allowed ? parseHistory<Post>(savedPosts.value) : []
}

function save() {
  writeAccountPrivateStorage('viewHistory', JSON.stringify(history.value))
}

function savePosts() {
  writeAccountPrivateStorage('postViewHistory', JSON.stringify(postHistory.value))
}

function resetHistoryMemory() {
  history.value = []
  postHistory.value = []
}

hydrateHistoryMemory()
registerAccountPrivateStateReset(resetHistoryMemory)
registerAccountPrivateStateHydrate(hydrateHistoryMemory)

export function useHistory() {
  function addToHistory(item: Item) {
    history.value = [item, ...history.value.filter(i => i.id !== item.id)].slice(0, MAX_HISTORY)
    save()
  }

  function removeFromHistory(id: string) {
    const next = history.value.filter(i => i.id !== id)
    if (!writeAccountPrivateStorage('viewHistory', JSON.stringify(next))) return false
    const stored = readAccountPrivateStorage<unknown>('viewHistory', '')
    if (!stored.allowed || parseHistory<Item>(stored.value).some(i => i.id === id)) return false
    history.value = next
    return true
  }

  function clearHistory() {
    if (!removeAccountPrivateStorage('viewHistory')) return false
    history.value = []
    return true
  }

  function addPostToHistory(post: Post) {
    postHistory.value = [post, ...postHistory.value.filter(p => p.id !== post.id)].slice(0, MAX_HISTORY)
    savePosts()
  }

  function removePostFromHistory(id: string) {
    const next = postHistory.value.filter(p => p.id !== id)
    if (!writeAccountPrivateStorage('postViewHistory', JSON.stringify(next))) return false
    const stored = readAccountPrivateStorage<unknown>('postViewHistory', '')
    if (!stored.allowed || parseHistory<Post>(stored.value).some(p => p.id === id)) return false
    postHistory.value = next
    return true
  }

  function clearPostHistory() {
    if (!removeAccountPrivateStorage('postViewHistory')) return false
    postHistory.value = []
    return true
  }

  return {
    history,
    postHistory,
    addToHistory,
    removeFromHistory,
    clearHistory,
    addPostToHistory,
    removePostFromHistory,
    clearPostHistory,
  }
}
