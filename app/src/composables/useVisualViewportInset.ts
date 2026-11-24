import { onMounted, onUnmounted, ref } from 'vue'

/** Visible bounds for viewport-fixed H5 content, in either orientation.
 * Compare against the fixed box's layout viewport, not innerHeight: browsers
 * which already shrink layout for the keyboard must not subtract it twice.
 * Pinch zoom is not a keyboard and must retain its normal pan/zoom behaviour.
 * Mini programs keep their native keyboard handling.
 */
export function useVisualViewportBounds() {
  const inset = ref(0)
  const visibleHeight = ref<number | null>(null)
  // #ifdef H5
  let viewport: VisualViewport | null = null
  let layoutObserver: ResizeObserver | null = null
  function sync() {
    if (!viewport || Math.abs(viewport.scale - 1) > 0.01) {
      inset.value = 0
      visibleHeight.value = null
      return
    }
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight
    const visibleBottom = Math.round(viewport.offsetTop + viewport.height)
    inset.value = Math.max(0, Math.min(layoutHeight - visibleBottom, layoutHeight - 1))
    visibleHeight.value = Math.max(0, Math.min(viewport.height, layoutHeight))
  }
  onMounted(() => {
    viewport = window.visualViewport
    viewport?.addEventListener('resize', sync)
    viewport?.addEventListener('scroll', sync)
    window.addEventListener('resize', sync)
    // WebKit can deliver its last resize event while layout still has the
    // previous height, then finish that layout with no further viewport
    // event, which used to leave the old inset in place. uni-h5's
    // style/framework/base.css sets html and body to height: 100%, keeping
    // the root box equal to the layout viewport even with taller content.
    // App.vue's min-height alone would let the root grow with that content,
    // hiding layout viewport height changes from this root observer.
    if (typeof ResizeObserver !== 'undefined') {
      layoutObserver = new ResizeObserver(sync)
      layoutObserver.observe(document.documentElement)
    }
    sync()
  })
  onUnmounted(() => {
    viewport?.removeEventListener('resize', sync)
    viewport?.removeEventListener('scroll', sync)
    window.removeEventListener('resize', sync)
    layoutObserver?.disconnect()
  })
  // #endif
  return { bottomInset: inset, visibleHeight }
}

export function useVisualViewportInset() {
  return useVisualViewportBounds().bottomInset
}
