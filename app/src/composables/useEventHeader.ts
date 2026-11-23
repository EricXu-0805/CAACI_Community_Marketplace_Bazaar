import { onUnmounted, ref } from 'vue'
import { useAuth } from './useAuth'
import { communityNavigation, openCommunityBoard } from '../api/communityNavigation'

/** The H5 event pages share the community header's viewport and tab handoff. */
export function useEventHeader() {
  const { isLoggedIn } = useAuth()
  const search = ref('')
  const media = window.matchMedia('(min-width: 1024px)')
  const desktop = ref(media.matches)
  const onChange = (event: MediaQueryListEvent) => { desktop.value = event.matches }
  media.addEventListener('change', onChange)
  onUnmounted(() => media.removeEventListener('change', onChange))

  function openCommunity(view: 'home' | 'all') {
    communityNavigation.pendingBoard = null
    communityNavigation.pendingView = view
    uni.switchTab({ url: '/pages/plaza/index' })
  }
  const home = () => openCommunity('home')
  const all = () => openCommunity('all')
  const login = () => uni.navigateTo({ url: '/pages/login/index' })
  return { desktop, search, isLoggedIn, home, all, board: openCommunityBoard, login }
}
