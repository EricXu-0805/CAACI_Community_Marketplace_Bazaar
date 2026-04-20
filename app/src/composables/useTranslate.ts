import { ref } from 'vue'
import { quickTranslate } from '../utils'

type Lang = 'en' | 'zh'

interface CachedEntry {
  translated: string
  target: Lang
  at: number
}

const CACHE_STORAGE_KEY = 'translate_cache_v1'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 500

let endpoint = '/api/translate'
try {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) {
    endpoint = window.location.origin + '/api/translate'
  }
  // #endif
} catch {}
// #ifndef H5
endpoint = 'https://caaci-community-marketplace-bazaar.vercel.app/api/translate'
// #endif

const mem = new Map<string, CachedEntry>()
let loadedFromDisk = false

function loadDisk() {
  if (loadedFromDisk) return
  loadedFromDisk = true
  try {
    const raw = uni.getStorageSync(CACHE_STORAGE_KEY)
    if (typeof raw !== 'string' || !raw) return
    const parsed = JSON.parse(raw) as Record<string, CachedEntry>
    const now = Date.now()
    Object.entries(parsed).forEach(([k, v]) => {
      if (v && now - v.at < CACHE_TTL_MS) mem.set(k, v)
    })
  } catch {}
}

function persistDisk() {
  try {
    if (mem.size > CACHE_MAX_ENTRIES) {
      const entries = Array.from(mem.entries()).sort((a, b) => b[1].at - a[1].at)
      mem.clear()
      entries.slice(0, CACHE_MAX_ENTRIES).forEach(([k, v]) => mem.set(k, v))
    }
    const obj: Record<string, CachedEntry> = {}
    mem.forEach((v, k) => { obj[k] = v })
    uni.setStorageSync(CACHE_STORAGE_KEY, JSON.stringify(obj))
  } catch {}
}

function cacheKey(text: string, target: Lang): string {
  return `${target}:${text.length}:${text.slice(0, 200)}`
}

export function useTranslate() {
  loadDisk()
  const pending = ref(false)

  function getCached(text: string, target: Lang): string | null {
    const hit = mem.get(cacheKey(text, target))
    if (!hit) return null
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      mem.delete(cacheKey(text, target))
      return null
    }
    return hit.translated
  }

  async function translate(text: string, target: Lang): Promise<string> {
    if (!text || !text.trim()) return text
    const cached = getCached(text, target)
    if (cached) return cached

    pending.value = true
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer))

      if (!r.ok) return quickTranslate(text, target)
      const json = await r.json()
      const translated = typeof json?.translated === 'string' ? json.translated.trim() : ''
      if (!translated) return quickTranslate(text, target)

      mem.set(cacheKey(text, target), { translated, target, at: Date.now() })
      persistDisk()
      return translated
    } catch {
      return quickTranslate(text, target)
    } finally {
      pending.value = false
    }
  }

  return { translate, getCached, pending }
}
