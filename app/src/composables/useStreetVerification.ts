import { onUnmounted, ref, watch } from 'vue'
import type { StreetVerification } from './useLocation'

/** Receipts remain in memory only, and the UI stops advertising expired proof. */
export function useStreetVerification() {
  const receipt = ref<StreetVerification | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(receipt, value => {
    clearTimeout(timer)
    if (!value) return
    const remaining = Date.parse(value.expires_at) - Date.now()
    if (!Number.isFinite(remaining) || remaining <= 0) { receipt.value = null; return }
    timer = setTimeout(() => { if (receipt.value?.token === value.token) receipt.value = null }, Math.min(remaining, 600_000))
  }, { flush: 'sync' })
  onUnmounted(() => clearTimeout(timer))
  return receipt
}
