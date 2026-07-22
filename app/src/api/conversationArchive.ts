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
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('conversation_archives')
    .select('conversation_id')
    .eq('user_id', userId)

  if (error) {
    if (isConversationArchiveSchemaMissing(error)) return new Set()
    throw error
  }

  return new Set<string>((data || []).map((row: any) => row.conversation_id))
}
