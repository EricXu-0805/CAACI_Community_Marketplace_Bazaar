import { readAllAscendingKeyset } from './paginatedRead'

type SupabaseLike = {
  from: (relation: string) => any
}

/**
 * During a rolling migration the archive relation may not exist yet. Only
 * that exact schema-cache/table absence is compatible with an empty archive;
 * network, authorization, and unrelated query failures must still surface.
 */
export function isConversationArchiveSchemaMissing(error: any): boolean {
  if (!error) return false
  const code = String(error.code || '').toUpperCase()
  const detail = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  // PGRST204 means a requested *column* is missing. Treating that as a
  // pre-migration table absence would hide a partially deployed or malformed
  // conversation_archives table and silently expose archived threads again.
  return ['42P01', 'PGRST205'].includes(code)
    && detail.includes('conversation_archives')
}

export async function fetchArchivedConversationIds(
  supabase: SupabaseLike,
  userId: string,
  options: { isOwnerCurrent?: () => boolean } = {},
): Promise<Set<string> | null> {
  try {
    const rows = await readAllAscendingKeyset<any>({
      isOwnerCurrent: options.isOwnerCurrent || (() => true),
      keyOf: row => row?.conversation_id,
      fetchPage: (afterConversationId, requestedRows) => {
        let query = supabase
          .from('conversation_archives')
          .select('conversation_id')
          .eq('user_id', userId)
        if (afterConversationId) {
          query = query.gt('conversation_id', afterConversationId)
        }
        return query
          .order('conversation_id', { ascending: true })
          .limit(requestedRows)
      },
    })
    if (rows === null) return null
    return new Set<string>(rows.map(row => row.conversation_id))
  } catch (error: any) {
    if (isConversationArchiveSchemaMissing(error)) return new Set()
    throw error
  }
}
