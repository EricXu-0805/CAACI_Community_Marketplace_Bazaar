/**
 * Owns one global uni.showLoading surface without letting an older async
 * continuation dismiss a newer operation's overlay. Pages must call cancel()
 * from account-transition and unmount cleanup.
 */
export function createOwnedLoading() {
  let nextOwner = 0
  let activeOwner: number | null = null

  function show(title: string): number {
    const owner = ++nextOwner
    activeOwner = owner
    uni.showLoading({ title, mask: true })
    return owner
  }

  function hide(owner: number): void {
    if (activeOwner !== owner) return
    activeOwner = null
    try { uni.hideLoading() } catch {}
  }

  function cancel(): void {
    nextOwner += 1
    if (activeOwner === null) return
    activeOwner = null
    try { uni.hideLoading() } catch {}
  }

  return { show, hide, cancel }
}
