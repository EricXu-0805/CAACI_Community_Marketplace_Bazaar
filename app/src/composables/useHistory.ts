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
    history.value = history.value.filter(i => i.id !== id)
    save()
  }

  function clearHistory() {
    history.value = []
    removeAccountPrivateStorage('viewHistory')
  }

  function addPostToHistory(post: Post) {
    postHistory.value = [post, ...postHistory.value.filter(p => p.id !== post.id)].slice(0, MAX_HISTORY)
    savePosts()
  }

  function removePostFromHistory(id: string) {
    postHistory.value = postHistory.value.filter(p => p.id !== id)
    savePosts()
  }

  function clearPostHistory() {
    postHistory.value = []
    removeAccountPrivateStorage('postViewHistory')
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
