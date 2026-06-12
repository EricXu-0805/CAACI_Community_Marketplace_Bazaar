import { ref, createApp } from 'vue'

/*
 * App-wide toast banner.
 *
 * The motivating case is in-app realtime notifications: when an offer / meetup
 * / sold / price-drop lands while the user is somewhere in the app, we want a
 * branded, tappable banner — not the flat native uni.showToast.
 *
 * uni-app's App.vue is the application instance and has no <template>, so it
 * can't host a cross-page overlay. On H5 we therefore mount a tiny standalone
 * Vue app (AppToast.vue) onto a body-level <div> the first time a toast is
 * pushed; it reads the module-level `toasts` ref below, which is shared across
 * Vue app instances. Design tokens + data-theme live on <html>, so the
 * body-mounted banner inherits light/dark styling for free.
 *
 * On mp-weixin there is no DOM to mount into, so pushToast degrades to the
 * native uni.showToast — same path messages already use.
 */

export type ToastKind = 'offer' | 'meetup' | 'sold' | 'price_drop' | 'system' | 'message'

export interface ToastInput {
  kind: ToastKind
  title: string
  body?: string
  route?: string        // uni page path to open on tap
  switchTab?: boolean   // route is a tabBar page → use uni.switchTab
  onTap?: () => void    // extra side effect on tap (e.g. mark the row read)
}

export interface ToastItem extends ToastInput {
  id: string
}

const toasts = ref<ToastItem[]>([])
const MAX_VISIBLE = 3
let seq = 0

// #ifdef H5
let mounted = false
function ensureMounted() {
  if (mounted || typeof document === 'undefined') return
  mounted = true
  import('../components/AppToast.vue')
    .then(({ default: AppToast }) => {
      const host = document.createElement('div')
      host.id = 'app-toast-root'
      document.body.appendChild(host)
      createApp(AppToast).mount(host)
    })
    .catch(() => { mounted = false })
}
// #endif

export function pushToast(item: ToastInput): void {
  // #ifdef H5
  const id = `toast-${++seq}`
  toasts.value = [{ ...item, id }, ...toasts.value].slice(0, MAX_VISIBLE)
  ensureMounted()
  // #endif
  // #ifndef H5
  uni.showToast({ title: item.title, icon: 'none', duration: 2500 })
  // #endif
}

export function dismissToast(id: string): void {
  const i = toasts.value.findIndex(t => t.id === id)
  if (i !== -1) toasts.value.splice(i, 1)
}

export function useAppToast() {
  return { toasts, pushToast, dismissToast }
}
