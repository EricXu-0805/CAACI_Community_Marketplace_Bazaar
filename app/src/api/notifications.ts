export const NOTIFICATION_FIELDS_WITH_CONVERSATION =
  'id, user_id, type, title, body, item_id, conversation_id, is_read, created_at'

export const NOTIFICATION_FIELDS_LEGACY =
  'id, user_id, type, title, body, item_id, is_read, created_at'

export type NotificationType =
  | 'price_drop'
  | 'system'
  | 'sold'
  | 'offer'
  | 'meetup'
  | 'unread_message'

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  item_id: string | null
  /** Forward-compatible payload; legacy rows do not have this column yet. */
  conversation_id?: string | null
  is_read: boolean
  created_at: string
}

export function notificationDestination(notification: Notification): {
  url: string
  switchTab?: boolean
} {
  // Digest-generated unread-message reminders intentionally aggregate several
  // conversations and legacy production rows have no conversation_id. The
  // inbox is therefore the only destination that is always correct.
  if (notification.type === 'unread_message') {
    return { url: '/pages/messages/index', switchTab: true }
  }
  if (notification.conversation_id) {
    return { url: `/pages/chat/index?id=${encodeURIComponent(notification.conversation_id)}` }
  }
  // Legacy offer/meetup rows only carry item_id, which is insufficient to
  // identify one conversation. Open the inbox rather than misrouting an
  // actionable notification to the item-detail page.
  if (notification.type === 'offer' || notification.type === 'meetup') {
    return { url: '/pages/messages/index', switchTab: true }
  }
  if (notification.item_id) {
    return { url: `/pages/detail/index?id=${encodeURIComponent(notification.item_id)}` }
  }
  return { url: '/pages/notifications/index' }
}

export function notificationIcon(type: NotificationType): string {
  switch (type) {
    case 'price_drop': return 'tag'
    case 'sold': return 'check'
    case 'offer': return 'tag'
    case 'meetup': return 'location-pin'
    case 'unread_message': return 'messages'
    default: return 'bell'
  }
}

export function notificationTypeLabelKey(type: NotificationType): string {
  switch (type) {
    case 'price_drop': return 'notif.priceDrop'
    case 'sold': return 'notif.itemSold'
    case 'offer': return 'notif.offer'
    case 'meetup': return 'notif.meetup'
    case 'unread_message': return 'nav.messages'
    default: return 'notif.system'
  }
}

export function notificationToastKind(
  type: NotificationType,
): 'offer' | 'meetup' | 'sold' | 'price_drop' | 'system' | 'message' {
  return type === 'unread_message' ? 'message' : type
}

interface PostgrestLikeError {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

export interface NotificationListQueryResult {
  data: unknown
  error: unknown | null
}

export type NotificationListQuery = (
  fields: string,
) => PromiseLike<NotificationListQueryResult>

export type ConversationCompatibleNotification<Row extends object> =
  Omit<Row, 'conversation_id'> & { conversation_id: string | null }

/**
 * Postgres 42703 is `undefined_column`; PostgREST PGRST204 is its explicit
 * schema-cache/columns equivalent. Restrict the retry to those stable codes
 * and to this exact rollout column so permission, network, table, or other
 * schema failures remain visible to the caller.
 */
export function isConversationIdColumnUnavailable(error: unknown): boolean {
  const value = error as PostgrestLikeError | null
  if (value?.code !== '42703' && value?.code !== 'PGRST204') return false

  const diagnosticText = [value.message, value.details, value.hint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')

  return /(^|[^a-z0-9_])conversation_id([^a-z0-9_]|$)/i.test(diagnosticText)
}

function normalizeCurrentRows<Row extends object>(
  data: unknown,
): Array<ConversationCompatibleNotification<Row>> {
  if (!Array.isArray(data)) return []
  return (data as Row[]).map((row) => {
    const conversationId = (row as { conversation_id?: unknown }).conversation_id
    return {
      ...row,
      conversation_id: typeof conversationId === 'string' ? conversationId : null,
    } as ConversationCompatibleNotification<Row>
  })
}

function normalizeLegacyRows<Row extends object>(
  data: unknown,
): Array<ConversationCompatibleNotification<Row>> {
  if (!Array.isArray(data)) return []
  return (data as Row[]).map(row => ({
    ...row,
    conversation_id: null,
  } as ConversationCompatibleNotification<Row>))
}

/**
 * Prefer the deployed notification shape. During the migration rollout only,
 * retry the legacy projection when PostgREST explicitly reports that
 * `conversation_id` is unavailable. The caller owns user filtering/order so
 * both attempts are scoped identically.
 */
export async function fetchNotificationRowsWithCompatibility<Row extends object>(
  query: NotificationListQuery,
): Promise<Array<ConversationCompatibleNotification<Row>>> {
  const currentResult = await query(NOTIFICATION_FIELDS_WITH_CONVERSATION)
  if (!currentResult.error) return normalizeCurrentRows(currentResult.data)
  if (!isConversationIdColumnUnavailable(currentResult.error)) throw currentResult.error

  const legacyResult = await query(NOTIFICATION_FIELDS_LEGACY)
  if (legacyResult.error) throw legacyResult.error
  return normalizeLegacyRows(legacyResult.data)
}
