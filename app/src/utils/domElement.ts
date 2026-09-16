/** Uni-app <view> refs can be component instances on H5, not DOM nodes. */
export function resolveHtmlElement(value: unknown): HTMLElement | null {
  if (typeof HTMLElement === 'undefined' || !value) return null
  if (value instanceof HTMLElement) return value
  const element = (value as { $el?: unknown }).$el
  return element instanceof HTMLElement ? element : null
}
