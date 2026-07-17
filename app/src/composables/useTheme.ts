import { ref, computed, watch } from 'vue'

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
 * mp reads the WeChat / system theme so pref='auto' (the default) can
 * follow it. getSystemInfoSync().theme is the initial value; onThemeChange
 * keeps it live when the user flips the system/WeChat setting while the mp
 * is open. A manual pick in Settings overrides this via pref. Either way
 * the resolved isDark drives mpThemeClass → the .theme-dark class on the
 * page root, so canvas + JS-picked assets flip together.
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
const isDark = computed(
  () => pref.value === 'dark' || (pref.value === 'auto' && systemDark.value),
)

/*
 * mp theme class — bound as :class on every page root (via the global mixin
 * in main.ts). H5 flips theme through html[data-theme] + the CSS token
 * blocks; WXSS has no documentElement and understands neither :root nor
 * :not([attr]), so mp drives the flip with a plain `.theme-dark` class on
 * the page root whose token block lives in App.vue (#ifdef MP-WEIXIN).
 *
 * Empty string on H5 (the data-theme path already handles it) and whenever
 * the resolved theme is light (the base `page {}` tokens are the light
 * floor). Reactive: flips live when the user picks a theme in Settings or
 * when the system theme changes (onThemeChange).
 */
const mpThemeClass = computed(() => {
  // #ifdef MP-WEIXIN
  return isDark.value ? 'theme-dark' : ''
  // #endif
  // #ifndef MP-WEIXIN
  return ''
  // #endif
})

/*
 * WeChat native window background — the layer behind pull-to-refresh and the
 * overscroll rubber-band. The `.theme-dark` class only repaints descendants of
 * the page <view>, and pages.json globalStyle.backgroundColor is a fixed light
 * value, so in dark mode that native band flashes light on pull/overscroll.
 * setBackgroundColor is per-page, so this is re-applied both here (on every
 * theme change, for the current page) and from a global onShow mixin (main.ts,
 * for page navigations). Driven by isDark so it honors the manual Settings
 * override, not just the system theme (which is why theme.json won't do).
 */
export function applyMpNativeBg() {
  // #ifdef MP-WEIXIN
  const bg = isDark.value ? '#12100D' : '#F7F4EE'
  try {
    uni.setBackgroundColor({ backgroundColor: bg, backgroundColorTop: bg, backgroundColorBottom: bg })
  } catch {}
  try {
    uni.setBackgroundTextStyle({ textStyle: isDark.value ? 'light' : 'dark' })
  } catch {}
  // #endif
}
// #ifdef MP-WEIXIN
watch(isDark, () => applyMpNativeBg())
// #endif

export function useTheme() {
  return { pref, setPref, isDark, mpThemeClass }
}

/* Standalone export for the global mixin (main.ts) so every page template
   gets `mpThemeClass` without a per-page import. */
export { mpThemeClass }
