import { ref } from 'vue'

/*
 * Theme preference (light / dark / auto).
 *
 *   auto  — follow system `prefers-color-scheme` (default for new users).
 *   light — force light. Sets html[data-theme="light"].
 *   dark  — force dark.  Sets html[data-theme="dark"].
 *
 * Persists via uni.setStorageSync('theme_pref') so the choice survives
 * full reload + miniprogram cold start. The DOM flip only runs in H5
 * (miniprograms don't expose a real `document.documentElement`).
 */

export type ThemePref = 'auto' | 'light' | 'dark'

const STORAGE_KEY = 'theme_pref'

function readStoredPref(): ThemePref {
  try {
    const v = uni.getStorageSync(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch {}
  return 'auto'
}

function applyToDom(p: ThemePref) {
  // #ifdef H5
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (p === 'auto') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', p)
  }
  // #endif
}

const pref = ref<ThemePref>(readStoredPref())

/*
 * Apply the persisted preference on first import. Runs at module load
 * so every page that imports useTheme (or App.vue on boot) has the
 * right theme before paint.
 */
applyToDom(pref.value)

function setPref(p: ThemePref) {
  pref.value = p
  try { uni.setStorageSync(STORAGE_KEY, p) } catch {}
  applyToDom(p)
}

export function useTheme() {
  return { pref, setPref }
}
