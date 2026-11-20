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
