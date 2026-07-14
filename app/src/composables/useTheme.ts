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
 * System dark-mode signal — drives the `auto` branch of isDark (H5) and
 * the whole of isDark on mp (which follows the system theme).
 *
 * H5: read once from matchMedia, then kept live via its `change` event so
 * theme-aware assets flip when the user toggles macOS / Windows dark mode
 * without a reload. mp-weixin: read from getSystemInfoSync().theme + kept
 * live via uni.onThemeChange (matchMedia doesn't exist there). Both feed
 * the same reactive so the WXSS @media dark canvas and the JS-picked dark
 * assets move together.
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
// #ifdef MP-WEIXIN
/*
 * mp dark mode follows the WeChat / system theme (manifest darkmode:true).
 * getSystemInfoSync().theme is the initial value; onThemeChange keeps it
 * live when the user flips the system/WeChat setting while the mp is open.
 * The WXSS @media (prefers-color-scheme: dark) block in App.vue repaints
 * the canvas in lockstep, so isDark-driven assets stay in sync.
 */
try {
  systemDark.value = uni.getSystemInfoSync().theme === 'dark'
} catch {}
if (typeof uni.onThemeChange === 'function') {
  uni.onThemeChange((res) => {
    systemDark.value = res.theme === 'dark'
  })
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
const isDark = computed(() => {
  // #ifndef H5
  /* mp follows the WeChat / system theme (manifest darkmode:true; no in-app
     toggle). systemDark is fed by getSystemInfoSync().theme + onThemeChange
     above and moves in lockstep with the WXSS @media dark canvas, so
     isDark-driven assets (dark logo, dark default avatars) stay in sync.
     Other non-H5 targets never wire onThemeChange, so systemDark stays false
     there — a safe light default. */
  return systemDark.value
  // #endif
  // #ifdef H5
  return pref.value === 'dark' || (pref.value === 'auto' && systemDark.value)
  // #endif
})

export function useTheme() {
  return { pref, setPref, isDark }
}
