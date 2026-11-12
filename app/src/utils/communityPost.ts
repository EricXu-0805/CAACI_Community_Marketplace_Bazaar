/** Community boards are independent of marketplace item categories. */
export const POST_CATEGORIES = [
  'campus-life', 'settling-market', 'alumni-career', 'events-social', 'local-deals',
] as const
export type PostCategory = typeof POST_CATEGORIES[number]
export const POST_TITLE_MAX = 120

/** Old updates have neither field; topics must carry both. Database repeats this boundary. */
export function normalizePostTopic(title?: string | null, category?: PostCategory | null) {
  const normalizedTitle = title?.trim() || null
  const normalizedCategory = category || null
  if (normalizedTitle && (Array.from(normalizedTitle).length > POST_TITLE_MAX || /[\r\n]/.test(normalizedTitle))) {
    throw new Error('post_title_invalid')
  }
  if ((normalizedTitle === null) !== (normalizedCategory === null)
    || (normalizedCategory && !POST_CATEGORIES.includes(normalizedCategory))) {
    throw new Error('post_topic_required')
  }
  return { title: normalizedTitle, category: normalizedCategory }
}
