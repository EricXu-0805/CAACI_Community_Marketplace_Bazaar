import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import type { Item, ItemCategory, ItemCondition, ItemStatus } from '../types'
import { compressImage, expandSearch, getImageDimensions } from '../utils'
import { checkContent, isLocalDuplicate, remoteModerate } from '../utils/contentSafety'

const items = ref<Item[]>([])
const loading = ref(false)
const hasMore = ref(true)
const fetchError = ref('')

const PAGE_SIZE = 20
const PUBLIC_PROFILE_FIELDS_FULL = 'id, nickname, avatar_url, location, is_illini_verified, status_text, status_emoji'
const PUBLIC_PROFILE_FIELDS_LEGACY = 'id, nickname, avatar_url, location, is_illini_verified'
/*
 * Select lists.
 *
 * FULL includes every post-014/015 column we care about for the card grid.
 * LEGACY drops the i18n / dimension / location_verified columns so pre-
 * migration databases don't bomb with 42703. When fetchItems() hits such
 * an error we flip the respective boolean flags below and retry with the
 * reduced list; pages then get back plain Item rows with the new fields
 * simply `undefined`, and the frontend's ?? fallbacks quietly carry on.
 */
const LIST_ITEM_FIELDS_FULL =
  'id, user_id, title, title_i18n, description_i18n, source_lang, price, category, condition, status, location, location_verified, images, image_dimensions, view_count, favorite_count, negotiable, created_at'
const LIST_ITEM_FIELDS_LEGACY =
  'id, user_id, title, price, category, condition, status, location, images, view_count, favorite_count, negotiable, created_at'
/*
 * DETAIL lists add `description` and `updated_at` to the LIST variants —
 * these are only needed on single-item screens (detail page, profile
 * "my items"), never in the card grid. Same FULL/LEGACY split: FULL
 * mirrors a fully-migrated schema, LEGACY strips the post-014/015
 * columns that PostgreSQL will 42703 on unmigrated databases.
 */
const DETAIL_ITEM_FIELDS_FULL = `${LIST_ITEM_FIELDS_FULL}, description, updated_at`
const DETAIL_ITEM_FIELDS_LEGACY = `${LIST_ITEM_FIELDS_LEGACY}, description, updated_at`

let locationVerifiedAvailable = true
let profileStatusAvailable = true
function isMissingLocationVerified(err: any): boolean {
  return err?.code === '42703' && String(err?.message || '').includes('location_verified')
}
function isMissingStatusColumn(err: any): boolean {
  return err?.code === '42703' && /status_/.test(String(err?.message || ''))
}
function isMissingPostMigrationColumn(err: any): boolean {
  return err?.code === '42703' && /image_dimensions|title_i18n|description_i18n|source_lang|location_verified/.test(String(err?.message || ''))
}
function publicProfileFields() {
  return profileStatusAvailable ? PUBLIC_PROFILE_FIELDS_FULL : PUBLIC_PROFILE_FIELDS_LEGACY
}
function detailItemFields() {
  return locationVerifiedAvailable ? DETAIL_ITEM_FIELDS_FULL : DETAIL_ITEM_FIELDS_LEGACY
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
        /*
         * The select() call's TS inference tries to build a discriminated union
         * over every possible column combination. With the 015 migration
         * LIST_ITEM_FIELDS_FULL now crosses ~17 columns and TS 4.9 blows past
         * the "union too complex" ceiling (TS2590). Casting to `any` on the
         * select string is the standard supabase-js escape — we cast back at
         * the return boundary below where the typed `Item[]` shape is
         * reasserted.
         */
        let q = supabase
          .from('items')
          .select(`${fields}, profile:profiles(${publicProfileFields()})` as any)
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
      if (error && isMissingStatusColumn(error)) {
        console.warn('[useItems] profiles.status_* missing — falling back (run migration 021)')
        profileStatusAvailable = false
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
    const runFetch = () => supabase
      .from('items')
      .select(`${detailItemFields()}, profile:profiles(${publicProfileFields()})` as any)
      .eq('id', id)
      .single()

    let { data, error } = await runFetch()
    if (error && isMissingPostMigrationColumn(error)) {
      console.warn('[useItems] items post-migration column missing — falling back (run migrations 014/015/020)')
      locationVerifiedAvailable = false
      ;({ data, error } = await runFetch())
    }
    if (error && isMissingStatusColumn(error)) {
      console.warn('[useItems] profiles.status_* missing — falling back (run migration 021)')
      profileStatusAvailable = false
      ;({ data, error } = await runFetch())
    }
    if (error) throw error

    supabase.rpc('increment_view_count', { item_id: id }).then(({ error: rpcError }) => {
      if (rpcError) console.warn('view_count increment failed:', rpcError.message)
    })

    return data as unknown as Item
  }

  /*
   * Create an item.
   *
   * Post-migration fields (title_i18n, description_i18n, source_lang,
   * image_dimensions) are optional — if the connected Supabase database
   * hasn't run 014/015 yet the insert will fail with 42703 and we'll
   * retry minus those keys. The same backward-compat treatment the
   * existing location_verified column already enjoys.
   */
  async function createItem(input: {
    title: string
    description: string
    price: number
    category: ItemCategory
    condition: ItemCondition
    location: string
    images: string[]
    image_dimensions?: Array<{ w: number; h: number }>
    title_i18n?: Record<string, string> | null
    description_i18n?: Record<string, string> | null
    source_lang?: string | null
    negotiable?: boolean
    location_verified?: boolean
  }) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    if (input.price < 0 || input.price > 100000) throw new Error('Invalid price')
    if (input.title.length > 200) throw new Error('Title too long')
    if (input.description.length > 2000) throw new Error('Description too long')
    if (input.images.length > MAX_IMAGES) throw new Error('Too many images')

    const titleCheck = checkContent(input.title, { kind: 'item_title' })
    if (!titleCheck.ok) throw new Error(`moderation_block:${titleCheck.category}:${titleCheck.reason || ''}`)
    if (input.description) {
      const descCheck = checkContent(input.description, { kind: 'item_desc' })
      if (!descCheck.ok) throw new Error(`moderation_block:${descCheck.category}:${descCheck.reason || ''}`)
    }
    if (isLocalDuplicate('item', `${input.title}::${input.description}`)) {
      throw new Error('duplicate_item')
    }
    const ai = await remoteModerate(`${input.title}\n${input.description}`)
    if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)

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
    if (input.image_dimensions && input.image_dimensions.length) {
      basePayload.image_dimensions = input.image_dimensions
    }
    if (input.title_i18n) basePayload.title_i18n = input.title_i18n
    if (input.description_i18n) basePayload.description_i18n = input.description_i18n
    if (input.source_lang) basePayload.source_lang = input.source_lang

    const stripNewCols = (p: Record<string, any>) => {
      delete p.image_dimensions
      delete p.title_i18n
      delete p.description_i18n
      delete p.source_lang
    }
    const isMissingNewCol = (err: any): boolean => {
      const msg = String(err?.message || '')
      return err?.code === '42703' && /image_dimensions|title_i18n|description_i18n|source_lang/.test(msg)
    }

    let insertRes = await supabase.from('items').insert(basePayload).select().single()
    if (insertRes.error && isMissingLocationVerified(insertRes.error)) {
      locationVerifiedAvailable = false
      delete basePayload.location_verified
      insertRes = await supabase.from('items').insert(basePayload).select().single()
    }
    if (insertRes.error && isMissingNewCol(insertRes.error)) {
      stripNewCols(basePayload)
      insertRes = await supabase.from('items').insert(basePayload).select().single()
    }
    if (insertRes.error) throw insertRes.error
    return insertRes.data as Item
  }

  async function updateItem(id: string, updates: Partial<Pick<Item, 'title' | 'description' | 'price' | 'location' | 'images' | 'image_dimensions' | 'title_i18n' | 'description_i18n' | 'source_lang' | 'negotiable' | 'location_verified'>>) {
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

  /*
   * Upload a batch of local file references to Supabase Storage and
   * return a parallel pair of arrays: final public URLs + per-image
   * natural dimensions measured BEFORE compression.
   *
   * Important contract: urls.length === dims.length. When an upload
   * fails we skip BOTH — the caller's image_dimensions[] will still
   * line up 1:1 with the urls[] it writes into items.images.
   *
   * Dimensions are measured against the original file so the stored
   * aspect ratio matches the unscaled image the user uploaded. Any
   * downscaling done by compressImage() preserves ratio, so the
   * numbers stay meaningful after Supabase's render-time thumbnail.
   */
  async function uploadImagesWithDims(
    tempFiles: string[],
  ): Promise<{ urls: string[]; dims: Array<{ w: number; h: number }> }> {
    if (tempFiles.length > MAX_IMAGES) throw new Error('Too many files')
    const urls: string[] = []
    const dims: Array<{ w: number; h: number }> = []

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
        // Measure before compression so the stored w/h is the author's
        // real photo aspect, not a rounded canvas output. Swallows errors.
        const naturalDims = await getImageDimensions(filePath)

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
          dims.push(naturalDims)
        } else {
          console.warn('Upload rejected for', filePath, uploadError)
        }
      } catch (err) {
        console.warn('Upload error for', filePath, err)
      }
    }

    return { urls, dims }
  }

  // Back-compat thin wrapper: legacy callers that only want URLs.
  async function uploadImages(tempFiles: string[]): Promise<string[]> {
    const { urls } = await uploadImagesWithDims(tempFiles)
    return urls
  }

  async function fetchMyItems(userId: string) {
    const runFetch = () => supabase
      .from('items')
      .select(detailItemFields() as any)
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })

    let { data, error } = await runFetch()
    if (error && isMissingPostMigrationColumn(error)) {
      console.warn('[useItems] items post-migration column missing — falling back (run migrations 014/015/020)')
      locationVerifiedAvailable = false
      ;({ data, error } = await runFetch())
    }
    if (error) throw error
    return (data || []) as unknown as Item[]
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
    uploadImagesWithDims,
    fetchMyItems,
    deleteItem,
    clearItems,
  }
}
