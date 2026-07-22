import type { SupabaseClient } from '@supabase/supabase-js'
import type { Item, ItemCategory, ItemCondition } from '../types'

const LEGACY_SCAN_BATCH_SIZE = 100
const LEGACY_SCAN_MAX_ROWS = 1000

export const SEARCH_SCHEMA_UNAVAILABLE = 'SEARCH_SCHEMA_UNAVAILABLE'
export const SEARCH_LEGACY_FILTER_LIMIT = 'SEARCH_LEGACY_FILTER_LIMIT'

type SearchCompatibilityErrorCode =
  | typeof SEARCH_SCHEMA_UNAVAILABLE
  | typeof SEARCH_LEGACY_FILTER_LIMIT

export interface SearchItemsParams {
  terms: string[]
  category?: ItemCategory | null
  condition?: ItemCondition | null
  priceMin?: number | null
  priceMax?: number | null
  userId?: string | null
  listingType?: 'sell' | 'wanted' | null
  location?: string | null
  verifiedOnly?: boolean
  page: number
  pageSize: number
}

export interface SearchItemsResult {
  data: Item[]
  hasMore: boolean
  backend: 'current' | 'legacy'
}

interface PostgrestLikeError {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

function compatibilityError(code: SearchCompatibilityErrorCode): Error & { code: SearchCompatibilityErrorCode } {
  const error = new Error(code) as Error & { code: SearchCompatibilityErrorCode }
  error.name = 'SearchItemsCompatibilityError'
  error.code = code
  return error
}

/**
 * PGRST202 is PostgREST's explicit "stale/missing function signature in the
 * schema cache" error. Do not fall back on message text, HTTP status, or a
 * generic RPC failure: those can represent permission, network, or SQL bugs
 * that must remain visible to callers.
 */
export function isMissingSearchSignature(error: unknown): boolean {
  return (error as PostgrestLikeError | null)?.code === 'PGRST202'
}

function sanitizeSearchError(error: unknown): unknown {
  const value = error as PostgrestLikeError | null
  const signatureText = [value?.message, value?.details, value?.hint]
    .filter(part => typeof part === 'string')
    .join(' ')
    .toLocaleLowerCase()

  // PGRST203 is an ambiguous overloaded-function signature. It must not
  // trigger the legacy retry (guessing an overload could change semantics),
  // but its candidate-signature details are still unsafe to show in the UI.
  if (
    value?.code === 'PGRST202'
    || value?.code === 'PGRST203'
    || signatureText.includes('search_items_fuzzy(')
  ) {
    return compatibilityError(SEARCH_SCHEMA_UNAVAILABLE)
  }
  return error
}

function normalizeRows(data: unknown): Item[] {
  return Array.isArray(data) ? data as Item[] : []
}

function matchesLegacyOnlyFilters(item: Item, location: string, verifiedOnly: boolean): boolean {
  if (verifiedOnly && item.location_verified !== true) return false
  if (!location) return true

  const itemLocation = typeof item.location === 'string' ? item.location : ''
  return itemLocation.toLocaleLowerCase().includes(location.toLocaleLowerCase())
}

function commonLegacyArgs(params: SearchItemsParams) {
  return {
    terms_in: params.terms,
    category_in: params.category ?? null,
    condition_in: params.condition ?? null,
    price_min_in: params.priceMin ?? null,
    price_max_in: params.priceMax ?? null,
    user_id_in: params.userId ?? null,
    listing_type_in: params.listingType ?? null,
  }
}

async function callLegacySearch(
  supabase: SupabaseClient,
  params: SearchItemsParams,
  limit: number,
  offset: number,
): Promise<Item[]> {
  const { data, error } = await supabase.rpc('search_items_fuzzy', {
    ...commonLegacyArgs(params),
    limit_in: limit,
    offset_in: offset,
  })

  // If neither deployed signature is visible, replace the database signature
  // text with a stable application code before it can reach the UI/log stream.
  if (error) throw sanitizeSearchError(error)
  return normalizeRows(data)
}

async function searchLegacyWithClientFilters(
  supabase: SupabaseClient,
  params: SearchItemsParams,
  location: string,
  verifiedOnly: boolean,
): Promise<SearchItemsResult> {
  const page = Math.max(0, Math.floor(params.page))
  const pageSize = Math.max(1, Math.floor(params.pageSize))
  const pageStart = page * pageSize
  // One additional match lets us determine hasMore without lying about a
  // partially filtered legacy page.
  const matchesNeeded = pageStart + pageSize + 1

  if (matchesNeeded > LEGACY_SCAN_MAX_ROWS) {
    throw compatibilityError(SEARCH_LEGACY_FILTER_LIMIT)
  }

  const matches: Item[] = []
  let rawOffset = 0
  let exhausted = false

  while (rawOffset < LEGACY_SCAN_MAX_ROWS && matches.length < matchesNeeded) {
    const batchLimit = Math.min(LEGACY_SCAN_BATCH_SIZE, LEGACY_SCAN_MAX_ROWS - rawOffset)
    const rows = await callLegacySearch(supabase, params, batchLimit, rawOffset)

    matches.push(...rows.filter(item => matchesLegacyOnlyFilters(item, location, verifiedOnly)))
    rawOffset += rows.length
    exhausted = rows.length < batchLimit
    if (exhausted) break
  }

  // Reaching the scan ceiling without either finding the next page or proving
  // exhaustion would make an empty/short page ambiguous. Fail recognizably so
  // callers can ask the user to retry after the backend rollout instead.
  if (!exhausted && matches.length < matchesNeeded) {
    throw compatibilityError(SEARCH_LEGACY_FILTER_LIMIT)
  }

  const pageEnd = pageStart + pageSize
  return {
    data: matches.slice(pageStart, pageEnd),
    hasMore: matches.length > pageEnd,
    backend: 'legacy',
  }
}

/**
 * Prefer the current 11-argument search RPC. During a rolling deployment only,
 * a PGRST202 response retries the previous 9-argument signature. Location and
 * verified-location filters (not expressible by that signature) are applied
 * client-side across ranked legacy pages so pagination remains correct.
 */
export async function searchItemsWithCompatibility(
  supabase: SupabaseClient,
  params: SearchItemsParams,
): Promise<SearchItemsResult> {
  const page = Math.max(0, Math.floor(params.page))
  const pageSize = Math.max(1, Math.floor(params.pageSize))
  const location = params.location?.trim() || ''
  const verifiedOnly = params.verifiedOnly === true

  const currentResult = await supabase.rpc('search_items_fuzzy', {
    ...commonLegacyArgs(params),
    limit_in: pageSize,
    offset_in: page * pageSize,
    location_in: location || null,
    verified_only_in: verifiedOnly,
  })

  if (!currentResult.error) {
    const data = normalizeRows(currentResult.data)
    return {
      data,
      hasMore: data.length === pageSize,
      backend: 'current',
    }
  }

  if (!isMissingSearchSignature(currentResult.error)) {
    throw sanitizeSearchError(currentResult.error)
  }

  if (location || verifiedOnly) {
    return searchLegacyWithClientFilters(supabase, params, location, verifiedOnly)
  }

  const data = await callLegacySearch(supabase, params, pageSize, page * pageSize)
  return {
    data,
    hasMore: data.length === pageSize,
    backend: 'legacy',
  }
}
