/*
 * useLongPress — touch-driven long-press recognizer with configurable
 * threshold and haptic feedback.
 *
 * Why not the built-in @longpress?
 *   uni-app's native @longpress fires at a fixed ~350ms and doesn't
 *   accept a per-binding threshold. That's fine for low-stakes actions
 *   (delete a notification, pin a chat) where mis-fires are cheap to
 *   undo — but for *report* actions (report this user / item / post)
 *   we want a much longer hold so a thumb resting on a card doesn't
 *   accidentally open the report sheet. 3s + haptic confirmation is
 *   the threshold this composable was sized for.
 *
 * Why a stateful composable instead of a Vue directive?
 *   A directive would attach handlers per element, which means each
 *   v-for item creates its own listener bag. With a v-for of 50+
 *   items that's wasteful. The composable returns ONE handler bag
 *   that all items share — the timer state is gesture-scoped (only
 *   one finger can long-press at a time on a touch device), and the
 *   target item flows through the touchstart args.
 *
 * Usage (per page):
 *
 *   import { useLongPress } from '../../composables/useLongPress'
 *   const reportItem = useLongPress(
 *     (item: Item) => onCardLongPress(item),
 *     3000,
 *   )
 *
 * Template:
 *
 *   <view
 *     v-for="item in items"
 *     :key="item.id"
 *     @touchstart="reportItem.onTouchstart(item)"
 *     @touchend="reportItem.onTouchend"
 *     @touchcancel="reportItem.onTouchcancel"
 *     @touchmove="reportItem.onTouchmove"
 *   >
 *
 * Haptic pulses (gracefully degrades when uni.vibrateShort is missing):
 *   · onTouchstart  → 'light'  (you've started the recognition window)
 *   · timer fires   → 'heavy'  (handler invoked)
 *   · cancel before → no haptic
 *
 * Behavior contract:
 *   · A second touchstart before timer fires resets the timer
 *   · touchmove cancels (interpreted as "user is scrolling, not pressing")
 *   · touchcancel cancels
 *   · After fire, subsequent touchend/cancel are no-ops (already cleared)
 */

type Handler<TArgs extends unknown[]> = (...args: TArgs) => void

export interface LongPressBindings<TArgs extends unknown[]> {
  onTouchstart: (...args: TArgs) => void
  onTouchend: () => void
  onTouchcancel: () => void
  onTouchmove: () => void
}

export function useLongPress<TArgs extends unknown[]>(
  handler: Handler<TArgs>,
  threshold = 350,
): LongPressBindings<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: TArgs | null = null

  function clear() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pendingArgs = null
  }

  function safeVibrate(kind: 'light' | 'heavy') {
    try {
      const promise = uni.vibrateShort({ type: kind })
      if (promise && typeof (promise as any).catch === 'function') {
        ;(promise as any).catch(() => {})
      }
    } catch {
      /* mp without haptic — silently degrade */
    }
  }

  return {
    onTouchstart(...args: TArgs) {
      clear()
      pendingArgs = args
      safeVibrate('light')
      timer = setTimeout(() => {
        safeVibrate('heavy')
        const captured = pendingArgs
        timer = null
        pendingArgs = null
        if (captured) handler(...captured)
      }, threshold)
    },
    onTouchend() { clear() },
    onTouchcancel() { clear() },
    onTouchmove() { clear() },
  }
}
