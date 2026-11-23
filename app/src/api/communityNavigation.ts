/** One-shot tab handoff: switchTab cannot carry board/view query parameters. */
export const communityNavigation = {
  pendingBoard: null as string | null,
  pendingView: null as string | null,
}

export function openCommunityBoard(board: string) {
  communityNavigation.pendingBoard = board
  communityNavigation.pendingView = null
  uni.switchTab({ url: '/pages/plaza/index' })
}

/** Return to an existing events list, or replace a directly opened event page. */
export function openEventList() {
  const pages = getCurrentPages()
  const index = pages.map(page => page.route).lastIndexOf('pages/events/index')
  if (index === pages.length - 1 && index >= 0) return
  if (index >= 0) uni.navigateBack({ delta: pages.length - 1 - index })
  else uni.redirectTo({ url: '/pages/events/index' })
}
