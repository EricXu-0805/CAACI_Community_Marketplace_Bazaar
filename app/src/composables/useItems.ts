import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import type { Item, ItemCategory, ItemCondition, ItemStatus } from '../types'
import { compressImage, expandSearch } from '../utils'

const items = ref<Item[]>([])
const loading = ref(false)
const hasMore = ref(true)
const fetchError = ref('')

const PAGE_SIZE = 20
const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, location, is_illini_verified'
const LIST_ITEM_FIELDS_FULL =
  'id, user_id, title, price, category, condition, status, location, location_verified, images, view_count, favorite_count, negotiable, created_at'
const LIST_ITEM_FIELDS_LEGACY =
  'id, user_id, title, price, category, condition, status, location, images, view_count, favorite_count, negotiable, created_at'

// Set to true once we detect migration 020 has been applied. Stays true for
// the session; flips to false if the first real query fails with 42703.
let locationVerifiedAvailable = true
function isMissingLocationVerified(err: any): boolean {
  return err?.code === '42703' && String(err?.message || '').includes('location_verified')
}

const VALID_STATUSES: ItemStatus[] = ['active', 'reserved', 'sold', 'deleted']
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_IMAGES = 9

export function useItems() {
  const { supabase } = useSupabase()
  const { t } = useI18n()

  async function fetchItems(options: {
    page?: number
    category?: ItemCategory | null
    search?: string
    userId?: string
    priceMin?: number
    priceMax?: number
    condition?: ItemCondition | null
    sort?: string
    reset?: boolean
  } = {}) {
    const { page = 0, category, search, userId, priceMin, priceMax, condition, sort, reset = false } = options

    if (reset) {
      items.value = []
      hasMore.value = true
    }

    loading.value = true
    fetchError.value = ''
    try {
      const buildQuery = () => {
        const fields = locationVerifiedAvailable ? LIST_ITEM_FIELDS_FULL : LIST_ITEM_FIELDS_LEGACY
        let q = supabase
          .from('items')
          .select(`${fields}, profile:profiles(${PUBLIC_PROFILE_FIELDS})`)
          .eq('status', 'active')

        if (sort === 'price_asc') q = q.order('price', { ascending: true })
        else if (sort === 'price_desc') q = q.order('price', { ascending: false })
        else if (sort === 'popular') q = q.order('view_count', { ascending: false })
        else q = q.order('created_at', { ascending: false })

        q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

        if (category) q = q.eq('category', category)
        if (search) {
          const terms = expandSearch(search)
          const conditions = terms.map(t => {
            const s = t.replace(/[%_]/g, '\\$&').replace(/[.,()]/g, '').slice(0, 100)
            return `title.ilike.%${s}%,description.ilike.%${s}%`
          })
          q = q.or(conditions.join(','))
        }
        if (userId) q = q.eq('user_id', userId)
        if (priceMin !== undefined && priceMin > 0) q = q.gte('price', priceMin)
        if (priceMax !== undefined && priceMax > 0) q = q.lte('price', priceMax)
        if (condition) q = q.eq('condition', condition)
        return q
      }

      let { data, error } = await buildQuery()
      if (error && isMissingLocationVerified(error)) {
        console.warn('[useItems] items.location_verified missing — falling back (run migration 020)')
        locationVerifiedAvailable = false
        ;({ data, error } = await buildQuery())
      }
      if (error) throw error

      if (data) {
        const { blockedIds } = useModeration()
        const rows = data as unknown as Item[]
        const filtered = blockedIds.value.size > 0
          ? rows.filter(item => !blockedIds.value.has(item.user_id))
          : rows

        if (reset) {
          items.value = filtered
        } else {
          items.value.push(...filtered)
        }
        hasMore.value = data.length === PAGE_SIZE
      }
    } catch (error: any) {
      fetchError.value = error?.message || t('error.loadFailed')
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

    supabase.rpc('increment_view_count', { item_id: id }).then(({ error: rpcError }) => {
      if (rpcError) console.warn('view_count increment failed:', rpcError.message)
    })

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
    location_verified?: boolean
  }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    if (input.price < 0 || input.price > 100000) throw new Error('Invalid price')
    if (input.title.length > 200) throw new Error('Title too long')
    if (input.description.length > 2000) throw new Error('Description too long')
    if (input.images.length > MAX_IMAGES) throw new Error('Too many images')

    const basePayload: Record<string, any> = {
      user_id: session.user.id,
      title: input.title,
      description: input.description,
      price: input.price,
      category: input.category,
      condition: input.condition,
      location: input.location,
      images: input.images,
      negotiable: input.negotiable ?? false,
    }
    if (locationVerifiedAvailable) basePayload.location_verified = input.location_verified ?? false

    let insertRes = await supabase.from('items').insert(basePayload).select().single()
    if (insertRes.error && isMissingLocationVerified(insertRes.error)) {
      locationVerifiedAvailable = false
      delete basePayload.location_verified
      insertRes = await supabase.from('items').insert(basePayload).select().single()
    }
    if (insertRes.error) throw insertRes.error
    return insertRes.data as Item
  }

  async function updateItem(id: string, updates: Partial<Pick<Item, 'title' | 'description' | 'price' | 'location' | 'images' | 'negotiable' | 'location_verified'>>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const patch: Record<string, any> = { ...updates }
    if (!locationVerifiedAvailable) delete patch.location_verified

    let res = await supabase
      .from('items')
      .update(patch)
      .eq('id', id)
      .eq('user_id', session.user.id)
      .select()
      .single()

    if (res.error && isMissingLocationVerified(res.error)) {
      locationVerifiedAvailable = false
      delete patch.location_verified
      res = await supabase
        .from('items')
        .update(patch)
        .eq('id', id)
        .eq('user_id', session.user.id)
        .select()
        .single()
    }

    if (res.error) throw res.error
    return res.data as Item
  }

  async function uploadImages(tempFiles: string[]): Promise<string[]> {
    if (tempFiles.length > MAX_IMAGES) throw new Error('Too many files')
    const urls: string[] = []

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
      })

    for (const filePath of tempFiles) {
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const storagePath = `items/${session.user.id}/${fileName}`

      try {
        let uploadError: any = null

        // #ifdef H5
        const compressed = await compressImage(filePath, 1600, 0.82)
        const response = await fetch(compressed)
        const blob = await response.blob()
        if (blob.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
        const h5Result = await withTimeout(
          supabase.storage.from('item-images').upload(storagePath, blob, { contentType: 'image/jpeg' }),
          30000,
          'image upload',
        )
        uploadError = h5Result.error
        // #endif

        // #ifndef H5
        const compressedPath = await compressImage(filePath, 1600, 0.82)
        const fileInfo = await new Promise<{ size: number } | null>((resolve) => {
          uni.getFileInfo({
            filePath: compressedPath,
            success: (info: any) => resolve({ size: info.size }),
            fail: () => resolve(null),
          })
        })
        if (fileInfo && fileInfo.size > MAX_FILE_SIZE) {
          throw new Error('File too large (max 5MB)')
        }

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const uploadUrl = `${supabaseUrl}/storage/v1/object/item-images/${storagePath}`
        uploadError = await new Promise<any>((resolve) => {
          uni.uploadFile({
            url: uploadUrl,
            filePath: compressedPath,
            name: 'file',
            header: {
              Authorization: `Bearer ${session.access_token}`,
              'x-upsert': 'false',
            },
            success: (res: any) => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve(null)
              } else {
                resolve(new Error(`Upload HTTP ${res.statusCode}: ${res.data}`))
              }
            },
            fail: (err) => resolve(err),
          })
        })
        // #endif

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('item-images')
            .getPublicUrl(storagePath)
          urls.push(urlData.publicUrl)
        } else {
          console.warn('Upload rejected for', filePath, uploadError)
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
    fetchError,
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
