import { createSSRApp } from "vue"
import App from "./App.vue"
import { initSentry } from "./utils/sentry"

export function createApp() {
  const app = createSSRApp(App)
  initSentry(app)
  return { app }
}
