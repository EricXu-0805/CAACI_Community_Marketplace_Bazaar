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

/*
 * A trigger writes a fixed title as one bilingual string —
 * '报价被接受 · Offer accepted' — so both readers read both languages.
 * The row cannot be composed in the reader's language where it is written: a
 * trigger fires for whoever is on the other end of the event and does not know
 * what language they read. The screen resolves it, the same reason the body
 * sentinels above are keys rather than sentences.
 *
 * Rows already in production carry the literal, so the literal is what is
 * looked up; writers added after 20260903090000 send a sentinel key instead
 * and land in the same table. A title that is user content — notify_item_sold
 * (065) writes the item's own title — matches nothing and is rendered as
 * written.
 */
export const NOTIFICATION_TITLE_KEYS: Record<string, string> = {
  // 051 / 20260717141822 — offers
  '新报价 · New offer': 'notif.titleNewOffer',
  '报价被接受 · Offer accepted': 'notif.titleOfferAccepted',
  '报价被拒绝 · Offer declined': 'notif.titleOfferDeclined',
  '收到还价 · Counter-offer': 'notif.titleCounterOffer',
  // 052 / 061 / 063 / 085 / 20260718250000 — meetups
  '见面提议 · Meetup proposed': 'notif.titleMeetupProposed',
  '约定已确认 · Meetup confirmed': 'notif.titleMeetupConfirmed',
  '约定被婉拒 · Meetup declined': 'notif.titleMeetupDeclined',
  '新的见面提议 · Meetup updated': 'notif.titleMeetupUpdated',
  '改约请求 · Meetup change requested': 'notif.titleMeetupChangeRequested',
  // 20260718260000 — nightly reminders
  '见面提醒 · Meetup reminder': 'notif.titleMeetupReminder',
  '未读消息 · Unread messages': 'notif.titleUnreadMessages',
  // 076 / 20260720035037 — enforcement
  '收到一次警告 · You received a warning': 'notif.titleWarningReceived',
  '账号已被限制 · Your account was restricted': 'notif.titleAccountRestricted',
  '一项处置已解除 · One action was lifted': 'notif.titleActionLifted',
  '账号限制已解除 · Your restriction was lifted': 'notif.titleRestrictionLifted',
  // 20260903070000 — activity
  '收到新评价 · New rating': 'notif.titleNewRating',
  '有人关注了你 · New follower': 'notif.titleNewFollower',
  '收到新评论 · New comment': 'notif.titleNewComment',
  '收到新点赞 · New like': 'notif.titleNewLike',
  '你的评论收到点赞 · Comment liked': 'notif.titleCommentLiked',
  '卖家已标记售出 · Marked sold': 'notif.titleMarkedSold',
  // 20260903090000 — moderation outcomes, written as sentinels
  report_resolved: 'notif.titleReportResolved',
  report_dismissed: 'notif.titleReportDismissed',
  appeal_denied: 'notif.titleAppealDenied',
}

export function notificationTitleText(
  notification: Notification,
  translate: (key: string) => string,
): string {
  const messageKey = NOTIFICATION_TITLE_KEYS[notification.title]
  return messageKey ? translate(messageKey) : notification.title
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
