import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import type { Item, ItemCategory, ItemCondition, ItemStatus } from '../types'
import { compressImage, detectImageMimeType, expandSearch, getImageDimensions } from '../utils'
import { checkContent, isLocalDuplicate, remoteModerate } from '../utils/contentSafety'

const items = ref<Item[]>([])
const loading = ref(false)
const hasMore = ref(true)
const fetchError = ref('')

const PAGE_SIZE = 20

/*
 * Public column projection — kept aligned with migrations 014 / 015 /
 * 020 / 021 (all production-applied; the 035-era LEGACY fallback path
 * was retired since every active database has these columns). If you
 * add a new public column here, update the matching projection in
 * useFollow.ts so the home feed and the follow feed render the same
 * card layout.
 */
const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, location, is_illini_verified, status_text, status_emoji'
const LIST_ITEM_FIELDS =
  'id, user_id, title, title_i18n, description_i18n, source_lang, price, category, condition, status, location, location_verified, images, image_dimensions, view_count, favorite_count, negotiable, created_at'
const DETAIL_ITEM_FIELDS = `${LIST_ITEM_FIELDS}, description, updated_at`

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
      let data: any
      let error: any

      if (search && search.trim()) {
        /*
         * Search path → call search_items_fuzzy RPC (migration 038).
         * The RPC uses the gin_trgm_ops indexes from migration 007 and
         * ranks by similarity, which the OR-of-ILIKE PostgREST path
         * could not. expandSearch() produces synonym variants for the
         * cross-script bridge (e.g. 免费 → free / giveaway).
         *
         * Sort order from `sort` is ignored when searching — relevance
         * (rank) wins, with created_at DESC as the tie-break. This
         * matches typical e-commerce behavior; a user searching "desk"
         * who wants the cheapest one will refine via priceMin/Max.
         */
        const sanitized = expandSearch(search)
          .map(t => t.replace(/[%_]/g, '\\$&').replace(/[.,()]/g, '').slice(0, 100))
          .filter(Boolean)
        if (sanitized.length === 0) {
          loading.value = false
          return
        }
        const rpcRes = await supabase.rpc('search_items_fuzzy', {
          terms_in:     sanitized,
          category_in:  category ?? null,
          condition_in: condition ?? null,
          price_min_in: priceMin && priceMin > 0 ? priceMin : null,
          price_max_in: priceMax && priceMax > 0 ? priceMax : null,
          user_id_in:   userId ?? null,
          limit_in:     PAGE_SIZE,
          offset_in:    page * PAGE_SIZE,
        })
        data = rpcRes.data
        error = rpcRes.error
      } else {
        /*
         * No-search path → plain PostgREST query. The select() call's
         * TS inference tries to build a discriminated union over every
         * possible column combination; with LIST_ITEM_FIELDS crossing
         * ~17 columns, TS 4.9 blows past the "union too complex"
         * ceiling (TS2590). Cast the select string to `any` and
         * reassert `Item[]` at the return boundary.
         */
        let q = supabase
          .from('items')
          .select(`${LIST_ITEM_FIELDS}, profile:profiles(${PUBLIC_PROFILE_FIELDS})` as any)
          .eq('status', 'active')

        if (sort === 'price_asc') q = q.order('price', { ascending: true })
        else if (sort === 'price_desc') q = q.order('price', { ascending: false })
        else if (sort === 'popular') q = q.order('view_count', { ascending: false })
        else q = q.order('created_at', { ascending: false })

        q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

        if (category) q = q.eq('category', category)
        if (userId) q = q.eq('user_id', userId)
        if (priceMin !== undefined && priceMin > 0) q = q.gte('price', priceMin)
        if (priceMax !== undefined && priceMax > 0) q = q.lte('price', priceMax)
        if (condition) q = q.eq('condition', condition)

        const res = await q
        data = res.data
        error = res.error
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
      .select(`${DETAIL_ITEM_FIELDS}, profile:profiles(${PUBLIC_PROFILE_FIELDS})` as any)
      .eq('id', id)
      .single()
    if (error) throw error

    supabase.rpc('increment_view_count', { item_id: id }).then(({ error: rpcError }) => {
      if (rpcError) console.warn('view_count increment failed:', rpcError.message)
    })

    return data as unknown as Item
  }

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

    // Hard cap is 1M as anti-typo / anti-abuse defense in depth. The 100k
    // soft ceiling is enforced as a UI modal in pages/publish/index.vue
    // (gives user "are you sure?" affordance). 1M is far above any
    // legitimate campus listing — no one prices a textbook at $1M.
    if (input.price < 0 || input.price > 1_000_000) throw new Error('Invalid price')
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

    const payload: Record<string, any> = {
      user_id: session.user.id,
      title: input.title,
      description: input.description,
      price: input.price,
      category: input.category,
      condition: input.condition,
      location: input.location,
      images: input.images,
      negotiable: input.negotiable ?? false,
      location_verified: input.location_verified ?? false,
    }
    if (input.image_dimensions && input.image_dimensions.length) {
      payload.image_dimensions = input.image_dimensions
    }
    if (input.title_i18n) payload.title_i18n = input.title_i18n
    if (input.description_i18n) payload.description_i18n = input.description_i18n
    if (input.source_lang) payload.source_lang = input.source_lang

    const { data, error } = await supabase.from('items').insert(payload).select().single()
    if (error) throw error
    return data as Item
  }

  async function updateItem(id: string, updates: Partial<Pick<Item, 'title' | 'description' | 'price' | 'location' | 'images' | 'image_dimensions' | 'title_i18n' | 'description_i18n' | 'source_lang' | 'negotiable' | 'location_verified'>>) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    // Mirror the createItem hard cap. Without this guard, a user could create
    // a listing under the cap then edit it past — backend integrity hole.
    if (updates.price !== undefined && (updates.price < 0 || updates.price > 1_000_000)) {
      throw new Error('Invalid price')
    }

    // Mirror createItem's length guards (lines 187-188). Without these a
    // user could create a short listing then edit the text fields past
    // the limits — closes anomaly E from the handoff.
    if (updates.title !== undefined && updates.title.length > 200) {
      throw new Error('Title too long')
    }
    if (updates.description !== undefined && updates.description.length > 2000) {
      throw new Error('Description too long')
    }

    /*
     * Mirror createItem's moderation pipeline (lines 191-201) so users
     * cannot bypass AI/keyword screening by posting a clean listing
     * then editing title/description to sensitive content. Each guard
     * short-circuits on `!== undefined` so non-text edits — price-only,
     * image-only, location-only, status flips via updateItemStatus,
     * and the post-publish bilingual i18n fill from scheduleBilingualFill
     * (publish/index.vue:203) — pay zero moderation cost and stay fast.
     *
     * Error strings match createItem byte-exact so friendlyErrorMessage
     * (utils/index.ts:87) translates them with the existing keys; no
     * new i18n entries needed. The DB-side trg_moderate_items trigger
     * (migrations 024 / 033) is a defense-in-depth layer that catches
     * keyword hits at the SQL boundary but does NOT call OpenAI — this
     * client gate is what closes the AI-tier portion of the bypass.
     */
    if (updates.title !== undefined) {
      const titleCheck = checkContent(updates.title, { kind: 'item_title' })
      if (!titleCheck.ok) throw new Error(`moderation_block:${titleCheck.category}:${titleCheck.reason || ''}`)
    }
    if (updates.description !== undefined && updates.description) {
      const descCheck = checkContent(updates.description, { kind: 'item_desc' })
      if (!descCheck.ok) throw new Error(`moderation_block:${descCheck.category}:${descCheck.reason || ''}`)
    }
    if (updates.title !== undefined || updates.description !== undefined) {
      const aiInput = [updates.title, updates.description]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join('\n')
      if (aiInput.length > 0) {
        const ai = await remoteModerate(aiInput)
        if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)
      }
    }

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
    options?: { entryPoint?: string },
  ): Promise<{ urls: string[]; dims: Array<{ w: number; h: number }> }> {
    if (tempFiles.length > MAX_IMAGES) throw new Error('Too many files')
    const urls: string[] = []
    const dims: Array<{ w: number; h: number }> = []

    /*
     * Diagnostic logging — re-added 2025-04-25 to investigate "post saved
     * but images missing" reports. Tagged [upload-debug] so the user can
     * filter the H5 console by that string. The earlier round of logs
     * (commits 372c3f0 / f848922) was removed once the dim-measurement
     * issue was resolved; the upload-path issue is a different shape.
     *
     * What we log per file:
     *   · the temp-file path (first 60 chars to keep noise down)
     *   · natural dimensions measured BEFORE compression
     *   · compressed blob size (H5) or file size (mp)
     *   · the resolved storage path
     *   · success or the underlying error object
     *
     * Plus a summary on entry and exit so we can correlate the per-file
     * lines with "expected vs actual" counts at the call site.
     */
    console.log('[upload-debug] uploadImagesWithDims start, files:', tempFiles.length)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    console.log('[upload-debug] session user:', session.user.id)

    const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
      })

    for (const filePath of tempFiles) {
      const shortPath = filePath.slice(0, 60) + (filePath.length > 60 ? '…' : '')
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const storagePath = `items/${session.user.id}/${fileName}`
      console.log('[upload-debug] processing file:', shortPath, '→', storagePath)

      try {
        const naturalDims = await getImageDimensions(filePath)
        console.log('[upload-debug] dims measured:', naturalDims.w, 'x', naturalDims.h)

        let uploadError: any = null

        // #ifdef H5
        const compressed = await compressImage(filePath, { entryPoint: options?.entryPoint })
        const response = await fetch(compressed)
        const blob = await response.blob()
        console.log('[upload-debug] blob size (compressed):', blob.size, 'bytes')
        if (blob.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
        const contentType = await detectImageMimeType(blob)
        const h5Result = await withTimeout(
          supabase.storage.from('item-images').upload(storagePath, blob, { contentType }),
          30000,
          'image upload',
        )
        uploadError = h5Result.error
        if (uploadError) {
          console.warn('[upload-debug] H5 upload error:', uploadError)
        } else {
          console.log('[upload-debug] H5 upload OK')
        }
        // #endif

        // #ifndef H5
        const compressedPath = await compressImage(filePath, { entryPoint: options?.entryPoint })
        const fileInfo = await new Promise<{ size: number } | null>((resolve) => {
          uni.getFileInfo({
            filePath: compressedPath,
            success: (info: any) => resolve({ size: info.size }),
            fail: () => resolve(null),
          })
        })
        console.log('[upload-debug] mp file size:', fileInfo?.size ?? 'unknown')
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
                console.log('[upload-debug] mp upload OK, status:', res.statusCode)
                resolve(null)
              } else {
                console.warn('[upload-debug] mp upload error, status:', res.statusCode, 'body:', res.data)
                resolve(new Error(`Upload HTTP ${res.statusCode}: ${res.data}`))
              }
            },
            fail: (err) => {
              console.warn('[upload-debug] mp uploadFile fail:', err)
              resolve(err)
            },
          })
        })
        // #endif

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('item-images')
            .getPublicUrl(storagePath)
          urls.push(urlData.publicUrl)
          dims.push(naturalDims)
          console.log('[upload-debug] pushed URL:', urlData.publicUrl)
        } else {
          console.warn('[upload-debug] skipping file due to upload error:', filePath)
        }
      } catch (err) {
        if ((err as { heic?: unknown })?.heic === true) {
          console.warn('[upload-debug] heic error — aborting batch:', shortPath, err)
          throw err
        }
        console.warn('[upload-debug] caught exception for', shortPath, err)
      }
    }

    console.log('[upload-debug] DONE — urls:', urls.length, 'dims:', dims.length, 'expected:', tempFiles.length)
    return { urls, dims }
  }

  async function uploadImages(
    tempFiles: string[],
    options?: { entryPoint?: string },
  ): Promise<string[]> {
    const { urls } = await uploadImagesWithDims(tempFiles, options)
    return urls
  }

  /*
   * uploadOneImage — single-file upload that THROWS on any failure
   * instead of swallowing per-file errors like uploadImagesWithDims.
   *
   * Why this exists: uploadImagesWithDims was designed for the publish
   * + plaza flows where partial success is acceptable (5 of 6 photos
   * uploaded → still post the item with a toast about the missed one).
   * That contract intentionally swallows per-file errors. Chat's
   * image-send flow is the OPPOSITE shape: 1 file in, 1 message out;
   * if the upload fails, there's no message to send and the user
   * needs to know WHY the file didn't make it (RLS? bucket missing?
   * 413? auth expired?). The swallowed-then-empty-array pattern was
   * surfacing as a generic 'imageUploadFailed' toast with no diagnostic
   * — users had no way to tell whether to retry, pick a smaller photo,
   * or report the bug.
   *
   * This method threads the actual Supabase error through to the
   * caller so the toast can show 'Storage upload failed: 413 Payload
   * Too Large' or 'new row violates row-level security policy' or
   * whatever the real cause is. It also drops the chat's outer
   * pre-compression pass — uploadImagesWithDims was already
   * compressing internally; the second pass on a data:URL of an
   * already-compressed image was wasted work and a quality loss.
   */
  async function uploadOneImage(
    tempFile: string,
    options?: { entryPoint?: string },
  ): Promise<{ url: string; dims: { w: number; h: number } }> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')

    const entryPoint = options?.entryPoint || 'chat'
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
    const storagePath = `items/${session.user.id}/${fileName}`
    console.log('[upload-debug] uploadOneImage start:', tempFile.slice(0, 60), '→', storagePath)

    const naturalDims = await getImageDimensions(tempFile)
    console.log('[upload-debug] dims:', naturalDims.w, 'x', naturalDims.h)

    // #ifdef H5
    const compressed = await compressImage(tempFile, { entryPoint })
    const response = await fetch(compressed)
    const blob = await response.blob()
    console.log('[upload-debug] blob size:', blob.size, 'bytes')
    if (blob.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
    const contentType = await detectImageMimeType(blob)
    const { error: h5Err } = await supabase.storage
      .from('item-images')
      .upload(storagePath, blob, { contentType })
    if (h5Err) {
      console.warn('[upload-debug] H5 upload error:', h5Err)
      throw new Error(`Storage upload failed: ${h5Err.message || 'unknown'}`)
    }
    console.log('[upload-debug] H5 upload OK')
    // #endif

    // #ifndef H5
    const compressedPath = await compressImage(tempFile, { entryPoint })
    const fileInfo = await new Promise<{ size: number } | null>((resolve) => {
      uni.getFileInfo({
        filePath: compressedPath,
        success: (info: any) => resolve({ size: info.size }),
        fail: () => resolve(null),
      })
    })
    console.log('[upload-debug] mp file size:', fileInfo?.size ?? 'unknown')
    if (fileInfo && fileInfo.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const uploadUrl = `${supabaseUrl}/storage/v1/object/item-images/${storagePath}`
    await new Promise<void>((resolve, reject) => {
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
            console.log('[upload-debug] mp upload OK, status:', res.statusCode)
            resolve()
          } else {
            console.warn('[upload-debug] mp upload error, status:', res.statusCode, 'body:', res.data)
            reject(new Error(`Storage upload failed: HTTP ${res.statusCode} ${res.data || ''}`.trim()))
          }
        },
        fail: (err) => {
          console.warn('[upload-debug] mp uploadFile fail:', err)
          reject(new Error(err?.errMsg || 'Storage upload failed (network)'))
        },
      })
    })
    // #endif

    const { data: urlData } = supabase.storage.from('item-images').getPublicUrl(storagePath)
    if (!urlData?.publicUrl) {
      throw new Error('Storage upload succeeded but public URL resolution failed')
    }
    console.log('[upload-debug] uploadOneImage DONE:', urlData.publicUrl)
    return { url: urlData.publicUrl, dims: naturalDims }
  }

  async function fetchMyItems(userId: string) {
    const { data, error } = await supabase
      .from('items')
      .select(DETAIL_ITEM_FIELDS as any)
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
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
    uploadOneImage,
    fetchMyItems,
    deleteItem,
    clearItems,
  }
}
