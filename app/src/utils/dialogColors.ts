/*
 * Resolved hex literals for native dialog APIs (uni.showModal,
 * uni.showActionSheet). These run in the WeChat/native host, which does
 * NOT parse CSS var() — passing 'var(--accent-danger)' silently falls back
 * to the platform default. Keep these in sync with the App.vue tokens:
 *   --ink #2A2A2E · --accent-danger/--danger #B53333 · --accent-warn/--warning #D4923C
 */
export const DIALOG_INK = '#2A2A2E'
export const DIALOG_DANGER = '#B53333'
export const DIALOG_WARN = '#D4923C'
