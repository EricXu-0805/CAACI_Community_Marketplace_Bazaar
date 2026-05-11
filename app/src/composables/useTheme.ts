import { ref, computed } from 'vue'

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
  console.log('[theme-debug] applied data-theme:', root.getAttribute('data-theme') || '(removed → auto)')
  // #endif
}

const pref = ref<ThemePref>(readStoredPref())

/*
 * Apply the persisted preference on first import. Runs at module load
 * so every page that imports useTheme (or App.vue on boot) has the
 * right theme before paint.
 *
 * If a future uni-app version starts hydrating App.vue's <view> root
 * AFTER our applyToDom() call (witnessed previously when uni-app
 * upgraded to 3.15 and started doing a microtask delay), the
 * setAttribute would race with hydration and the data-theme would
 * appear to be missing. The MutationObserver below re-applies it
 * after every documentElement attribute change so the manual
 * preference always wins. Cheap — only fires on actual mutations,
 * not on every paint.
 */
applyToDom(pref.value)
// #ifdef H5
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const obs = new MutationObserver(() => {
    const current = document.documentElement.getAttribute('data-theme')
    const expected = pref.value === 'auto' ? null : pref.value
    if (current === expected) return
    applyToDom(pref.value)
  })
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}
// #endif

function setPref(p: ThemePref) {
  pref.value = p
  try { uni.setStorageSync(STORAGE_KEY, p) } catch {}
  applyToDom(p)
}

/*
 * System dark-mode signal — drives the `auto` branch of isDark.
 *
 * Read once at module load, then kept in sync via the matchMedia
 * `change` event so the dark-only avatar SVG (and any future
 * theme-aware asset) flips live when the user toggles macOS / Windows
 * dark mode without a page reload. Only meaningful on H5 — mp-weixin
 * has no window.matchMedia, so systemDark stays false there (mp
 * dark-mode support is deferred to v3.5 per the v3 spec §CC-1, so
 * mp users will simply always see the light-mode default avatar
 * regardless of OS pref).
 */
const systemDark = ref(false)
// #ifdef H5
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = mq.matches
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', (e: MediaQueryListEvent) => {
      systemDark.value = e.matches
    })
  }
}
// #endif

/*
 * isDark — resolved dark-mode state combining manual preference and OS.
 *
 *   pref='dark'  → always true
 *   pref='light' → always false
 *   pref='auto'  → follows system prefers-color-scheme
 *
 * Components that need to swap dark-only assets (the theme-aware
 * default avatar in messages/chat is the first consumer, v3 P1) should
 * bind to this rather than reading `pref` directly. `auto` is the
 * default for new users and those users will only see dark when the
 * OS does — checking `pref === 'dark'` would miss that case entirely.
 */
const isDark = computed(() =>
  pref.value === 'dark' || (pref.value === 'auto' && systemDark.value)
)

export function useTheme() {
  return { pref, setPref, isDark }
}
