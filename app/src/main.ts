import { createSSRApp } from "vue"
import App from "./App.vue"
import { initSentry } from "./utils/sentry"
// #ifdef MP-WEIXIN
import { applyMpNativeBg } from "./composables/useTheme"
// #endif

export function createApp() {
  const app = createSSRApp(App)
  initSentry(app)
  // #ifdef MP-WEIXIN
  // The .theme-dark class only repaints page descendants; the WeChat native
  // window background (behind pull-to-refresh / overscroll) is per-page and
  // separate. Re-apply the theme-matched native bg on every page show.
  app.mixin({ onShow() { applyMpNativeBg() } })
  // #endif
  return { app }
}
