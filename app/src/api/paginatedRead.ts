export const ASCENDING_KEYSET_PAGE_SIZE = 500

interface PageResult<T> {
  data: T[] | null
  error: any
}

interface ReadAllAscendingKeysetOptions<T> {
  fetchPage: (
    afterKey: string | null,
    requestedRows: number,
  ) => PromiseLike<PageResult<T>>
  keyOf: (row: T) => unknown
  isOwnerCurrent: () => boolean
  pageSize?: number
}

/**
 * Read a complete PostgREST collection without trusting the returned page
 * length. Hosted `max_rows` may clamp a requested page below `pageSize`, so a
 * short non-empty page is not proof of exhaustion. Only an empty page ends the
 * scan.
 *
 * `null` means the request/account owner changed while the scan was in flight.
 * No partial rows escape in that case.
 */
export async function readAllAscendingKeyset<T>(
  options: ReadAllAscendingKeysetOptions<T>,
): Promise<T[] | null> {
  const requestedRows = options.pageSize ?? ASCENDING_KEYSET_PAGE_SIZE
  if (!Number.isSafeInteger(requestedRows) || requestedRows <= 0) {
    throw new Error('paginated_read_invalid_page_size')
  }

  const rows: T[] = []
  let afterKey: string | null = null

  while (true) {
    if (!options.isOwnerCurrent()) return null

    const result = await options.fetchPage(afterKey, requestedRows)
    if (!options.isOwnerCurrent()) return null
    if (!result || result.error) throw result?.error || new Error('paginated_read_malformed_result')
    if (!Array.isArray(result.data)) throw new Error('paginated_read_malformed_rows')
    if (result.data.length > requestedRows) {
      throw new Error('paginated_read_page_too_large')
    }
    if (result.data.length === 0) return rows

    let previousKey: string | null = afterKey
    for (const row of result.data) {
      const rawKey = options.keyOf(row)
      if (typeof rawKey !== 'string' || rawKey.length === 0) {
        throw new Error('paginated_read_invalid_key')
      }
      if (previousKey !== null && rawKey <= previousKey) {
        throw new Error('paginated_read_non_progress')
      }
      previousKey = rawKey
    }

    rows.push(...result.data)
    afterKey = previousKey
  }
}
