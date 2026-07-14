/*
 * Real WeChat chrome geometry → CSS vars, bound on every page root.
 *
 * Neither static source is trustworthy on mp: uni compiles a FIXED
 * page{--status-bar-height:25px} literal into app.wxss (no runtime setter),
 * and env(safe-area-inset-top) resolves to 0 inside the mp webview (measured
 * via automator: real capsule top=58 while the env-based token computed 29).
 * So every CSS-only fallback chain lands on 25px regardless of device, and
 * on notched phones (status bar 44-59px) all custom headers underlap the
 * clock. The runtime API pair below is WeChat's own report; page roots bind
 * the returned style string so the existing var(--mp-status-bar, ...) /
 * var(--mp-navbar-right-pad, ...) usages resolve to real values via CSS
 * variable inheritance. Returns '' on H5 (harmless empty style).
 */
/* Re-exported so page roots can pull both the chrome vars and the reactive
   theme class from one import. mpThemeClass drives :class on the page root
   ('theme-dark' on mp when dark, '' otherwise) — see useTheme + App.vue. */
export { mpThemeClass } from './useTheme'

let cached: string | null = null

export function mpChromeVars(): string {
  // #ifndef H5
  if (cached !== null) return cached
  try {
    const win = (uni as unknown as { getWindowInfo?: () => UniApp.GetSystemInfoResult }).getWindowInfo?.()
      ?? uni.getSystemInfoSync()
    const sb = win.statusBarHeight || 25
    /* Documented defaults (App.vue token block) if the capsule API is absent. */
    let rightPad = 104
    let navH = 44
    try {
      const cap = (uni as unknown as { getMenuButtonBoundingClientRect?: () => { width: number; height: number; top: number; left: number } })
        .getMenuButtonBoundingClientRect?.()
      if (cap && cap.width > 0) {
        rightPad = Math.max(0, win.windowWidth - cap.left) + 10
        /* capsule is vertically centered in the navbar band below the status
           bar: band height = capsule height + 2× its gap above/below */
        navH = Math.max(44, (cap.top - sb) * 2 + cap.height)
      }
    } catch { /* keep defaults */ }
    cached = `--mp-status-bar:${sb}px;--mp-navbar-right-pad:${rightPad}px;--mp-navbar-height:${navH}px`
  } catch {
    cached = ''
  }
  return cached
  // #endif
  // #ifdef H5
  return ''
  // #endif
}
