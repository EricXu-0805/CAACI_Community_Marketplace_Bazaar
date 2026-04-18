import { ref } from 'vue'
import type { Item, Post } from '../types'

const MAX_HISTORY = 30
const history = ref<Item[]>([])
const postHistory = ref<Post[]>([])

try {
  const saved = uni.getStorageSync('viewHistory')
  if (saved) history.value = JSON.parse(saved)
  const savedPosts = uni.getStorageSync('postViewHistory')
  if (savedPosts) postHistory.value = JSON.parse(savedPosts)
} catch {}

function save() {
  try { uni.setStorageSync('viewHistory', JSON.stringify(history.value)) } catch {}
}

function savePosts() {
  try { uni.setStorageSync('postViewHistory', JSON.stringify(postHistory.value)) } catch {}
}

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
    try { uni.removeStorageSync('viewHistory') } catch {}
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
    try { uni.removeStorageSync('postViewHistory') } catch {}
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
