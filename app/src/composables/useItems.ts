import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import type { Item, ItemCategory } from '../types'

export function useItems() {
  const { supabase } = useSupabase()
  const items = ref<Item[]>([])
  const loading = ref(false)
  const hasMore = ref(true)

  const PAGE_SIZE = 20

  // Fetch items with pagination & filters
  async function fetchItems(options: {
    page?: number
    category?: ItemCategory | null
    search?: string
    userId?: string
    reset?: boolean
  } = {}) {
    const { page = 0, category, search, userId, reset = false } = options

    if (reset) {
      items.value = []
      hasMore.value = true
    }

    loading.value = true
    try {
      let query = supabase
        .from('items')
        .select('*, profile:profiles(*)')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (category) {
        query = query.eq('category', category)
      }

      if (search) {
        query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
      }

      if (userId) {
        query = query.eq('user_id', userId)
      }

      const { data, error } = await query

      if (error) throw error

      if (data) {
        if (reset) {
          items.value = data as Item[]
        } else {
          items.value.push(...(data as Item[]))
        }
        hasMore.value = data.length === PAGE_SIZE
      }
    } catch (error) {
      console.error('Failed to fetch items:', error)
    } finally {
      loading.value = false
    }
  }

  // Fetch single item
  async function fetchItem(id: string) {
    const { data, error } = await supabase
      .from('items')
      .select('*, profile:profiles(*)')
      .eq('id', id)
      .single()

    if (error) throw error

    // Increment view count
    supabase
      .from('items')
      .update({ view_count: (data as Item).view_count + 1 })
      .eq('id', id)
      .then() // fire and forget

    return data as Item
  }

  // Create item
  async function createItem(item: {
    title: string
    description: string
    price: number
    category: ItemCategory
    condition: string
    location: string
    images: string[]
  }) {
    const { data, error } = await supabase
      .from('items')
      .insert(item)
      .select()
      .single()

    if (error) throw error
    return data as Item
  }

  // Update item
  async function updateItem(id: string, updates: Partial<Item>) {
    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data as Item
  }

  // Upload images
  async function uploadImages(files: string[]): Promise<string[]> {
    const urls: string[] = []

    for (const filePath of files) {
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const storagePath = `items/${fileName}`

      const { error } = await supabase.storage
        .from('item-images')
        .upload(storagePath, filePath as any)

      if (!error) {
        const { data: urlData } = supabase.storage
          .from('item-images')
          .getPublicUrl(storagePath)
        urls.push(urlData.publicUrl)
      }
    }

    return urls
  }

  // Fetch user's items (all statuses)
  async function fetchMyItems(userId: string) {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []) as Item[]
  }

  return {
    items,
    loading,
    hasMore,
    fetchItems,
    fetchItem,
    createItem,
    updateItem,
    uploadImages,
    fetchMyItems,
  }
}
