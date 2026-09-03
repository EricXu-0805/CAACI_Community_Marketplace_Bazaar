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
  | 'rating'
  | 'follow'
  | 'post_comment'
  | 'post_like'

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

/*
 * notifications.body has been a server-owned key rather than copy since
 * migrations 016/017 ('new_listing_from_followee', 'saved_search_match'). The
 * activity triggers in 20260903070000 extend that to '<key>:<uuid>' for the
 * events whose tap target is a post or a person — neither fits item_id (FK to
 * items) nor conversation_id. Only that exact shape parses, so a body that is
 * real copy, such as a meetup's 'Illini Union · 3/5 14:30 CT', comes back
 * whole.
 */
export function notificationBodyKey(body: string): { key: string; target: string | null } {
  const match = /^([a-z_]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(body || '')
  if (match) return { key: match[1], target: match[2] }
  return { key: body || '', target: null }
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
  const { key, target } = notificationBodyKey(notification.body)
  if (target) {
    if (key === 'new_follower') {
      return { url: `/pages/seller/index?id=${encodeURIComponent(target)}` }
    }
    if (key === 'post_comment' || key === 'post_like' || key === 'post_comment_like') {
      return { url: `/pages/post/index?id=${encodeURIComponent(target)}` }
    }
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
    case 'rating': return 'shield'
    case 'follow': return 'user-plus'
    case 'post_comment': return 'chat-bubble'
    case 'post_like': return 'heart'
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
    case 'rating': return 'notif.rating'
    case 'follow': return 'notif.follow'
    case 'post_comment': return 'notif.comment'
    case 'post_like': return 'notif.like'
    default: return 'notif.system'
  }
}

export function notificationToastKind(
  type: NotificationType,
): 'offer' | 'meetup' | 'sold' | 'price_drop' | 'system' | 'message' {
  switch (type) {
    case 'unread_message': return 'message'
    case 'offer':
    case 'meetup':
    case 'sold':
    case 'price_drop': return type
    default: return 'system'
  }
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
