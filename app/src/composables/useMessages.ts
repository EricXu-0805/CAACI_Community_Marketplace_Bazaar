import { ref } from 'vue'
import { useSupabase } from './useSupabase'
import { useModeration } from './useModeration'
import { useI18n } from './useI18n'
import { subscribeToConversation as subscribeToConversationFallback } from './useRealtimeFallback'
import { MESSAGE_FIELDS } from './useMessages.constants'
import type { Conversation, Message } from '../types'
import { friendlyErrorMessage } from '../utils'
import { checkContent, isLocalDuplicate, clearLocalDuplicate, remoteModerate } from '../utils/contentSafety'
import { mpTextGate } from './useWechatSecCheck'
import { parseStickerToken } from '../components/stickers/registry'
import {
  isDefinitiveMutationRejection,
  mutationCommitState,
  mutationOutcomeError,
  shouldCompensateMutationFailure,
} from '../api/mutationCommit'
import {
  captureAccountRequest,
  captureActiveAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from './accountScope'
import { createClientMessageId } from '../api/clientMessageId'
import { fetchArchivedConversationIds } from '../api/conversationArchive'
import { readAllAscendingKeyset } from '../api/paginatedRead'
import {
  sanitizeConversationResources,
  sanitizeMessageResources,
} from '../utils/publicResource'

/*
 * Explicit column lists for the two tables we touch here. SELECT '*'
 * is a liability as the schema grows — every new column (migration
 * adds tos_version, flagged_at, etc) starts shipping down the wire
 * even when no UI surface consumes it. Named lists keep payloads lean
 * and make it obvious where to update when a new read dependency lands.
 *
 * MESSAGE_FIELDS lives in ./useMessages.constants to break a Vite
 * chunker cycle with useRealtimeFallback. Re-exported here so external
 * callers keep the single import site.
 */
export { MESSAGE_FIELDS }
export { createClientMessageId }
export const CONVERSATION_FIELDS =
  'id, item_id, buyer_id, seller_id, last_message_at, created_at, is_pinned_buyer, is_pinned_seller, is_muted_buyer, is_muted_seller' as const

const conversations = ref<Conversation[]>([])
const messages = ref<Message[]>([])
const loading = ref(false)

function timestampSubMillisecondMicroseconds(value: string): number {
  const fraction = value.match(
    /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/,
  )?.[1] || ''
  return Number(fraction.padEnd(6, '0').slice(3, 6))
}

export function comparePostgresTimestamps(left: string, right: string): number {
  if (left === right) return 0

  const leftMilliseconds = Date.parse(left)
  const rightMilliseconds = Date.parse(right)
  if (Number.isFinite(leftMilliseconds) && Number.isFinite(rightMilliseconds)) {
    if (leftMilliseconds !== rightMilliseconds) {
      return leftMilliseconds < rightMilliseconds ? -1 : 1
    }

    // Date.parse truncates PostgreSQL's fourth-through-sixth fractional
    // digits. Preserve them so adjacent microseconds cannot be reordered by
    // the UUID tiebreaker below.
    const leftSubMilliseconds = timestampSubMillisecondMicroseconds(left)
    const rightSubMilliseconds = timestampSubMillisecondMicroseconds(right)
    if (leftSubMilliseconds !== rightSubMilliseconds) {
      return leftSubMilliseconds < rightSubMilliseconds ? -1 : 1
    }
    return 0
  }

  // Database timestamptz values are valid, but retain a deterministic,
  // locale-independent fallback if a malformed fixture ever crosses the
  // runtime boundary.
  return left < right ? -1 : 1
}

export function compareMessagesChronologically(left: Message, right: Message): number {
  const timeOrder = comparePostgresTimestamps(left.created_at, right.created_at)
  if (timeOrder !== 0) return timeOrder
  const leftId = left.id.toLowerCase()
  const rightId = right.id.toLowerCase()
  if (leftId === rightId) return 0
  return leftId < rightId ? -1 : 1
}

/*
 * `messages` is intentionally a module singleton because the messages page and
 * ChatThread share it. That also means a slow request/subscription from thread
 * A can otherwise land after the user has switched to thread B and replace B's
 * timeline. Keep one explicit active-conversation generation and reject every
 * stale async completion/event before it touches the shared ref.
 */
let activeMessagesConversationId: string | null = null
let latestMessagesRequestId = 0
let latestConversationsRequestId = 0
let latestMessageLiveVersion = 0
let latestConversationLiveVersion = 0
const messageLiveVersionById = new Map<string, number>()
const conversationLiveVersionById = new Map<string, number>()
const conversationInboxDeliveryVersionById = new Map<string, number>()

function activateMessagesConversation(conversationId: string) {
  if (activeMessagesConversationId === conversationId) return
  activeMessagesConversationId = conversationId
  latestMessagesRequestId++
  messages.value = []
  messageLiveVersionById.clear()
}
// True when the last conversation-list fetch failed AND we have no list to
// show — lets the page render a retry surface instead of the empty-inbox
// illustration (which otherwise presents a load failure as "no messages").
const conversationsError = ref(false)

/*
 * SWR guard for the conversations list. messages/index.vue refetches on
 * every onShow (tab switch), which was a 500ms-1s round-trip each time
 * even when nothing changed. We skip the refetch when the same user's
 * list was loaded within CONVERSATIONS_TTL. Any write that changes the
 * list (sendMessage / archiveConversation) and clearMessages() invalidate
 * it; pull-to-refresh passes { force: true }.
 */
const CONVERSATIONS_TTL = 30_000
let conversationsFetchedAt = 0
let conversationsFetchedFor: string | null = null
// Exported so useUnread's realtime inbox subscription can invalidate the
// list when an INCOMING message arrives — without that hook the SWR guard
// could hide a new message/conversation for up to CONVERSATIONS_TTL.
export function invalidateConversations() {
  conversationsFetchedAt = 0
  conversationsFetchedFor = null
}

function resetMessageState() {
  conversations.value = []
  messages.value = []
  loading.value = false
  activeMessagesConversationId = null
  latestMessagesRequestId++
  latestConversationsRequestId++
  latestMessageLiveVersion = 0
  latestConversationLiveVersion = 0
  messageLiveVersionById.clear()
  conversationLiveVersionById.clear()
  conversationInboxDeliveryVersionById.clear()
  conversationsError.value = false
  invalidateConversations()
}

// Conversations and timelines are shared module refs. Clear them synchronously
// at every sign-in/sign-out/account switch so one rendered frame can never show
// the previous account while the next account's fetch is in flight.
onAccountTransition(() => resetMessageState())

/*
 * Conversation-list ordering: pinned-first, then newest-message-first.
 * Extracted so the realtime incoming-message path (applyIncomingMessage)
 * re-sorts with the exact same comparator the initial fetch uses.
 */
function sortConversationsInPlace(list: Conversation[], userId: string) {
  list.sort((a, b) => {
    const aPinned = (a.buyer_id === userId && a.is_pinned_buyer) || (a.seller_id === userId && a.is_pinned_seller)
    const bPinned = (b.buyer_id === userId && b.is_pinned_buyer) || (b.seller_id === userId && b.is_pinned_seller)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    const newestFirst = new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    if (Number.isFinite(newestFirst) && newestFirst !== 0) return newestFirst
    return a.id.localeCompare(b.id)
  })
}

/*
 * Live-reorder the loaded conversation list when a message arrives over
 * realtime (QA6 #4 — WeChat-style: the conversation jumps to the top of its
 * pinned/unpinned group). Called from useUnread's inbox subscription. Only
 * mutates a conversation already in the list; a brand-new conversation row is
 * handled by the SWR invalidation + next-onShow refetch. The list is a module
 * singleton, so this reflects reactively wherever it's rendered. created_at
 * falls back to now() — the message just arrived, so "now" is the correct sort
 * key even when the realtime payload omits the timestamp.
 */
export function applyIncomingMessage(
  newMsg: { conversation_id?: string; content?: string; message_type?: string; created_at?: string } | null,
  userId: string,
  deliveryVersion?: number,
): boolean {
  if (!newMsg?.conversation_id || !userId || getActiveAccountId() !== userId) return false
  const conv = conversations.value.find(c => c.id === newMsg.conversation_id) as any
  if (typeof deliveryVersion === 'number') {
    const lastDeliveryVersion = conversationInboxDeliveryVersionById.get(
      newMsg.conversation_id,
    ) || 0
    if (deliveryVersion <= lastDeliveryVersion) return !!conv
    // Record delivery order even when the row is not loaded yet. A newer
    // callback may finish its badge/moderation work before an older callback;
    // once an authoritative fetch restores the row, that older continuation
    // must not roll the preview backward.
    conversationInboxDeliveryVersionById.set(
      newMsg.conversation_id,
      deliveryVersion,
    )
  }
  if (!conv) return false
  conv.last_message_at = newMsg.created_at || new Date().toISOString()
  if (typeof newMsg.content === 'string') {
    conv.last_message_preview = newMsg.message_type === 'text' ? newMsg.content : ''
  }
  if (newMsg.message_type) conv.last_message_type = newMsg.message_type
  conversationLiveVersionById.set(
    conv.id,
    ++latestConversationLiveVersion,
  )
  sortConversationsInPlace(conversations.value, userId)
  conversations.value = [...conversations.value]
  return true
}

export function useMessages() {
  const { supabase } = useSupabase()
  const { t, lang } = useI18n()

  async function fetchConversations(
    userId: string,
    opts: { force?: boolean; silent?: boolean } = {},
  ): Promise<boolean> {
    const requestToken = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(requestToken)) return false
    const requestId = ++latestConversationsRequestId
    const ownerIsCurrent = () => (
      isAccountRequestCurrent(requestToken)
      && requestId === latestConversationsRequestId
    )
    const liveVersionAtStart = latestConversationLiveVersion

    // The inbox owns this dependency instead of assuming App.onLaunch already
    // won the race. On a cold start the conversation query used to resolve
    // before blocks loaded, permanently caching a blocked peer until another
    // forced refresh. Await the account-scoped moderation snapshot first, then
    // apply it to both the cached and network paths below.
    const { blockedIds, ensureLoaded: ensureBlockedLoaded } = useModeration()
    const moderationGate = await ensureBlockedLoaded()
    if (!ownerIsCurrent()) return false
    if (!moderationGate.ok) {
      // A stale inbox can contain a now-blocked peer, so do not preserve it
      // when the authoritative block snapshot is unavailable.
      conversations.value = []
      conversationsError.value = true
      loading.value = false
      invalidateConversations()
      if (!opts.silent) {
        uni.showToast({ title: t('error.loadFailed'), icon: 'none', duration: 3000 })
      }
      return false
    }

    if (
      !opts.force &&
      conversationsFetchedFor === userId &&
      conversations.value.length > 0 &&
      Date.now() - conversationsFetchedAt < CONVERSATIONS_TTL
    ) {
      if (blockedIds.value.size > 0) {
        conversations.value = conversations.value.filter(
          conversation => !blockedIds.value.has(conversation.buyer_id)
            && !blockedIds.value.has(conversation.seller_id),
        )
      }
      loading.value = false
      return true
    }
    loading.value = true
    conversationsError.value = false
    try {
      const data = await readAllAscendingKeyset<any>({
        isOwnerCurrent: ownerIsCurrent,
        keyOf: row => row?.id,
        fetchPage: (afterId, requestedRows) => {
          let query = supabase
            .from('conversations')
            .select(`${CONVERSATION_FIELDS},
              latest_messages:messages(id, content, message_type, created_at),
              item:items(id, user_id, title, title_i18n, images, image_dimensions, price, status, category),
              buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url, is_illini_verified),
              seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url, is_illini_verified)`)
            .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
          if (afterId) query = query.gt('id', afterId)
          return query
            .order('id', { ascending: true })
            .limit(requestedRows)
            // One deterministic child row per parent. This avoids both a
            // giant `.in()` URL for large inboxes and a global message cap
            // where one hot thread could starve every other preview.
            .order('created_at', {
              ascending: false,
              referencedTable: 'latest_messages',
            })
            .order('id', {
              ascending: false,
              referencedTable: 'latest_messages',
            })
            .limit(1, { referencedTable: 'latest_messages' })
        },
      })
      if (data === null || !ownerIsCurrent()) return false

      let convs = ((data || []) as unknown as Conversation[])
        .map(sanitizeConversationResources)
      for (const conversation of convs as any[]) {
        const latest = Array.isArray(conversation.latest_messages)
          ? conversation.latest_messages[0]
          : null
        delete conversation.latest_messages
        if (!latest || typeof latest !== 'object') continue
        conversation.last_message_preview = latest.message_type === 'text'
          && typeof latest.content === 'string'
          ? latest.content
          : ''
        if (typeof latest.message_type === 'string') {
          conversation.last_message_type = latest.message_type
        }
        if (typeof latest.created_at === 'string' && latest.created_at) {
          conversation.last_message_at = latest.created_at
        }
      }
      if (blockedIds.value.size > 0) {
        convs = convs.filter(c => !blockedIds.value.has(c.buyer_id) && !blockedIds.value.has(c.seller_id))
      }

      // Archiving is per participant. The separate relation keeps the base
      // conversation schema compatible during rollout; only a confirmed
      // missing-relation error is treated as the pre-migration empty state.
      const archivedIds = await fetchArchivedConversationIds(supabase, userId, {
        isOwnerCurrent: ownerIsCurrent,
      })
      if (archivedIds === null || !ownerIsCurrent()) return false
      if (archivedIds.size > 0) convs = convs.filter(c => !archivedIds.has(c.id))

      if (!isAccountRequestCurrent(requestToken) || requestId !== latestConversationsRequestId) return false
      const currentById = new Map(conversations.value.map(c => [c.id, c]))
      for (const conversation of convs as any[]) {
        if (
          (conversationLiveVersionById.get(conversation.id) || 0)
          <= liveVersionAtStart
        ) continue
        const live = currentById.get(conversation.id) as any
        if (!live) continue
        conversation.last_message_at = live.last_message_at
        conversation.last_message_preview = live.last_message_preview
        conversation.last_message_type = live.last_message_type
      }
      sortConversationsInPlace(convs, userId)
      conversations.value = convs
      conversationsFetchedAt = Date.now()
      conversationsFetchedFor = userId
      return true
    } catch (error: any) {
      if (!isAccountRequestCurrent(requestToken) || requestId !== latestConversationsRequestId) return false
      console.error('[messages] fetch conversations failed')
      // Only flag the dedicated error surface when there's no prior list to
      // fall back on — otherwise keep the stale list visible and just toast.
      if (conversations.value.length === 0) conversationsError.value = true
      if (!opts.silent) {
        uni.showToast({ title: friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('error.loadFailed'), icon: 'none', duration: 3000 })
      }
      return false
    } finally {
      if (isAccountRequestCurrent(requestToken) && requestId === latestConversationsRequestId) {
        loading.value = false
      }
    }
  }

  // Cap a single conversation load. A long-running thread can hold
  // thousands of rows; loading them all blew up the DOM and memory.
  // Fetch the most-recent MESSAGE_PAGE descending, then flip to
  // chronological for render (older history is rarely scrolled to in
  // a marketplace chat; a "load earlier" affordance can come later).
  const MESSAGE_PAGE = 200

  async function fetchMessages(conversationId: string): Promise<boolean> {
    const accountToken = captureActiveAccountRequest()
    if (!accountToken) return false
    activateMessagesConversation(conversationId)
    const liveVersionAtStart = latestMessageLiveVersion
    const requestId = ++latestMessagesRequestId
    const { data, error } = await supabase
      .from('messages')
      .select(`${MESSAGE_FIELDS}, sender:profiles(id, nickname, avatar_url)`)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(MESSAGE_PAGE)

    // A newer fetch or a conversation switch owns the singleton now. Stale
    // failures are ignored too, so an unmounted thread cannot surface a toast
    // over the newly-opened one.
    if (
      requestId !== latestMessagesRequestId ||
      activeMessagesConversationId !== conversationId ||
      !isAccountRequestCurrent(accountToken)
    ) return false
    if (error) throw error
    /* PostgREST embed 'sender:profiles(...)' resolves to a single row via
       the FK, but TS can't narrow that from our template-literal select —
       the as-unknown hop matches the pattern already used by fetchConversations. */
    const fetched = ((data || []) as unknown as Message[])
      .map(sanitizeMessageResources)
      .reverse()
    /* Merge by id instead of blind-assigning. `messages` is a module
       singleton and the foreground-heal (#95) refetches while the live
       subscription may push a new row mid-await — a plain reset-then-assign
       would drop that row until the next heal. Keep only same-conversation
       rows so navigating to a different thread still clears the old one. */
    const byId = new Map<string, Message>()
    for (const m of messages.value) if (m.conversation_id === conversationId) byId.set(m.id, m)
    for (const m of fetched) {
      if (
        byId.has(m.id)
        && (messageLiveVersionById.get(m.id) || 0) > liveVersionAtStart
      ) continue
      byId.set(m.id, m)
    }
    messages.value = [...byId.values()].sort(compareMessagesChronologically)
    return true
  }

  function clearMessages() {
    resetMessageState()
  }

  async function sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    type: import('../types').MessageType = 'text',
    options?: {
      accountToken?: AccountRequestToken
      /** Reuse this id for every retry of the same logical message. */
      messageId?: string
      /** A retry reuses the existing duplicate hold; the row id is authoritative. */
      isRetry?: boolean
    },
  ) {
    const accountToken = options?.accountToken || captureAccountRequest(senderId)
    const messageId = options?.messageId || createClientMessageId()
    let mutationStarted = false
    let duplicateHeld = false

    try {
      if (accountToken.userId !== senderId || !isAccountRequestCurrent(accountToken)) {
        throw mutationOutcomeError(new Error('Account changed'), 'not_committed')
      }
      if (type !== 'text') throw new Error('chat_media_private_storage_required')
      if (content.length > 2000) throw new Error('message_too_long')

      // App-generated sticker tokens skip the prose guards (the DB trigger
      // whitelists them too, migration 049) — no point spending an OpenAI
      // moderation call on '[sticker:smile]'.
      const isSticker = type === 'text' && parseStickerToken(content) !== null

      if (type === 'text' && !isSticker) {
        const safety = checkContent(content, { kind: 'message', allowLinks: false })
        if (!safety.ok) throw new Error(`moderation_block:${safety.category}:${safety.reason || ''}`)
        if (!options?.isRetry) {
          if (isLocalDuplicate(accountToken, `msg:${conversationId}`, content)) throw new Error('duplicate_message')
          duplicateHeld = true
        }
      }

      if (type === 'text' && !isSticker) {
        const ai = await remoteModerate(content, accountToken)
        if (ai.flagged) throw new Error(`moderation_block:sensitive_word:ai(${ai.categories.join(',')})`)
        /* mp store review: WeChat's own classifier (no-op on H5). */
        await mpTextGate(content, 4, accountToken)
      }

      // For media sends there is no await between this guard and starting the
      // insert. A switch after it can only write as A or be rejected by RLS;
      // it can never bind A's URL to B's sender id.
      if (accountToken.userId !== senderId || !isAccountRequestCurrent(accountToken)) {
        throw mutationOutcomeError(new Error('Account changed'), 'not_committed')
      }

      mutationStarted = true
      let data: any
      let error: any
      try {
        const response = await supabase
          .from('messages')
          .insert({
            id: messageId,
            conversation_id: conversationId,
            sender_id: senderId,
            content,
            message_type: type,
          })
          .select(MESSAGE_FIELDS)
          .single()
        data = response.data
        error = response.error
      } catch (writeError) {
        // A transport exception can hide a committed insert. Read by the
        // client-allocated primary key before exposing a retryable failure.
        const recovered = await recoverCommittedMessage(
          messageId, senderId, conversationId, content, type,
        )
        if (recovered) {
          data = recovered
          error = null
        } else {
          throw mutationOutcomeError(writeError, 'unknown')
        }
      }

      if (error) {
        // Retrying a message whose first response was lost reaches the same
        // primary key and returns 23505. Recover the original authoritative
        // row instead of inserting a second message or surfacing a false
        // failure. Also try on 5xx/unclassified responses whose commit state
        // is unknown.
        const duplicatePrimaryKey = String((error as any)?.code || '') === '23505'
        const shouldRecover = duplicatePrimaryKey
          || !isDefinitiveMutationRejection(error)
        if (shouldRecover) {
          const recovered = await recoverCommittedMessage(
            messageId, senderId, conversationId, content, type,
          )
          if (recovered) {
            data = recovered
            error = null
          }
        }
      }

      if (error) {
        const duplicatePrimaryKey = String((error as any)?.code || '') === '23505'
        throw mutationOutcomeError(
          error,
          // A duplicate client-owned primary key proves some row with this id
          // exists. If the recovery read is temporarily unavailable or hidden,
          // the original logical send may already be committed; media must not
          // be compensated. Keep the outcome unknown and let later history or
          // a same-id retry reconcile it.
          duplicatePrimaryKey
            ? 'unknown'
            : isDefinitiveMutationRejection(error) ? 'not_committed' : 'unknown',
        )
      }
      if (!data) throw mutationOutcomeError(new Error('Message send result unavailable'), 'unknown')
      if (!isAccountRequestCurrent(accountToken)) {
        // The insert is authoritative for A, but singleton message state may
        // already belong to B. Report a committed stale completion so callers
        // neither append A's row into B's UI nor delete referenced media.
        throw mutationOutcomeError(new Error('Account changed after message send'), 'committed')
      }

      // The list's last-message preview + sort order just changed; force a
      // fresh fetch next time the conversations tab is shown.
      invalidateConversations()

      /*
       * No client-side conversations.last_message_at UPDATE here:
       * migration 003 installed the bump_conversation_last_message
       * trigger on messages AFTER INSERT, so the server keeps it in
       * sync. Doing it from the client too was a redundant RTT and
       * a race (client clock skew vs trigger NOW() — whoever lands
       * second wins, which on a slow phone could be the client and
       * give wrong sort order in the conversations list).
       */
      return sanitizeMessageResources(data as Message)
    } catch (err) {
      const tagged = mutationCommitState(err)
        ? err
        : mutationOutcomeError(err, mutationStarted ? 'unknown' : 'not_committed')
      // Unknown transport outcomes may already be committed; keep the hold so
      // realtime/history can reconcile instead of encouraging a duplicate.
      if (duplicateHeld && shouldCompensateMutationFailure(tagged)) {
        clearLocalDuplicate(accountToken, `msg:${conversationId}`, content)
      }
      throw tagged
    }
  }

  async function recoverCommittedMessage(
    messageId: string,
    senderId: string,
    conversationId: string,
    content: string,
    type: import('../types').MessageType,
  ): Promise<Message | null> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_FIELDS)
        .eq('id', messageId)
        .eq('sender_id', senderId)
        .eq('conversation_id', conversationId)
        .maybeSingle()
      if (error || !data) return null
      // Validate the complete logical payload locally. Keeping long message
      // bodies out of PostgREST query parameters avoids URL-length failures
      // while still refusing to reconcile an improbable primary-key collision.
      if (data.content !== content || data.message_type !== type) return null
      return sanitizeMessageResources(data as Message)
    } catch {
      return null
    }
  }

  async function getOrCreateConversation(itemId: string, buyerId: string, sellerId: string) {
    const accountToken = captureAccountRequest(buyerId)
    const assertCurrentAccount = () => {
      if (!isAccountRequestCurrent(accountToken)) throw new Error('Account changed while opening conversation')
    }
    assertCurrentAccount()
    const { data: existing, error: findErr } = await supabase
      .from('conversations')
      .select(CONVERSATION_FIELDS)
      .eq('item_id', itemId)
      .eq('buyer_id', buyerId)
      .eq('seller_id', sellerId)
      .maybeSingle()

    assertCurrentAccount()
    if (findErr) throw findErr
    if (existing) return existing as Conversation

    const { data, error } = await supabase
      .from('conversations')
      .insert({ item_id: itemId, buyer_id: buyerId, seller_id: sellerId })
      .select(CONVERSATION_FIELDS)
      .single()

    assertCurrentAccount()

    // Two rapid taps of "联系卖家" can race: the second insert hits the
    // UNIQUE(item_id,buyer_id,seller_id) constraint (23505). That's not a
    // failure — the conversation now exists, so recover it instead of
    // surfacing a "failed to start chat" toast. Keeps one chat per (item,
    // buyer, seller), idempotent under double-tap.
    if (error) {
      if ((error as any).code === '23505') {
        const { data: raced, error: reErr } = await supabase
          .from('conversations')
          .select(CONVERSATION_FIELDS)
          .eq('item_id', itemId)
          .eq('buyer_id', buyerId)
          .eq('seller_id', sellerId)
          .single()
        assertCurrentAccount()
        if (reErr) throw reErr
        return raced as Conversation
      }
      throw error
    }
    assertCurrentAccount()
    return data as Conversation
  }

  function subscribeToMessages(
    conversationId: string,
    onNewMessage: (msg: Message) => void,
    onMessageUpdate?: (msg: Message) => void,
    onReady?: () => void | Promise<void>,
    onReconcile?: () => void | Promise<void>,
  ) {
    const accountToken = captureActiveAccountRequest()
    if (!accountToken) return () => {}
    activateMessagesConversation(conversationId)
    /* Platform-aware: H5 uses Supabase Realtime (WebSocket); mp targets
       use polling because their uni.connectSocket doesn't speak the
       Phoenix channel protocol. See useRealtimeFallback for details.

       Filter callbacks against the active singleton owner as well as the row's
       conversation id. A teardown can race one already-queued websocket/poll
       callback; without this guard that late A event can bleed into thread B. */
    return subscribeToConversationFallback(
      conversationId,
      (m) => {
        const msg = sanitizeMessageResources(m as Message)
        if (
          activeMessagesConversationId !== conversationId ||
          !isAccountRequestCurrent(accountToken) ||
          msg.conversation_id !== conversationId
        ) return
        messageLiveVersionById.set(msg.id, ++latestMessageLiveVersion)
        onNewMessage(msg)
      },
      onMessageUpdate ? (m) => {
        const msg = sanitizeMessageResources(m as Message)
        if (
          activeMessagesConversationId !== conversationId ||
          !isAccountRequestCurrent(accountToken) ||
          msg.conversation_id !== conversationId
        ) return
        messageLiveVersionById.set(msg.id, ++latestMessageLiveVersion)
        onMessageUpdate(msg)
      } : undefined,
      onReady ? () => {
        if (
          activeMessagesConversationId !== conversationId ||
          !isAccountRequestCurrent(accountToken)
        ) return
        return onReady()
      } : undefined,
      onReconcile ? () => {
        if (
          activeMessagesConversationId !== conversationId ||
          !isAccountRequestCurrent(accountToken)
        ) return
        return onReconcile()
      } : undefined,
    )
  }

  async function markAsRead(conversationId: string, userId: string) {
    const accountToken = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(accountToken)) return
    const { error } = await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .eq('is_read', false)

    if (!isAccountRequestCurrent(accountToken)) return
    if (error) {
      console.error('[messages] mark as read failed')
      throw error
    }
  }

  async function archiveConversation(conversationId: string) {
    const accountToken = captureActiveAccountRequest()
    if (!accountToken) throw new Error('Not authenticated')
    const { error } = await supabase.rpc('archive_conversation', {
      conversation_id_in: conversationId,
      expected_user_id_in: accountToken.userId,
    })

    if (!isAccountRequestCurrent(accountToken)) return
    if (error) throw error
    conversations.value = conversations.value.filter(c => c.id !== conversationId)
    invalidateConversations()
  }

  async function fetchConversationDetail(conversationId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select(`${CONVERSATION_FIELDS},
        item:items(id, title, title_i18n, images, price, status, negotiable, user_id, category, listing_type, location),
        buyer:profiles!conversations_buyer_id_fkey(id, nickname, avatar_url),
        seller:profiles!conversations_seller_id_fkey(id, nickname, avatar_url)`)
      .eq('id', conversationId)
      .single()

    if (error) throw error
    return sanitizeConversationResources(data as unknown as Conversation)
  }

  async function setConversationPinned(conv: Conversation, userId: string, pinned: boolean) {
    const accountToken = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(accountToken)) throw new Error('Account changed')
    const field = conv.buyer_id === userId ? 'is_pinned_buyer' : 'is_pinned_seller'
    const { error } = await supabase
      .from('conversations')
      .update({ [field]: pinned })
      .eq('id', conv.id)
    if (!isAccountRequestCurrent(accountToken)) return
    if (error) throw error
    ;(conv as any)[field] = pinned
    // Pin state drives list sort order; callers re-fetch to re-sort, so the
    // SWR guard must not short-circuit that fetch.
    invalidateConversations()
  }

  async function setConversationMuted(conv: Conversation, userId: string, muted: boolean) {
    const accountToken = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(accountToken)) throw new Error('Account changed')
    const field = conv.buyer_id === userId ? 'is_muted_buyer' : 'is_muted_seller'
    const { error } = await supabase
      .from('conversations')
      .update({ [field]: muted })
      .eq('id', conv.id)
    if (!isAccountRequestCurrent(accountToken)) return
    if (error) throw error
    ;(conv as any)[field] = muted
    invalidateConversations()
  }

  async function markConversationUnread(conversationId: string, userId: string) {
    const accountToken = captureAccountRequest(userId)
    if (!isAccountRequestCurrent(accountToken)) return
    const { data: lastMsg, error: lookupError } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!isAccountRequestCurrent(accountToken)) return
    if (lookupError) throw lookupError
    if (lastMsg) {
      const { error } = await supabase
        .from('messages')
        .update({ is_read: false })
        .eq('id', lastMsg.id)
      if (!isAccountRequestCurrent(accountToken)) return
      if (error) throw error
    }
  }

  return {
    conversations,
    messages,
    loading,
    conversationsError,
    fetchConversations,
    fetchMessages,
    sendMessage,
    getOrCreateConversation,
    subscribeToMessages,
    markAsRead,
    markConversationUnread,
    archiveConversation,
    fetchConversationDetail,
    setConversationPinned,
    setConversationMuted,
    clearMessages,
  }
}
