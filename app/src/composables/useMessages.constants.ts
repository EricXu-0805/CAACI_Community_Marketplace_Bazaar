/*
 * Extracted to break an import cycle. useMessages.ts imports the
 * realtime subscription helpers from useRealtimeFallback.ts, and
 * useRealtimeFallback needs the SELECT column list for its
 * direct-PostgREST polling fallback. When both lived in useMessages,
 * Vite's chunker flagged the pair every build. Keeping the lean
 * constant in a third file they can both import from resolves the
 * cycle without behavior change.
 *
 * Re-exported from useMessages.ts below so existing callers keep
 * importing { MESSAGE_FIELDS } from './useMessages' unchanged.
 */
export const MESSAGE_FIELDS =
  'id, conversation_id, sender_id, content, message_type, is_read, created_at' as const
