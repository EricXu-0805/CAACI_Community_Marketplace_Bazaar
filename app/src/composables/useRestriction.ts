import { computed, ref, watch } from 'vue'
import { useAuth } from './useAuth'
import { useI18n } from './useI18n'
import { friendlyErrorMessage } from '../utils'
import { activeRestriction, nextSuspensionExpiryDelayMs, restrictionError } from '../utils/suspension'
// #ifdef H5
import { ensureToastHost } from './useAppToast'
// #endif

/*
 * D-49 client side of a restricted account (active L2-L5).
 *
 * The server refuses the writes; this module only keeps the client from
 * opening forms, pickers and uploads that would end in that refusal, and
 * shows the non-blocking notice that leads L2-L4 to pages/suspended. L5 never
 * reaches it: App.vue keeps L5 on the suspended page.
 *
 * State is derived from the authoritative profile on every read, so sign-out
 * and account switches clear it with currentUser. `clock` re-evaluates the
 * derived state when the restriction ends while the app stays open.
 */

let auth: ReturnType<typeof useAuth> | null = null
let i18n: ReturnType<typeof useI18n> | null = null
const clock = ref(0)
let expiryTimer: ReturnType<typeof setTimeout> | undefined

function restriction() {
  void clock.value
  return activeRestriction((auth ||= useAuth()).currentUser.value)
}

function restrictionText(): string {
  const current = restriction()
  if (!current) return ''
  return friendlyErrorMessage(restrictionError(current), (i18n ||= useI18n()).lang.value as 'en' | 'zh')
}

// #ifdef H5
/* The H5 host is one body-level app; hide the notice on the gate pages
   themselves. Mini-program gate pages do not include an AppToast host. */
const route = ref('')
// #endif

/** Notice text for an active L2-L4 restriction; '' otherwise. */
export const restrictionNotice = computed(() => {
  const current = restriction()
  // #ifdef H5
  if (/pages\/(suspended|reconsent|profile-recovery)\//.test(route.value)) return ''
  // #endif
  return current && current.level < 5 ? restrictionText() : ''
})

/** Entry check: shows 「账号受限」 with the restore date and returns true when the action must not start. */
export function stopIfRestricted(): boolean {
  const title = restrictionText()
  if (title) uni.showToast({ title, icon: 'none', duration: 3500 })
  return !!title
}

/** Mutation backstop: throws the same refusal the server would return. */
export function assertWritesAllowed(): void {
  const current = restriction()
  if (current) throw restrictionError(current)
}

export function openRestrictionDetails(): void {
  uni.navigateTo({ url: '/pages/suspended/index' })
}

let started = false
/** Called once from App.vue: expiry refresh and (H5) the notice host. */
export function startRestrictionNotice(): void {
  if (started) return
  started = true
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const syncRoute = () => { route.value = String(window.location.hash || '') }
    syncRoute()
    window.addEventListener('hashchange', syncRoute)
  }
  // #endif
  watch(() => [restrictionNotice.value, clock.value], ([text]) => {
    clearTimeout(expiryTimer)
    const delay = text ? nextSuspensionExpiryDelayMs(restriction()?.until) : null
    if (delay !== null) expiryTimer = setTimeout(() => { clock.value += 1 }, delay)
    // #ifdef H5
    if (text) ensureToastHost()
    // #endif
  }, { immediate: true })
}
