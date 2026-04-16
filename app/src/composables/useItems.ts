import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import type { Item, ItemCategory, ItemCondition, ItemStatus } from '../types'

const items = ref<Item[]>([])
const loading = ref(false)
const hasMore = ref(true)

const PAGE_SIZE = 20
const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, location'
const VALID_STATUSES: ItemStatus[] = ['active', 'reserved', 'sold', 'deleted']
const ALLOWED_UPLOAD_EXTS: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_IMAGES = 9

export function useItems() {
  const { supabase } = useSupabase()

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
        .select(`*, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (category) {
        query = query.eq('category', category)
      }

      if (search) {
        const sanitized = search
          .replace(/[%_]/g, '\\$&')
          .replace(/[.,()]/g, '')
          .slice(0, 100)
        query = query.or(`title.ilike.%${sanitized}%,description.ilike.%${sanitized}%`)
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

  async function fetchItem(id: string) {
    const { data, error } = await supabase
      .from('items')
      .select(`*, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
      .eq('id', id)
      .single()

    if (error) throw error

    supabase.rpc('increment_view_count', { item_id: id }).then(() => {}, () => {})
    return data as Item
  }

  async function createItem(input: {
    title: string
    description: string
    price: number
    category: ItemCategory
    condition: ItemCondition
    location: string
    images: string[]
    negotiable?: boolean
  }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    if (input.price < 0 || input.price > 100000) throw new Error('Invalid price')
    if (input.title.length > 200) throw new Error('Title too long')
    if (input.description.length > 2000) throw new Error('Description too long')
    if (input.images.length > MAX_IMAGES) throw new Error('Too many images')

    const { data, error } = await supabase
      .from('items')
      .insert({
        user_id: session.user.id,
        title: input.title,
        description: input.description,
        price: input.price,
        category: input.category,
        condition: input.condition,
        location: input.location,
        images: input.images,
        negotiable: input.negotiable ?? false,
      })
      .select()
      .single()

    if (error) throw error
    return data as Item
  }

  async function updateItem(id: string, updates: Partial<Pick<Item, 'title' | 'description' | 'price' | 'location' | 'images' | 'negotiable'>>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .eq('user_id', session.user.id)
      .select()
      .single()

    if (error) throw error
    return data as Item
  }

  async function uploadImages(tempFiles: string[]): Promise<string[]> {
    if (tempFiles.length > MAX_IMAGES) throw new Error('Too many files')
    const urls: string[] = []

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    for (const filePath of tempFiles) {
      const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg'
      const contentType = ALLOWED_UPLOAD_EXTS[ext]
      if (!contentType) throw new Error(`Unsupported file type: ${ext}`)

      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const storagePath = `items/${session.user.id}/${fileName}`

      try {
        let uploadError: any = null

        // #ifdef H5
        const response = await fetch(filePath)
        const blob = await response.blob()
        if (blob.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
        const h5Result = await supabase.storage
          .from('item-images')
          .upload(storagePath, blob, { contentType })
        uploadError = h5Result.error
        // #endif

        // #ifndef H5
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const uploadUrl = `${supabaseUrl}/storage/v1/object/item-images/${storagePath}`
        uploadError = await new Promise<any>((resolve) => {
          uni.uploadFile({
            url: uploadUrl,
            filePath,
            name: 'file',
            header: {
              Authorization: `Bearer ${session.access_token}`,
              'x-upsert': 'false',
            },
            success: () => resolve(null),
            fail: (err) => resolve(err),
          })
        })
        // #endif

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('item-images')
            .getPublicUrl(storagePath)
          urls.push(urlData.publicUrl)
        }
      } catch (err) {
        console.warn('Upload error for', filePath, err)
      }
    }

    return urls
  }

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

  async function updateItemStatus(id: string, status: ItemStatus) {
    if (!VALID_STATUSES.includes(status)) throw new Error('Invalid status')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('items')
      .update({ status })
      .eq('id', id)
      .eq('user_id', session.user.id)

    if (error) throw error
  }

  async function deleteItem(id: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const { error } = await supabase
      .from('items')
      .delete()
      .eq('id', id)
      .eq('user_id', session.user.id)

    if (error) throw error

    items.value = items.value.filter(i => i.id !== id)
  }

  function clearItems() {
    items.value = []
    hasMore.value = true
  }

  return {
    items,
    loading,
    hasMore,
    fetchItems,
    fetchItem,
    createItem,
    updateItem,
    updateItemStatus,
    uploadImages,
    fetchMyItems,
    deleteItem,
    clearItems,
  }
}
