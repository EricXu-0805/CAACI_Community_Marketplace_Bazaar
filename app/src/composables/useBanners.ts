import { ref } from 'vue'
import { useSupabase } from './useSupabase'

export interface Banner {
  id: string
  image_url: string
  target_url: string | null
  title: string | null
  title_en: string | null
  title_zh: string | null
  priority: number
}

const MOCK_BANNERS: Banner[] = [
  {
    id: 'mock-welcome',
    image_url: '/static/banner-welcome.png',
    target_url: null,
    title: 'Illini Market',
    title_en: 'Welcome to Illini Market',
    title_zh: '欢迎来到 Illini 集市',
    priority: 100,
  },
  {
    id: 'mock-safety',
    image_url: '/static/banner-safety.png',
    target_url: '/pages/legal/index',
    title: 'Safety',
    title_en: 'Trade safely — tips inside',
    title_zh: '安全交易小贴士',
    priority: 90,
  },
  {
    id: 'mock-publish',
    image_url: '/static/banner-publish.png',
    target_url: '/pages/publish/index',
    title: 'Publish',
    title_en: 'List your first item',
    title_zh: '发布你的第一件闲置',
    priority: 80,
  },
]

export function useBanners() {
  const banners = ref<Banner[]>([])
  const loading = ref(false)

  async function fetchBanners(): Promise<void> {
    loading.value = true
    try {
      const { supabase } = useSupabase()
      const { data, error } = await supabase
        .from('banners_live')
        .select('id, image_url, target_url, title, title_en, title_zh, priority')

      if (error || !data || data.length === 0) {
        banners.value = MOCK_BANNERS
        return
      }
      banners.value = data as Banner[]
    } catch {
      banners.value = MOCK_BANNERS
    } finally {
      loading.value = false
    }
  }

  return { banners, loading, fetchBanners }
}
