import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import type { Item, ItemCategory, ItemCondition, ItemSaleCandidate, ItemStatus } from '../types'
import { compressImage, detectImageMimeType, expandSearch, friendlyErrorMessage, getImageDimensions } from '../utils'
import { checkContent, clearLocalDuplicate, isLocalDuplicate, remoteModerate } from '../utils/contentSafety'
import { mpTextGate, mpImageCheck } from './useWechatSecCheck'
import { searchItemsWithCompatibility } from '../api/searchItems'
import {
  isDefinitiveMutationRejection,
  mutationCommitState,
  mutationOutcomeError,
  shouldCompensateMutationFailure,
  type MutationOutcomeError,
} from '../api/mutationCommit'
import { ownedItemImagePaths } from '../utils/itemStorage'
import { captureException } from '../utils/sentry'
import {
  assertI18nWrite,
  assertPublicMediaWrite,
  sanitizeItemResources,
} from '../utils/publicResource'
import {
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from './accountScope'

const items = ref<Item[]>([])
const loading = ref(false)
const hasMore = ref(true)
const fetchError = ref('')

const PAGE_SIZE = 20

// Race guard for fetchItems(): items/loading/hasMore/fetchError above are
// module-scoped, so every consumer of useItems() shares one race surface.
// Without this counter a slow earlier request can resolve AFTER a faster
// later one and overwrite the new tab's data with the old tab's data.
let latestRequestId = 0

/*
 * Public column projection — kept aligned with migrations 014 / 015 /
 * 020 / 021 (all production-applied; the 035-era LEGACY fallback path
 * was retired since every active database has these columns). If you
 * add a new public column here, update the matching projection in
 * useFollow.ts so the home feed and the follow feed render the same
 * card layout.
 */
const PUBLIC_PROFILE_FIELDS = 'id, nickname, avatar_url, location, is_illini_verified, avg_rating, rating_count, status_text, status_emoji'
const LIST_ITEM_FIELDS =
  'id, user_id, title, title_i18n, description_i18n, source_lang, price, category, condition, status, listing_type, location, location_verified, images, image_dimensions, view_count, favorite_count, negotiable, created_at'
const DETAIL_ITEM_FIELDS = `${LIST_ITEM_FIELDS}, description, updated_at`

const VALID_STATUSES: ItemStatus[] = ['active', 'reserved', 'sold', 'deleted']
const MAX_FILE_SIZE = 5 * 1024 * 1024
const MAX_IMAGES = 9
const IMAGE_UPLOAD_TIMEOUT_MS = 30_000

export type UploadAccountToken = AccountRequestToken

export interface UploadBatchResult {
  urls: string[]
  dims: Array<{ w: number; h: number }>
  /** Identity + generation that owned every object in this upload batch. */
  accountToken: UploadAccountToken
}

type ItemMutationOptions = {
  expectedUpdatedAt?: string
  /** Required by publish/edit whenever images came from an upload batch. */
  accountToken?: UploadAccountToken
}

type OwnedImageCleanupOptions = {
  /** Original owner of a compensating upload cleanup. Never infer B for A's URLs. */
  ownerUserId?: string
  telemetrySource?: string
}

type AccountChangedError = MutationOutcomeError & {
  code: 'account_changed'
}

function accountChangedError(mutationCommitted = false): AccountChangedError {
  const error = mutationOutcomeError(
    new Error('Authentication changed'),
    mutationCommitted ? 'committed' : 'not_committed',
  ) as AccountChangedError
  error.code = 'account_changed'
  return error
}

function assertAccountCurrent(token: UploadAccountToken, sessionUserId?: string): void {
  if (
    (sessionUserId !== undefined && token.userId !== sessionUserId) ||
    !isAccountRequestCurrent(token)
  ) {
    throw accountChangedError()
  }
}

function isAccountChangedError(error: unknown): error is AccountChangedError {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'account_changed'
}

function withUploadTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onLateSettle: () => Promise<void>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      settled = true
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        if (timedOut) {
          // A request can land after its caller handled the timeout. Clean the
          // still-unreferenced candidate after the transport actually settles.
          void onLateSettle().catch(() => {})
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (timedOut) {
          void onLateSettle().catch(() => {})
          return
        }
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function miniProgramUploadWithTimeout(
  options: UniApp.UploadFileOption,
  ms: number,
  label: string,
  onLateSettle: () => Promise<void>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    let timedOut = false
    let settled = false
    let task: { abort?: () => void } | undefined
    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      settled = true
      try { task?.abort?.() } catch { /* best-effort transport cancellation */ }
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)

    const lateCleanup = () => { void onLateSettle().catch(() => {}) }
    try {
      task = uni.uploadFile({
        ...options,
        success: (response: any) => {
          if (timedOut) { lateCleanup(); return }
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(response)
        },
        fail: (error: any) => {
          if (timedOut) { lateCleanup(); return }
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        },
      }) as unknown as { abort?: () => void }
    } catch (error) {
      settled = true
      clearTimeout(timer)
      reject(error)
    }
  })
}

/*
 * SWR cache for fetchMyItems(). profile/index.vue refetches my-listings on
 * every onShow; this serves the last result for MY_ITEMS_TTL when the user
 * just tab-switched. Any local mutation (create / update / status flip /
 * delete) and clearItems() invalidate it, so a freshly published or edited
 * listing shows immediately rather than after the TTL window.
 */
const MY_ITEMS_TTL = 30_000
let myItemsCache: { userId: string; at: number; data: Item[] } | null = null
function invalidateMyItems() {
  myItemsCache = null
}

function resetItemState() {
  // Public rows are still account-personalized by the current block set. An
  // A request that finishes after A -> B must not repopulate the singleton
  // with A's filtered snapshot or release B's loading/error state.
  latestRequestId += 1
  items.value = []
  loading.value = false
  hasMore.value = true
  fetchError.value = ''
  invalidateMyItems()
}

onAccountTransition(resetItemState)

export function useItems() {
  const { supabase } = useSupabase()
  const { t, lang } = useI18n()
  const moderation = useModeration()

  async function fetchItems(options: {
    page?: number
    category?: ItemCategory | null
    search?: string
    userId?: string
    priceMin?: number
    priceMax?: number
    condition?: ItemCondition | null
    sort?: string
    listingType?: 'sell' | 'wanted'
    location?: string
    verifiedOnly?: boolean
    reset?: boolean
  } = {}) {
    const { page = 0, category, search, userId, priceMin, priceMax, condition, sort, listingType, location, verifiedOnly, reset = false } = options
    const requestId = ++latestRequestId

    if (reset) {
      items.value = []
      hasMore.value = true
    }

    loading.value = true
    fetchError.value = ''
    try {
      if (getActiveAccountId()) {
        const gate = await moderation.ensureLoaded()
        if (requestId !== latestRequestId) return
        if (!gate.ok) throw new Error('moderation_gate_unavailable')
      }

      let data: any
      let error: any
      let searchHasMore: boolean | undefined

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
        const rpcRes = await searchItemsWithCompatibility(supabase, {
          terms: sanitized,
          category: category ?? null,
          condition: condition ?? null,
          priceMin: priceMin && priceMin > 0 ? priceMin : null,
          priceMax: priceMax && priceMax > 0 ? priceMax : null,
          userId: userId ?? null,
          // The compatibility layer retains the 9-argument production RPC
          // during rollout, while the current 11-argument RPC handles these
          // filters server-side once its schema cache is live.
          listingType: listingType ?? null,
          location: location?.trim() || null,
          verifiedOnly: verifiedOnly === true,
          page,
          pageSize: PAGE_SIZE,
        })
        if (requestId !== latestRequestId) return
        data = rpcRes.data
        searchHasMore = rpcRes.hasMore
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
        if (listingType) q = q.eq('listing_type', listingType)
        if (userId) q = q.eq('user_id', userId)
        if (priceMin !== undefined && priceMin > 0) q = q.gte('price', priceMin)
        if (priceMax !== undefined && priceMax > 0) q = q.lte('price', priceMax)
        if (condition) q = q.eq('condition', condition)
        // Filter location / verified-pickup server-side so pagination + hasMore
        // reflect the filtered set. Client-only filtering over a paginated feed
        // produced a premature "no results" while hasMore stayed true. (The
        // search-RPC path receives the same parameters in migration 085.)
        if (location) q = q.ilike('location', `%${location}%`)
        if (verifiedOnly) q = q.eq('location_verified', true)

        const res = await q
        if (requestId !== latestRequestId) return
        data = res.data
        error = res.error
      }

      if (error) throw error

      if (data) {
        const rows = (data as unknown as Item[]).map(sanitizeItemResources)
        const filtered = moderation.blockedIds.value.size > 0
          ? rows.filter(item => !moderation.blockedIds.value.has(item.user_id))
          : rows

        if (reset) {
          items.value = filtered
        } else {
          items.value.push(...filtered)
        }
        hasMore.value = searchHasMore ?? data.length === PAGE_SIZE
      }
    } catch (error: any) {
      if (requestId !== latestRequestId) return
      fetchError.value = friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('error.loadFailed')
      console.error('[items] fetch failed')
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
      }
    }
  }

  async function fetchItem(id: string, options: { incrementView?: boolean } = {}) {
    const viewOwnerId = getActiveAccountId()
    const viewAccountToken = viewOwnerId ? captureAccountRequest(viewOwnerId) : null
    const { data, error } = await supabase
      .from('items')
      .select(`${DETAIL_ITEM_FIELDS}, profile:profiles(${PUBLIC_PROFILE_FIELDS})` as any)
      .eq('id', id)
      .single()
    if (error) throw error

    if (options.incrementView !== false && viewAccountToken) {
      // Anonymous detail reads are public, but the hardened counter records one
      // view per authenticated account. Skip the entire session/RPC branch when
      // there was no active account at entry instead of issuing a denied call.
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (
          !session?.user
          || session.user.id !== viewAccountToken.userId
          || !isAccountRequestCurrent(viewAccountToken)
        ) return
        return supabase.rpc('increment_view_count', { item_id: id }).then(({ error: rpcError }) => {
          if (rpcError) console.warn('[items] view count increment failed')
        })
      }).catch((err) => {
        console.warn('[items] view count session check failed')
      })
    }

    return sanitizeItemResources(data as unknown as Item)
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
    listing_type?: 'sell' | 'wanted'
  }, options?: Pick<ItemMutationOptions, 'accountToken'>) {
    const entryUserId = getActiveAccountId()
    const accountToken = options?.accountToken
      || (entryUserId ? captureAccountRequest(entryUserId) : null)
    if (!accountToken || !isAccountRequestCurrent(accountToken)) throw new Error('Not authenticated')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    // An upload started under A may finish just before the UI signs in as B.
    // Never let createItem re-bind A's URLs to the newly-current account.
    assertAccountCurrent(accountToken, session.user.id)

    // Hard cap is 1M as anti-typo / anti-abuse defense in depth. The 100k
    // soft ceiling is enforced as a UI modal in pages/publish/index.vue
    // (gives user "are you sure?" affordance). 1M is far above any
    // legitimate campus listing — no one prices a textbook at $1M.
    if (!Number.isFinite(input.price) || input.price < 0 || input.price > 1_000_000) throw new Error('Invalid price')
    if (input.title.length > 200) throw new Error('Title too long')
    if (input.description.length > 2000) throw new Error('Description too long')
    if (input.images.length > MAX_IMAGES) throw new Error('Too many images')
    if (input.location.length > 80) throw new Error('Location too long')
    assertPublicMediaWrite(
      input.images,
      session.user.id,
      MAX_IMAGES,
      input.image_dimensions ?? [],
    )
    assertI18nWrite(input.title_i18n, 200, 800, 16_384)
    assertI18nWrite(input.description_i18n, 2000, 8000, 65_536)

    const titleCheck = checkContent(input.title, { kind: 'item_title' })
    if (!titleCheck.ok) throw new Error(`moderation_block:${titleCheck.category}:${titleCheck.reason || ''}`)
    if (input.description) {
      const descCheck = checkContent(input.description, { kind: 'item_desc' })
      if (!descCheck.ok) throw new Error(`moderation_block:${descCheck.category}:${descCheck.reason || ''}`)
    }
    const duplicateText = `${input.title}::${input.description}`
    if (isLocalDuplicate('item', duplicateText)) {
      throw new Error('duplicate_item')
    }
    let mutationStarted = false
    try {
      const ai = await remoteModerate(`${input.title}\n${input.description}`, accountToken)
      if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)
      /* mp store review: WeChat's own classifier (no-op on H5). */
      await mpTextGate(`${input.title}\n${input.description}`, 3, accountToken)
      assertAccountCurrent(accountToken, session.user.id)

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
      }
      if (input.image_dimensions && input.image_dimensions.length) {
        payload.image_dimensions = input.image_dimensions
      }
      if (input.title_i18n) payload.title_i18n = input.title_i18n
      if (input.description_i18n) payload.description_i18n = input.description_i18n
      if (input.source_lang) payload.source_lang = input.source_lang
      if (input.listing_type === 'wanted') payload.listing_type = 'wanted'

      mutationStarted = true
      // Keep the query inline for Supabase's generated result type; only the
      // thrown-vs-structured error distinction matters for commit certainty.
      let data: any
      let error: any
      try {
        const response = await supabase.from('items').insert(payload).select(DETAIL_ITEM_FIELDS as any).single()
        data = response.data
        error = response.error
      } catch (writeError) {
        throw mutationOutcomeError(writeError, 'unknown')
      }
      if (error) {
        throw mutationOutcomeError(
          error,
          isDefinitiveMutationRejection(error) ? 'not_committed' : 'unknown',
        )
      }
      if (!data) throw mutationOutcomeError(new Error('Item create result unavailable'), 'unknown')
      if (!isAccountRequestCurrent(accountToken)) {
        // The row is already committed for the original owner. Tell the caller
        // not to compensate its images, but do not show stale-account success.
        throw accountChangedError(true)
      }
      invalidateMyItems()
      return sanitizeItemResources(data as unknown as Item)
    } catch (error) {
      const tagged = mutationCommitState(error)
        ? error
        : mutationOutcomeError(error, mutationStarted ? 'unknown' : 'not_committed')
      // A stale completion can be a real committed insert for A. Keep the
      // duplicate hold in that case; only failed inserts should be retryable.
      if (shouldCompensateMutationFailure(tagged)) {
        clearLocalDuplicate('item', duplicateText)
      }
      throw tagged
    }
  }

  async function updateItem(
    id: string,
    updates: Partial<Pick<Item, 'title' | 'description' | 'price' | 'category' | 'condition' | 'location' | 'images' | 'image_dimensions' | 'title_i18n' | 'description_i18n' | 'source_lang' | 'negotiable'>>,
    options?: ItemMutationOptions,
  ) {
    const entryUserId = getActiveAccountId()
    const accountToken = options?.accountToken
      || (entryUserId ? captureAccountRequest(entryUserId) : null)
    if (!accountToken || !isAccountRequestCurrent(accountToken)) throw new Error('Not authenticated')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    assertAccountCurrent(accountToken, session.user.id)

    // Mirror the createItem hard cap. Without this guard, a user could create
    // a listing under the cap then edit it past — backend integrity hole.
    if (updates.price !== undefined && (!Number.isFinite(updates.price) || updates.price < 0 || updates.price > 1_000_000)) {
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
    if (updates.location !== undefined && updates.location.length > 80) {
      throw new Error('Location too long')
    }
    if (updates.images !== undefined) {
      assertPublicMediaWrite(
        updates.images,
        session.user.id,
        MAX_IMAGES,
        updates.image_dimensions ?? [],
      )
    } else if (updates.image_dimensions !== undefined) {
      throw new Error('invalid_image_dimensions')
    }
    assertI18nWrite(updates.title_i18n, 200, 800, 16_384)
    assertI18nWrite(updates.description_i18n, 2000, 8000, 65_536)

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
        const ai = await remoteModerate(aiInput, accountToken)
        if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)
        /* mp store review: WeChat's own classifier (no-op on H5). */
        await mpTextGate(aiInput, 3, accountToken)
      }
    }
    assertAccountCurrent(accountToken, session.user.id)

    let updateQuery = supabase
      .from('items')
      .update(updates)
      .eq('id', id)
      .eq('user_id', session.user.id)

    // The edit screen passes the version it originally loaded. This prevents
    // a stale second tab from overwriting a newer edit (or resurrecting an
    // image URL after the first tab has removed the corresponding object).
    if (options?.expectedUpdatedAt) {
      updateQuery = updateQuery.eq('updated_at', options.expectedUpdatedAt)
    }

    let data: any
    let error: any
    try {
      const response = await updateQuery
        .select(DETAIL_ITEM_FIELDS as any)
        .maybeSingle()
      data = response.data
      error = response.error
    } catch (writeError) {
      throw mutationOutcomeError(writeError, 'unknown')
    }
    if (error) {
      throw mutationOutcomeError(
        error,
        isDefinitiveMutationRejection(error) ? 'not_committed' : 'unknown',
      )
    }
    if (!data) {
      throw mutationOutcomeError(
        new Error(options?.expectedUpdatedAt ? 'item_edit_conflict' : 'Item not found'),
        'not_committed',
      )
    }
    if (!isAccountRequestCurrent(accountToken)) {
      // The edit reached Postgres under the original account. Skipping upload
      // compensation is mandatory or the now-referenced objects would break.
      throw accountChangedError(true)
    }
    invalidateMyItems()
    return sanitizeItemResources(data as unknown as Item)
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
  async function cleanupFailedUploadBatch(
    batchUrls: string[],
    accountToken: UploadAccountToken,
    telemetrySource: string,
  ): Promise<void> {
    if (batchUrls.length === 0) return
    try {
      await removeOwnedItemImages(batchUrls, {
        ownerUserId: accountToken.userId,
        telemetrySource,
      })
    } catch (cleanupError) {
      // removeOwnedItemImages already emits a structured orphan event. Keep a
      // second source-specific breadcrumb/error for the operation that failed.
      captureException(cleanupError, {
        tags: { source: telemetrySource, orphan_risk: 'true' },
        extra: { objectCount: batchUrls.length },
        level: 'warning',
      })
    }
  }

  async function uploadImagesWithDims(
    tempFiles: string[],
    options?: { entryPoint?: string; accountToken?: UploadAccountToken },
  ): Promise<UploadBatchResult> {
    if (tempFiles.length > MAX_IMAGES) throw new Error('Too many files')
    const urls: string[] = []
    const dims: Array<{ w: number; h: number }> = []

    const entryUserId = getActiveAccountId()
    const accountToken = options?.accountToken
      || (entryUserId ? captureAccountRequest(entryUserId) : null)
    if (!accountToken || !isAccountRequestCurrent(accountToken)) throw new Error('Not authenticated')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    assertAccountCurrent(accountToken, session.user.id)

    for (const filePath of tempFiles) {
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const storagePath = `items/${session.user.id}/${fileName}`
      const candidateUrl = supabase.storage.from('item-images').getPublicUrl(storagePath).data.publicUrl
      let uploadAttempted = false

      try {
        assertAccountCurrent(accountToken, session.user.id)
        const naturalDims = await getImageDimensions(filePath)
        assertAccountCurrent(accountToken, session.user.id)

        let uploadError: any = null

        // #ifdef H5
        const compressed = await compressImage(filePath, { entryPoint: options?.entryPoint })
        assertAccountCurrent(accountToken, session.user.id)
        const response = await fetch(compressed)
        const blob = await response.blob()
        if (blob.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
        const contentType = await detectImageMimeType(blob)
        assertAccountCurrent(accountToken, session.user.id)
        uploadAttempted = true
        const h5Result = await withUploadTimeout(
          supabase.storage.from('item-images').upload(storagePath, blob, { contentType }),
          IMAGE_UPLOAD_TIMEOUT_MS,
          'image upload',
          () => cleanupFailedUploadBatch(
            [candidateUrl],
            accountToken,
            'items.late_upload_candidate_cleanup',
          ),
        )
        uploadError = h5Result.error
        if (uploadError) {
          console.warn('[upload] H5 image upload failed')
        }
        // #endif

        // #ifndef H5
        const compressedPath = await compressImage(filePath, { entryPoint: options?.entryPoint })
        assertAccountCurrent(accountToken, session.user.id)
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
        assertAccountCurrent(accountToken, session.user.id)

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const uploadUrl = `${supabaseUrl}/storage/v1/object/item-images/${storagePath}`
        uploadAttempted = true
        try {
          const mpResult = await miniProgramUploadWithTimeout({
            url: uploadUrl,
            filePath: compressedPath,
            name: 'file',
            header: {
              Authorization: `Bearer ${session.access_token}`,
              'x-upsert': 'false',
            },
          }, IMAGE_UPLOAD_TIMEOUT_MS, 'image upload', () => cleanupFailedUploadBatch(
            [candidateUrl],
            accountToken,
            'items.late_upload_candidate_cleanup',
          ))
          if (mpResult.statusCode >= 200 && mpResult.statusCode < 300) {
            uploadError = null
          } else {
            console.warn('[upload] Mini Program image upload failed')
            uploadError = new Error(`Upload HTTP ${mpResult.statusCode}`)
          }
        } catch (error) {
          console.warn('[upload] Mini Program image upload failed')
          uploadError = error
        }
        // #endif

        if (!uploadError) {
          // The request can complete after sign-out/account switch. Record the
          // just-created URL before rejecting so compensation sees every object.
          assertAccountCurrent(accountToken, session.user.id)
          /* mp store review: do not expose the object until the async verdict
             handoff has been durably recorded (no-op on H5). */
          await mpImageCheck(storagePath, 'item-images', accountToken)
          assertAccountCurrent(accountToken, session.user.id)
          urls.push(candidateUrl)
          dims.push(naturalDims)
        } else {
          // A transport can report failure after Storage accepted the bytes.
          // No item/message references this candidate yet, so removal is safe.
          await cleanupFailedUploadBatch(
            [candidateUrl],
            accountToken,
            'items.failed_upload_candidate_cleanup',
          )
          assertAccountCurrent(accountToken, session.user.id)
          console.warn('[upload] Skipping an image after upload failure')
        }
      } catch (err) {
        if (isAccountChangedError(err) || (err as { heic?: unknown })?.heic === true) {
          // A later HEIC can fail after earlier files in the same selection
          // have already uploaded. The caller never receives those partial
          // URLs when we throw. Account-change failures use the same path; if
          // A's session is no longer available, cleanup fails closed and emits
          // an explicit orphan-risk event instead of attempting deletion as B.
          await cleanupFailedUploadBatch(
            uploadAttempted ? [...urls, candidateUrl] : urls,
            accountToken,
            isAccountChangedError(err)
              ? 'items.account_changed_upload_cleanup'
              : 'items.heic_batch_upload_cleanup',
          )
          throw err
        }
        if (uploadAttempted) {
          await cleanupFailedUploadBatch(
            [candidateUrl],
            accountToken,
            'items.failed_upload_candidate_cleanup',
          )
        }
        console.warn('[upload] Skipping an image after processing failure')
      }
    }

    try {
      assertAccountCurrent(accountToken, session.user.id)
    } catch (error) {
      await cleanupFailedUploadBatch(urls, accountToken, 'items.account_changed_upload_cleanup')
      throw error
    }

    return { urls, dims, accountToken }
  }

  async function uploadImages(
    tempFiles: string[],
    options?: { entryPoint?: string; accountToken?: UploadAccountToken },
  ): Promise<{ urls: string[]; accountToken: UploadAccountToken }> {
    const { urls, accountToken } = await uploadImagesWithDims(tempFiles, options)
    return { urls, accountToken }
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
    options?: { entryPoint?: string; accountToken?: UploadAccountToken },
  ): Promise<{
    url: string
    dims: { w: number; h: number }
    accountToken: UploadAccountToken
  }> {
    const entryUserId = getActiveAccountId()
    const accountToken = options?.accountToken
      || (entryUserId ? captureAccountRequest(entryUserId) : null)
    if (!accountToken || !isAccountRequestCurrent(accountToken)) throw new Error('Not authenticated')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    assertAccountCurrent(accountToken, session.user.id)

    const entryPoint = options?.entryPoint || 'chat'
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
    const storagePath = `items/${session.user.id}/${fileName}`
    const candidateUrl = supabase.storage.from('item-images').getPublicUrl(storagePath).data.publicUrl

    const naturalDims = await getImageDimensions(tempFile)
    assertAccountCurrent(accountToken, session.user.id)

    // #ifdef H5
    const compressed = await compressImage(tempFile, { entryPoint })
    assertAccountCurrent(accountToken, session.user.id)
    const response = await fetch(compressed)
    const blob = await response.blob()
    if (blob.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
    const contentType = await detectImageMimeType(blob)
    assertAccountCurrent(accountToken, session.user.id)
    let h5Err: any
    try {
      const result = await withUploadTimeout(
        supabase.storage.from('item-images').upload(storagePath, blob, { contentType }),
        IMAGE_UPLOAD_TIMEOUT_MS,
        'image upload',
        () => cleanupFailedUploadBatch(
          [candidateUrl],
          accountToken,
          'items.late_upload_candidate_cleanup',
        ),
      )
      h5Err = result.error
    } catch (uploadError) {
      await cleanupFailedUploadBatch(
        [candidateUrl],
        accountToken,
        'items.single_image_upload_unknown_cleanup',
      )
      throw uploadError
    }
    if (h5Err) {
      await cleanupFailedUploadBatch(
        [candidateUrl],
        accountToken,
        'items.single_image_upload_rejected_cleanup',
      )
      console.warn('[upload] H5 image upload failed')
      throw new Error(`Storage upload failed: ${h5Err.message || 'unknown'}`)
    }
    // #endif

    // #ifndef H5
    const compressedPath = await compressImage(tempFile, { entryPoint })
    assertAccountCurrent(accountToken, session.user.id)
    const fileInfo = await new Promise<{ size: number } | null>((resolve) => {
      uni.getFileInfo({
        filePath: compressedPath,
        success: (info: any) => resolve({ size: info.size }),
        fail: () => resolve(null),
      })
    })
    if (fileInfo && fileInfo.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
    assertAccountCurrent(accountToken, session.user.id)
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const uploadUrl = `${supabaseUrl}/storage/v1/object/item-images/${storagePath}`
    try {
      const result = await miniProgramUploadWithTimeout({
          url: uploadUrl,
          filePath: compressedPath,
          name: 'file',
          header: {
            Authorization: `Bearer ${session.access_token}`,
            'x-upsert': 'false',
          },
      }, IMAGE_UPLOAD_TIMEOUT_MS, 'image upload', () => cleanupFailedUploadBatch(
        [candidateUrl],
        accountToken,
        'items.late_upload_candidate_cleanup',
      ))
      if (result.statusCode < 200 || result.statusCode >= 300) {
        console.warn('[upload] Mini Program image upload failed')
        throw new Error(`Storage upload failed: HTTP ${result.statusCode}`)
      }
    } catch (uploadError) {
      await cleanupFailedUploadBatch(
        [candidateUrl],
        accountToken,
        'items.single_image_upload_unknown_cleanup',
      )
      throw uploadError
    }
    // #endif

    if (!candidateUrl) {
      throw new Error('Storage upload succeeded but public URL resolution failed')
    }
    try {
      assertAccountCurrent(accountToken, session.user.id)
    } catch (error) {
      await cleanupFailedUploadBatch(
        [candidateUrl],
        accountToken,
        'items.account_changed_single_image_cleanup',
      )
      throw error
    }
    /* mp store review: a mapping failure leaves the object unreferenced, so
       remove it instead of publishing an image that cannot receive a verdict. */
    try {
      await mpImageCheck(storagePath, 'item-images', accountToken)
      assertAccountCurrent(accountToken, session.user.id)
    } catch (error) {
      await cleanupFailedUploadBatch(
        [candidateUrl],
        accountToken,
        'items.wechat_media_handoff_cleanup',
      )
      throw error
    }
    return { url: candidateUrl, dims: naturalDims, accountToken }
  }

  async function fetchMyItems(
    userId: string,
    opts: { force?: boolean; accountToken?: AccountRequestToken } = {},
  ): Promise<Item[]> {
    const accountToken = opts.accountToken || captureAccountRequest(userId)
    if (accountToken.userId !== userId || !isAccountRequestCurrent(accountToken)) return []
    if (
      !opts.force &&
      myItemsCache &&
      myItemsCache.userId === userId &&
      Date.now() - myItemsCache.at < MY_ITEMS_TTL
    ) {
      return myItemsCache.data
    }
    const { data, error } = await supabase
      .from('items')
      .select(DETAIL_ITEM_FIELDS as any)
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false })
    if (error) {
      if (!isAccountRequestCurrent(accountToken)) return []
      throw error
    }
    if (!isAccountRequestCurrent(accountToken)) return []
    const result = ((data || []) as unknown as Item[]).map(sanitizeItemResources)
    myItemsCache = { userId, at: Date.now(), data: result }
    return result
  }

  async function updateItemStatus(id: string, status: ItemStatus) {
    if (!VALID_STATUSES.includes(status)) throw new Error('Invalid status')
    if (status === 'sold') throw new Error('mark_item_sold_rpc_required')

    const entryUserId = getActiveAccountId()
    if (!entryUserId) throw new Error('Not authenticated')
    const accountToken = captureAccountRequest(entryUserId)
    if (!isAccountRequestCurrent(accountToken)) throw accountChangedError()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    assertAccountCurrent(accountToken, session.user.id)

    const { error } = await supabase
      .from('items')
      .update({ status })
      .eq('id', id)
      .eq('user_id', accountToken.userId)

    if (!isAccountRequestCurrent(accountToken)) throw accountChangedError(!error)
    if (error) throw error
    invalidateMyItems()
  }

  async function fetchItemSaleCandidates(
    id: string,
    opts: { accountToken?: AccountRequestToken } = {},
  ): Promise<ItemSaleCandidate[]> {
    const entryUserId = getActiveAccountId()
    if (!entryUserId) throw new Error('Not authenticated')
    const accountToken = opts.accountToken || captureAccountRequest(entryUserId)
    if (accountToken.userId !== entryUserId || !isAccountRequestCurrent(accountToken)) {
      throw accountChangedError()
    }
    const { data, error } = await supabase.rpc('get_item_sale_candidates', {
      p_item_id: id,
      expected_user_id_in: accountToken.userId,
    })
    if (!isAccountRequestCurrent(accountToken)) throw accountChangedError()
    if (error) throw error
    return (Array.isArray(data) ? data : []) as ItemSaleCandidate[]
  }

  async function markItemSold(
    id: string,
    offerId: string,
    opts: { accountToken?: AccountRequestToken } = {},
  ): Promise<Item> {
    const entryUserId = getActiveAccountId()
    if (!entryUserId) throw new Error('Not authenticated')
    const accountToken = opts.accountToken || captureAccountRequest(entryUserId)
    if (accountToken.userId !== entryUserId || !isAccountRequestCurrent(accountToken)) {
      throw accountChangedError()
    }
    const { data, error } = await supabase.rpc('mark_item_sold', {
      p_item_id: id,
      p_offer_id: offerId,
      expected_user_id_in: accountToken.userId,
    })
    if (!isAccountRequestCurrent(accountToken)) throw accountChangedError(!error)
    if (error) throw error
    items.value = items.value.filter(item => item.id !== id)
    invalidateMyItems()
    return data as Item
  }

  async function removeOwnedItemImages(
    urls: string[],
    options?: OwnedImageCleanupOptions,
  ): Promise<void> {
    if (urls.length === 0) return
    const { data: { session } } = await supabase.auth.getSession()
    const ownerUserId = options?.ownerUserId || session?.user?.id || ''
    const telemetrySource = options?.telemetrySource || 'items.owned_media_cleanup'
    if (!session?.user) {
      const error = new Error('Owned media cleanup requires the original authenticated session')
      captureException(error, {
        tags: { source: telemetrySource, orphan_risk: 'true', reason: 'no_session' },
        extra: { objectCount: urls.length },
        level: 'warning',
      })
      throw error
    }

    // Fail closed unless the URL belongs to this exact Supabase project.
    // Matching only the Storage pathname would let an attacker-controlled
    // origin smuggle a deletion path into cleanup logic.
    const paths = ownedItemImagePaths(
      urls,
      ownerUserId,
      import.meta.env.VITE_SUPABASE_URL || '',
    )
    if (paths.length === 0) {
      if (options?.ownerUserId) {
        const error = new Error('Owned media cleanup rejected every supplied object path')
        captureException(error, {
          tags: { source: telemetrySource, orphan_risk: 'true', reason: 'path_rejected' },
          extra: { objectCount: urls.length },
          level: 'warning',
        })
        throw error
      }
      return
    }
    if (session.user.id !== ownerUserId) {
      // A cleanup for A must never be reinterpreted as a cleanup for B. RLS is
      // the server backstop; this local check avoids even issuing the request.
      const error = new Error('Owned media cleanup session no longer matches the upload owner')
      captureException(error, {
        tags: { source: telemetrySource, orphan_risk: 'true', reason: 'session_mismatch' },
        extra: {
          objectCount: paths.length,
          activeAccountMatchesOwner: getActiveAccountId() === ownerUserId,
        },
        level: 'warning',
      })
      throw error
    }
    const { error } = await supabase.storage.from('item-images').remove(paths)
    if (error) {
      captureException(error, {
        tags: { source: telemetrySource, orphan_risk: 'true', reason: 'storage_remove_failed' },
        extra: { objectCount: paths.length },
        level: 'warning',
      })
      throw error
    }
  }

  async function deleteItem(id: string) {
    const entryUserId = getActiveAccountId()
    if (!entryUserId) throw new Error('Not authenticated')
    const accountToken = captureAccountRequest(entryUserId)
    if (!isAccountRequestCurrent(accountToken)) throw accountChangedError()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) throw new Error('Not authenticated')
    assertAccountCurrent(accountToken, session.user.id)

    // Delete the authoritative row first and return the exact deleted version's
    // media in the same statement. A separate SELECT introduced a TOCTOU race:
    // another tab could replace images between SELECT and DELETE, leaving the
    // newly committed objects orphaned. Storage and Postgres still cannot share
    // a transaction, so physical cleanup remains best-effort after DB success.
    const { data: deleted, error } = await supabase
      .from('items')
      .delete()
      .eq('id', id)
      .eq('user_id', accountToken.userId)
      .select('id, images')
      .maybeSingle()

    if (error) {
      if (!isAccountRequestCurrent(accountToken)) throw accountChangedError()
      throw error
    }
    if (!deleted) {
      if (!isAccountRequestCurrent(accountToken)) throw accountChangedError()
      throw new Error('Item not found or deletion not permitted')
    }

    try {
      await removeOwnedItemImages(Array.isArray(deleted.images) ? deleted.images : [], {
        ownerUserId: accountToken.userId,
        telemetrySource: 'items.delete_cleanup',
      })
    } catch (cleanupError) {
      // The listing is already gone, so reporting the whole delete as failed
      // would invite a confusing retry against a missing row. Keep this
      // observable for Sentry/console and let a storage-GC job retry later.
      console.warn('[items] listing deleted but image cleanup failed')
      captureException(cleanupError, { tags: { source: 'items.delete_image_cleanup' }, level: 'warning' })
    }

    if (!isAccountRequestCurrent(accountToken)) throw accountChangedError(true)
    items.value = items.value.filter(i => i.id !== id)
    invalidateMyItems()
  }

  function clearItems() {
    resetItemState()
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
    fetchItemSaleCandidates,
    markItemSold,
    uploadImages,
    uploadImagesWithDims,
    uploadOneImage,
    fetchMyItems,
    deleteItem,
    removeOwnedItemImages,
    clearItems,
  }
}
