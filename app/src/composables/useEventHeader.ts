import { onUnmounted, ref } from 'vue'
import { useAuth } from './useAuth'
import { communityNavigation, openCommunityBoard } from '../api/communityNavigation'

/** The H5 event pages share the community header's viewport and tab handoff. */
export function useEventHeader() {
  const { isLoggedIn, requireAuth } = useAuth()
  const search = ref('')
  const media = window.matchMedia('(min-width: 1024px)')
  const desktop = ref(media.matches)
  const onChange = (event: MediaQueryListEvent) => { desktop.value = event.matches }
  media.addEventListener('change', onChange)
  onUnmounted(() => media.removeEventListener('change', onChange))

  function openCommunity(view: 'home' | 'all', query = '') {
    communityNavigation.pendingBoard = null
    communityNavigation.pendingView = view
    communityNavigation.pendingSearch = query.trim() || null
    uni.switchTab({ url: '/pages/plaza/index' })
  }
  const home = () => openCommunity('home')
  const all = () => openCommunity('all')
  const submit = () => openCommunity('all', search.value)
  const login = () => { requireAuth() }
  return { desktop, search, isLoggedIn, home, all, submit, board: openCommunityBoard, login }
}
