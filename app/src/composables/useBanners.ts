import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { safeManagedBannerUrl } from '../utils/publicResource'

export interface Banner {
  id: string
  image_url: string
  target_url: string | null
  title: string | null
  title_en: string | null
  title_zh: string | null
  priority: number
}

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

      // banners_live is the single source of truth now that admins manage
      // banners from the console (#183). Empty → no carousel (the carousel
      // hides on length 0); an error → also empty, never a stale mock set
      // that would override an intentional "no banners" state. (QA8 audit.)
      banners.value = error || !data
        ? []
        : (data as Banner[]).flatMap((banner) => {
            const imageUrl = safeManagedBannerUrl(banner.image_url)
            return imageUrl ? [{ ...banner, image_url: imageUrl }] : []
          })
    } catch {
      banners.value = []
    } finally {
      loading.value = false
    }
  }

  return { banners, loading, fetchBanners }
}
