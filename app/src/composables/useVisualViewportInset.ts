import { onMounted, onUnmounted, ref } from 'vue'

/** Bottom occlusion for a viewport-fixed H5 chat shell, in either orientation.
 * Compare against the fixed box's layout viewport, not innerHeight: browsers
 * which already shrink layout for the keyboard must not subtract it twice.
 * Pinch zoom is not a keyboard and must retain its normal pan/zoom behaviour.
 * Mini programs keep their native keyboard handling.
 */
export function useVisualViewportInset() {
  const inset = ref(0)
  // #ifdef H5
  let viewport: VisualViewport | null = null
  function sync() {
    if (!viewport || Math.abs(viewport.scale - 1) > 0.01) { inset.value = 0; return }
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight
    const visibleBottom = Math.round(viewport.offsetTop + viewport.height)
    inset.value = Math.max(0, Math.min(layoutHeight - visibleBottom, layoutHeight - 1))
  }
  onMounted(() => {
    viewport = window.visualViewport
    viewport?.addEventListener('resize', sync)
    viewport?.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    sync()
  })
  onUnmounted(() => {
    viewport?.removeEventListener('resize', sync)
    viewport?.removeEventListener('scroll', sync)
    window.removeEventListener('resize', sync)
  })
  // #endif
  return inset
}
