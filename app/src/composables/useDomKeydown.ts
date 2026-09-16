import { watchPostEffect, type Ref } from 'vue'
import { resolveHtmlElement } from '../utils/domElement'

/** H5 uni-view's component event adapter can drop keyboard event properties.
 * Bind the real DOM event after rendering, and release it on unmount/ref change.
 * On mini-programs there is no HTMLElement and this effect remains inert.
 */
export function useDomKeydown(reference: Ref<unknown>, handler: (event: KeyboardEvent) => void) {
  watchPostEffect(onCleanup => {
    const element = resolveHtmlElement(reference.value)
    if (!element) return
    element.addEventListener('keydown', handler)
    onCleanup(() => element.removeEventListener('keydown', handler))
  })
}
