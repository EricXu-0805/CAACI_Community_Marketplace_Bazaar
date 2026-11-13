export const now = Date.parse('2026-11-13T20:00:00Z')
export const day = 86_400_000
export const categories = ['campus-life', 'settling-market', 'alumni-career', 'events-social', 'local-deals']

export function makePost(id, overrides = {}) {
  return {
    id, user_id: `author-${id}`, title: `Topic ${id}`, category: 'campus-life',
    is_pinned: false, is_official: false, comment_count: 0, status: 'active',
    created_at: new Date(now - 3_600_000).toISOString(),
    ...overrides,
  }
}

export function makePosts(count, boards = categories) {
  return Array.from({ length: count }, (_, index) => makePost(`post-${String(index).padStart(3, '0')}`, {
    category: boards[index % boards.length],
    created_at: new Date(now - (index + 1) * 60_000).toISOString(),
  }))
}

export const items = Array.from({ length: 7 }, (_, index) => ({
  id: `item-${index}`, title: `Item ${index}`, price: index + 1, images: [],
  status: 'active', created_at: new Date(now - index * 60_000).toISOString(),
}))
