import { ref } from 'vue'
import type { Item } from '../types'

const MAX_HISTORY = 30
const history = ref<Item[]>([])

try {
  const saved = uni.getStorageSync('viewHistory')
  if (saved) history.value = JSON.parse(saved)
} catch {}

function save() {
  try { uni.setStorageSync('viewHistory', JSON.stringify(history.value)) } catch {}
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

  return { history, addToHistory, removeFromHistory, clearHistory }
}
