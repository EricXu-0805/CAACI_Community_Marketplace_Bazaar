import type { Item, ItemCategory } from '../types'

const categories = new Set<ItemCategory>(['furniture','electronics','clothing','books','housing','vehicles','daily','food','rideshare','other'])

/** Last 30 local views, recency-decayed; a saved viewed item has more weight.
 * Only three category names leave the device, never item/view timestamps. */
export function interestCategories(history: Item[], favorites: Set<string>, hidden: Set<string>): ItemCategory[] {
  const scores = new Map<ItemCategory, number>()
  history.slice(0, 30).forEach((item, index) => {
    if (hidden.has(item.id) || !categories.has(item.category)) return
    scores.set(item.category, (scores.get(item.category) || 0) + (favorites.has(item.id) ? 3 : 1) / (1 + index / 5))
  })
  return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([category]) => category)
}

/** Coarse service areas only. Never call this an address/GPS verification. */
export function nearbyArea(location: string): 'UIUC' | 'Champaign' | 'Urbana' | null {
  if (/\buiuc\b|university of illinois|伊利诺伊大学/i.test(location)) return 'UIUC'
  if (/\burbana\b|厄巴纳/i.test(location)) return 'Urbana'
  if (/\bchampaign\b|香槟/i.test(location)) return 'Champaign'
  return null
}
