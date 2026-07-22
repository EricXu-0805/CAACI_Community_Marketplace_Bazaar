<template>
  <view class="page has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <AppSidebar current="messages" />

    <view class="page-header u-glass u-glass--hair-b">
      <text class="page-title">{{ t('nav.messages') }}</text>
    </view>

    <!-- Left column: filters + conversation list. Becomes a fixed-width
         rail in the desktop two-pane; full width on phones. -->
    <view class="msg-left">
    <!-- Filter chips (v5 kit: 全部 / 未读 / 商品) — client-side filter. -->
    <view v-if="isLoggedIn && conversations.length > 0" class="msg-filters" role="tablist" :aria-label="t('nav.messages')">
      <view
        v-for="f in msgFilters"
        :key="f.key"
        :class="['mf-chip', { active: msgFilter === f.key }]"
        role="tab"
        :tabindex="msgFilter === f.key ? 0 : -1"
        :aria-selected="msgFilter === f.key ? 'true' : 'false'"
        @click="msgFilter = f.key"
        @keydown="onMessageFilterKeydown($event, f.key)"
      >
        <text class="mf-chip-label">{{ f.label }}</text>
      </view>
    </view>

    <view v-if="authState === 'anonymous'" class="login-prompt">
      <UEmptyArt name="messages" :size="104" />
      <text class="prompt-text">{{ t('msg.signIn') }}</text>
      <view
        class="login-btn"
        role="button"
        tabindex="0"
        :aria-label="t('profile.signIn')"
        @click="goLogin"
        @keydown="onPageActionKeydown($event, 'login')"
      >{{ t('profile.signIn') }}</view>
    </view>

    <view v-else-if="authState === 'initializing' || (loading && conversations.length === 0)" class="conv-list">
      <view v-for="n in 7" :key="'cs' + n" class="conv-skel">
        <view class="cs-avatar u-sk"></view>
        <view class="cs-info">
          <view class="cs-line u-sk" style="width: 38%"></view>
          <view class="cs-line u-sk" style="width: 72%"></view>
        </view>
      </view>
    </view>

    <view v-else-if="conversationsError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
      <UIcon name="shield" size="lg" color="text-faint" />
      <text class="empty-title">{{ t('error.loadFailed') }}</text>
      <view
        class="empty-btn"
        role="button"
        tabindex="0"
        :aria-label="t('home.retry')"
        @click="retryConversations"
        @keydown="onPageActionKeydown($event, 'retry')"
      >{{ t('home.retry') }}</view>
    </view>

    <view v-else-if="conversations.length === 0 && !loading" class="empty">
      <UEmptyArt name="messages" />
      <text class="empty-title">{{ t('msg.empty') }}</text>
      <text class="empty-sub">{{ t('msg.emptySub') }}</text>
    </view>

    <view v-else class="conv-list u-stagger" :key="msgFilter">
      <view v-if="visibleConversations.length === 0" class="filtered-empty">
        <text class="filtered-empty-label">{{ t('msg.noFiltered') }}</text>
      </view>
      <view
        v-for="conv in visibleConversations"
        :key="conv.id"
        class="conv-row"
        :class="{ 'is-swiped': (swipeOffsets[conv.id] || 0) < -5 }"
        @touchstart="onTouchStart($event, conv.id)"
        @touchmove="onTouchMove($event, conv.id)"
        @touchend="onTouchEnd(conv.id)"
      >
        <view
          class="conv-item"
          :class="{ active: conv.id === selectedConvId }"
          :style="{ transform: `translateX(${swipeOffsets[conv.id] || 0}px)` }"
          role="button"
          tabindex="0"
          aria-keyshortcuts="Shift+F10"
          :aria-label="getOtherUser(conv)?.nickname || t('app.user')"
          :aria-current="conv.id === selectedConvId ? 'true' : undefined"
          @focus="closeAllSwipes()"
          @click="onItemTap(conv)"
          @longpress="onMoreMenu(conv)"
          @contextmenu.prevent="onMoreMenu(conv)"
          @keydown="onConversationKeydown($event, conv)"
        >
          <view class="conv-avatar-wrap">
            <UAvatar
              :src="getOtherUser(conv)?.avatar_url"
              :owner="getOtherUser(conv)?.id"
              :fallback="defaultAvatar"
              :alt="getOtherUser(conv)?.nickname || 'avatar'"
              class="conv-avatar"
              lazy
            />
          </view>
          <view class="conv-info">
            <view class="conv-top">
              <view class="conv-name-wrap">
                <view v-if="isPinned(conv)" class="pin-badge"></view>
                <text :class="['conv-name', { unread: unreadConvIds.has(conv.id) && !isMuted(conv) }]">{{ getOtherUser(conv)?.nickname || t('app.user') }}</text>
                <view v-if="isMuted(conv)" class="mute-badge"></view>
              </view>
              <text class="conv-time">{{ formatTime(conv.last_message_at) }}</text>
            </view>
            <text :class="['conv-preview', { unread: unreadConvIds.has(conv.id) && !isMuted(conv) }]">
              {{ convPreview(conv) }}
            </text>
          </view>
          <view v-if="unreadConvIds.has(conv.id) && !isMuted(conv)" class="unread-dot"></view>
          <view v-else-if="unreadConvIds.has(conv.id) && isMuted(conv)" class="muted-dot"></view>
          <view class="conv-thumb-wrap" v-if="conv.item?.images?.[0]">
            <image :src="thumbUrl(conv.item.images[0], 'list')" :alt="localize(conv.item.title_i18n, conv.item.title)" class="conv-thumb" mode="aspectFill" lazy-load />
            <text v-if="conv.item?.status === 'sold'" class="thumb-badge sold">{{ t('status.sold') }}</text>
            <text v-else-if="conv.item?.status === 'reserved'" class="thumb-badge reserved">{{ t('status.reserved') }}</text>
          </view>
        </view>

        <!-- Swipe-left reveals all actions on the right, in a single
             consistent direction. Pin sits first so it stays reachable
             even at a partial swipe; archive is farthest from the thumb
             so it is harder to trigger by accident. -->
        <view class="swipe-actions right">
          <view
            class="swipe-act act-pin"
            role="button"
            tabindex="0"
            :aria-label="isPinned(conv) ? t('msg.unpin') : t('msg.pin')"
            @focus="openSwipeForKeyboard(conv.id)"
            @click="togglePin(conv)"
            @keydown="onSwipeActionKeydown($event, conv, 'pin')"
          >
            <text class="swipe-act-label">{{ isPinned(conv) ? t('msg.unpin') : t('msg.pin') }}</text>
          </view>
          <view
            class="swipe-act act-read"
            role="button"
            tabindex="0"
            :aria-label="unreadConvIds.has(conv.id) ? t('msg.markRead') : t('msg.markUnread')"
            @focus="openSwipeForKeyboard(conv.id)"
            @click="toggleRead(conv)"
            @keydown="onSwipeActionKeydown($event, conv, 'read')"
          >
            <text class="swipe-act-label">{{ unreadConvIds.has(conv.id) ? t('msg.markRead') : t('msg.markUnread') }}</text>
          </view>
          <view
            class="swipe-act act-archive"
            role="button"
            tabindex="0"
            :aria-label="t('msg.archiveConv')"
            @focus="openSwipeForKeyboard(conv.id)"
            @click="onArchive(conv)"
            @keydown="onSwipeActionKeydown($event, conv, 'archive')"
          >
            <text class="swipe-act-label">{{ t('msg.archive') }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading && conversations.length > 0" class="loading-tip">
      <view class="loading-dot"></view>
      <text>{{ t('msg.loading') }}</text>
    </view>
    </view><!-- /.msg-left -->

    <!-- Desktop two-pane (≥768px): the selected conversation's thread,
         embedded. Hidden on phones, where tapping navigates to /chat. -->
    <view class="msg-thread-pane">
      <ChatThread
        v-if="authState === 'authenticated' && selectedConvId"
        :key="selectedConvId"
        :conversation-id="selectedConvId"
        embedded
      />
      <view v-else-if="authState === 'anonymous'" class="thread-empty">
        <UEmptyArt name="messages" :size="120" />
        <text class="te-text">{{ t('msg.signIn') }}</text>
      </view>
      <view v-else-if="authState === 'authenticated'" class="thread-empty">
        <UEmptyArt name="messages" :size="120" />
        <text class="te-text">{{ t('msg.selectHint') }}</text>
      </view>
    </view>
    <CustomTabBar current="messages" />
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { onShow, onPullDownRefresh, onUnload } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useMessages } from '../../composables/useMessages'
import { useUnread } from '../../composables/useUnread'
import { useTheme } from '../../composables/useTheme'
import {
  captureActiveAccountRequest,
  isAccountRequestCurrent,
  type AccountRequestToken,
} from '../../composables/accountScope'
import { formatTime, thumbUrl, friendlyErrorMessage } from '../../utils'
import { DIALOG_INK } from '../../utils/dialogColors'
import type { Conversation, Profile } from '../../types'
import AppSidebar from '../../components/AppSidebar.vue'
import ChatThread from '../../components/ChatThread.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import UAvatar from '../../components/UAvatar.vue'
import UEmptyArt from '../../components/UEmptyArt.vue'
import UIcon from '../../components/UIcon.vue'
import { parseStickerToken } from '../../components/stickers/registry'

const { t, lang, localize } = useI18n()

const { currentUser, isLoggedIn, authState, awaitAuthReady } = useAuth()
const {
  conversations,
  loading,
  conversationsError,
  fetchConversations,
  archiveConversation,
  setConversationPinned,
  setConversationMuted,
  markAsRead,
  markConversationUnread,
  clearMessages,
} = useMessages()
const { unreadConvIds, refreshUnreadCount } = useUnread()
const { isDark } = useTheme()

/*
 * Theme-aware avatar fallback (v3 P1, spec §1.4).
 *
 * The light default-avatar.svg is a flat white circle with a gray
 * figure — fine on cream canvas, but renders as a glaring near-white
 * disk on the deepened dark canvas (#15130F). Swap to the dark-paired
 * SVG (surface-alt background, ink-faint figure) when isDark resolves
 * true. Light-mode users see the original asset unchanged.
 */
const defaultAvatar = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)

// Filter chips (v5 kit): 全部 / 未读 / 商品 — client-side over the loaded list.
type MsgFilterKey = 'all' | 'unread' | 'items'
const msgFilter = ref<MsgFilterKey>('all')
const msgFilters = computed<{ key: MsgFilterKey; label: string }[]>(() => [
  { key: 'all', label: t('msg.filterAll') },
  { key: 'unread', label: t('msg.filterUnread') },
  { key: 'items', label: t('msg.filterItems') },
])
const visibleConversations = computed(() => {
  if (msgFilter.value === 'unread') {
    return conversations.value.filter(c => unreadConvIds.value.has(c.id) && !isMuted(c))
  }
  if (msgFilter.value === 'items') return conversations.value.filter(c => !!c.item)
  return conversations.value
})

function onMessageFilterKeydown(event: KeyboardEvent, current: MsgFilterKey) {
  const keys = msgFilters.value.map(filter => filter.key)
  const index = keys.indexOf(current)
  if (index < 0) return
  let nextIndex = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % keys.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + keys.length) % keys.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = keys.length - 1
  else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    msgFilter.value = current
    return
  } else return

  event.preventDefault()
  msgFilter.value = keys[nextIndex]
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  nextTick(() => tabList?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus())
}

// Desktop two-pane (≥768px): tapping a conversation opens it in the right
// pane (ChatThread embedded) instead of pushing the chat route. Phones keep
// navigating. isWide flips on resize so dragging a desktop window across the
// breakpoint switches behaviour live.
const selectedConvId = ref('')
const isWide = ref(false)
function detectWide() {
  try { isWide.value = uni.getSystemInfoSync().windowWidth >= 768 } catch {}
}
const handleWindowResize = (res: { size: { windowWidth: number } }) => {
  isWide.value = res.size.windowWidth >= 768
}
let windowResizeRegistered = false
let messagesPageAlive = true
let messagesPageEpoch = 0
onMounted(() => {
  detectWide()
  try {
    const onResize = (uni as any).onWindowResize
    if (typeof onResize === 'function') {
      onResize(handleWindowResize)
      windowResizeRegistered = true
    }
  } catch {}
})

// Dropping below the two-pane breakpoint with a conversation open must clear
// the selection — otherwise the embedded ChatThread stays mounted (hidden)
// with live subscriptions, and the next tap navigates to /chat and mounts a
// SECOND thread that double-pushes into the shared messages ref.
watch(isWide, (wide) => {
  if (!wide) selectedConvId.value = ''
})

const SWIPE_OPEN = 210
const swipeOffsets = reactive<Record<string, number>>({})
const touchState = reactive({ startX: 0, startY: 0, id: '' as string, locked: false, dir: '' as 'x' | 'y' | '' })

function openSwipeForKeyboard(id: string) {
  closeAllSwipes(id)
  swipeOffsets[id] = -SWIPE_OPEN
}

function keyboardActivation(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return false
  event.preventDefault()
  event.stopPropagation()
  return true
}

function onPageActionKeydown(event: KeyboardEvent, action: 'login' | 'retry') {
  if (!keyboardActivation(event)) return
  if (action === 'login') goLogin()
  else void retryConversations()
}

function onConversationKeydown(event: KeyboardEvent, conv: Conversation) {
  if (keyboardActivation(event)) {
    onItemTap(conv)
    return
  }
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
  event.preventDefault()
  event.stopPropagation()
  onMoreMenu(conv)
}

function onSwipeActionKeydown(
  event: KeyboardEvent,
  conv: Conversation,
  action: 'pin' | 'read' | 'archive',
) {
  if (!keyboardActivation(event)) return
  if (action === 'pin') void togglePin(conv)
  else if (action === 'read') void toggleRead(conv)
  else onArchive(conv)
}

onShow(async () => {
  const showEpoch = messagesPageEpoch
  detectWide()
  // onShow may run before App.onLaunch finishes hydrating the persisted
  // session. Wait instead of rendering the anonymous prompt and permanently
  // skipping the inbox fetch for an already signed-in user.
  await awaitAuthReady()
  if (!messagesPageAlive || showEpoch !== messagesPageEpoch) return
  if (currentUser.value) {
    fetchConversations(currentUser.value.id)
    refreshUnreadCount()
  }
})

// Re-run once auth lands, and synchronously tear down the desktop thread when
// the identity changes. useMessages clears its singleton at the same account
// transition; clearing the component-local selection here ensures A's
// ChatThread (detail, offers and subscriptions) is unmounted before B renders.
watch(() => currentUser.value?.id ?? null, (userId, previousUserId) => {
  if (userId === previousUserId) return
  selectedConvId.value = ''
  closeAllSwipes()
  if (userId) {
    fetchConversations(userId)
    refreshUnreadCount()
  }
})

async function retryConversations() {
  if (!currentUser.value) return
  await fetchConversations(currentUser.value.id, { force: true })
  await refreshUnreadCount()
}

onPullDownRefresh(async () => {
  try {
    if (currentUser.value) {
      // Explicit refresh bypasses the SWR TTL guard.
      await fetchConversations(currentUser.value.id, { force: true })
      await refreshUnreadCount()
    }
  } finally {
    uni.stopPullDownRefresh()
  }
})

// Release the module-scoped conversations/messages on page unload so the
// list doesn't outlive the page. (Tab pages rarely unload, so this is a
// safety net rather than a hot path.)
onUnload(() => {
  messagesPageAlive = false
  messagesPageEpoch += 1
  selectedConvId.value = ''
  closeAllSwipes()
  if (windowResizeRegistered) {
    const offResize = (uni as any).offWindowResize
    if (typeof offResize === 'function') offResize(handleWindowResize)
    windowResizeRegistered = false
  }
  clearMessages()
})

function convPreview(conv: Conversation): string {
  const type = (conv as any).last_message_type
  if (type === 'image') return `[${t('chat.photo')}]`
  if (type === 'video') return `[${t('chat.video')}]`
  const preview = (conv as any).last_message_preview
  if (preview && parseStickerToken(preview)) return `[${t('chat.sticker')}]`
  return preview || (conv.item ? localize(conv.item.title_i18n, conv.item.title) : '')
}

function getOtherUser(conv: Conversation): Profile | undefined {
  if (!currentUser.value) return undefined
  return conv.buyer_id === currentUser.value.id ? conv.seller : conv.buyer
}

function isPinned(conv: Conversation): boolean {
  if (!currentUser.value) return false
  return conv.buyer_id === currentUser.value.id ? !!conv.is_pinned_buyer : !!conv.is_pinned_seller
}

function isMuted(conv: Conversation): boolean {
  if (!currentUser.value) return false
  return conv.buyer_id === currentUser.value.id ? !!conv.is_muted_buyer : !!conv.is_muted_seller
}

function goChat(conversationId: string) {
  if (isWide.value) {
    // Two-pane: open in the right pane. The :key on ChatThread remounts it
    // per conversation, so it re-fetches + re-subscribes + marks read.
    selectedConvId.value = conversationId
    return
  }
  uni.navigateTo({ url: `/pages/chat/index?id=${conversationId}` })
}

function onItemTap(conv: Conversation) {
  const offset = swipeOffsets[conv.id] || 0
  if (Math.abs(offset) > 5) {
    closeSwipe(conv.id)
    return
  }
  goChat(conv.id)
}

function closeSwipe(id: string) {
  swipeOffsets[id] = 0
}

function closeAllSwipes(except?: string) {
  for (const id of Object.keys(swipeOffsets)) {
    if (id !== except) swipeOffsets[id] = 0
  }
}

function onTouchStart(e: any, id: string) {
  const touch = e.touches?.[0] || e.changedTouches?.[0]
  if (!touch) return
  touchState.startX = touch.clientX
  touchState.startY = touch.clientY
  touchState.id = id
  touchState.locked = false
  touchState.dir = ''
  closeAllSwipes(id)
}

function onTouchMove(e: any, id: string) {
  if (touchState.id !== id) return
  const touch = e.touches?.[0] || e.changedTouches?.[0]
  if (!touch) return
  const dx = touch.clientX - touchState.startX
  const dy = touch.clientY - touchState.startY

  if (!touchState.locked) {
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      touchState.dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      touchState.locked = true
    }
  }

  if (touchState.dir === 'x') {
    const clamped = Math.max(-SWIPE_OPEN, Math.min(0, dx))
    swipeOffsets[id] = clamped
  }
}

function onTouchEnd(id: string) {
  if (touchState.id !== id) return
  const offset = swipeOffsets[id] || 0
  swipeOffsets[id] = offset < -SWIPE_OPEN / 3 ? -SWIPE_OPEN : 0
  touchState.id = ''
}

function conversationActionToken(conv: Conversation): AccountRequestToken | null {
  if (!messagesPageAlive) return null
  const token = captureActiveAccountRequest()
  if (!token || !isAccountRequestCurrent(token)) return null
  if (conv.buyer_id !== token.userId && conv.seller_id !== token.userId) return null
  return token
}

async function togglePin(
  conv: Conversation,
  accountToken = conversationActionToken(conv),
) {
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  closeSwipe(conv.id)
  try {
    const pinned = conv.buyer_id === accountToken.userId
      ? !!conv.is_pinned_buyer
      : !!conv.is_pinned_seller
    await setConversationPinned(conv, accountToken.userId, !pinned)
    if (!isAccountRequestCurrent(accountToken)) return
    await fetchConversations(accountToken.userId)
  } catch (err: any) {
    if (!isAccountRequestCurrent(accountToken)) return
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleMute(
  conv: Conversation,
  accountToken = conversationActionToken(conv),
) {
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  try {
    const muted = conv.buyer_id === accountToken.userId
      ? !!conv.is_muted_buyer
      : !!conv.is_muted_seller
    await setConversationMuted(conv, accountToken.userId, !muted)
    if (!isAccountRequestCurrent(accountToken)) return
    await refreshUnreadCount()
  } catch (err: any) {
    if (!isAccountRequestCurrent(accountToken)) return
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleRead(
  conv: Conversation,
  accountToken = conversationActionToken(conv),
) {
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  closeSwipe(conv.id)
  try {
    if (unreadConvIds.value.has(conv.id)) {
      await markAsRead(conv.id, accountToken.userId)
    } else {
      await markConversationUnread(conv.id, accountToken.userId)
    }
    if (!isAccountRequestCurrent(accountToken)) return
    await refreshUnreadCount()
  } catch (err: any) {
    if (!isAccountRequestCurrent(accountToken)) return
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  }
}

function onArchive(
  conv: Conversation,
  accountToken = conversationActionToken(conv),
) {
  if (!accountToken || !isAccountRequestCurrent(accountToken)) return
  closeSwipe(conv.id)
  uni.showModal({
    title: t('msg.archiveTitle'),
    content: t('msg.archiveHint'),
    confirmColor: DIALOG_INK,
    success: async (r) => {
      if (!r.confirm || !isAccountRequestCurrent(accountToken)) return
      try {
        await archiveConversation(conv.id)
        if (!isAccountRequestCurrent(accountToken)) return
        uni.showToast({ title: t('msg.archived'), icon: 'success' })
      } catch (err: any) {
        if (!isAccountRequestCurrent(accountToken)) return
        uni.showToast({
          title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.archiveFailed'),
          icon: 'none',
          duration: 2500,
        })
      }
    },
  })
}

function onMoreMenu(conv: Conversation) {
  const accountToken = conversationActionToken(conv)
  if (!accountToken) return
  const items = [
    isPinned(conv) ? t('msg.unpin') : t('msg.pin'),
    isMuted(conv) ? t('msg.unmute') : t('msg.mute'),
    unreadConvIds.value.has(conv.id) ? t('msg.markRead') : t('msg.markUnread'),
    t('msg.archiveConv'),
  ]
  uni.showActionSheet({
    itemList: items,
    success: (res) => {
      if (!isAccountRequestCurrent(accountToken)) return
      if (res.tapIndex === 0) void togglePin(conv, accountToken)
      else if (res.tapIndex === 1) void toggleMute(conv, accountToken)
      else if (res.tapIndex === 2) void toggleRead(conv, accountToken)
      else if (res.tapIndex === 3) onArchive(conv, accountToken)
    },
  })
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-elev-1);
  max-width: 480px; margin: 0 auto; padding-bottom: calc(70px + env(safe-area-inset-bottom, 0px));
}

.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  /* fill + blur + bottom hairline come from .u-glass + .u-glass--hair-b */
  position: sticky; top: 0; z-index: 50;
}
.page-title {
  font-size: 17px; font-weight: 700; color: var(--text-primary);
}

/* ===== Filter chips (v5): 全部 / 未读 / 商品 ===== */
.msg-filters {
  display: flex; gap: 8px;
  padding: 10px 16px;
  background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
}
.mf-chip {
  height: 30px; padding: 0 14px;
  display: inline-flex; align-items: center;
  border-radius: var(--radius-pill);
  background: var(--surface-alt);
  cursor: pointer;
  transition: background var(--dur-1) var(--ease-std), transform var(--dur-1) var(--ease-std);
  .mf-chip-label { font-size: 12.5px; font-weight: 500; color: var(--ink-quiet); line-height: 1; }
  &:active { transform: scale(0.94); }
  &.active {
    background: var(--ink);
    .mf-chip-label { color: var(--ink-inverse); font-weight: 600; }
  }
}
.filtered-empty {
  padding: 48px 16px; text-align: center;
  .filtered-empty-label { font-size: 13px; color: var(--text-muted); }
}

.login-prompt, .empty {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 120px; gap: 10px;
}

.prompt-text { font-size: 14px; color: var(--text-subtle); }
.empty-title { font-size: 16px; color: var(--text-primary); font-weight: 600; }
.empty-sub { font-size: 13px; color: var(--text-subtle); }
.empty-btn {
  margin-top: 18px; padding: 11px 32px;
  background: var(--accent-primary); color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}
.login-btn {
  margin-top: 12px; padding: 10px 36px;
  background: var(--accent-primary); color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}

/*
 * Conversation row chrome (v3 P1 follow-up, dark-mode adaptations).
 *
 * Two fixes in here:
 *   1. Explicit background — without it the .conv-item transform creates
 *      sub-pixel render gaps at the edges, and the absolutely-positioned
 *      .swipe-actions (brand orange / amber / danger red) bleed through
 *      as thin colored lines along the row top/bottom. Pinning conv-row
 *      to --bg-elev-1 (the same color as the resting .conv-item bg)
 *      fills any gap with the matching tone.
 *   2. Divider visibility — --line-hair is rgba(240,232,214,0.06) in
 *      dark, which is essentially invisible on the warm-charcoal canvas.
 *      Switch to --border (0.10α) for a hairline that actually reads
 *      while staying subtle. Light mode also benefits — --border there
 *      is the same neutral beige, just at higher relative contrast.
 */
.conv-skel {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
}
.cs-avatar { width: 50px; height: 50px; border-radius: 50%; flex-shrink: 0; }
.cs-info { flex: 1; display: flex; flex-direction: column; gap: 9px; }
.cs-line { height: 11px; }

.conv-row {
  position: relative; overflow: hidden;
  border-bottom: 0.5px solid var(--border);
}

.conv-item {
  display: flex; align-items: center; padding: 13px 16px;
  gap: 12px; cursor: pointer;
  background: var(--bg-elev-1);
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
  position: relative; z-index: 2;
  &:active { background: var(--bg-elev-2); }
}
.conv-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
  /* Hairline keeps the avatar circle readable even when no fallback
   * image has loaded yet (the default-avatar SVG already has visual
   * contrast against this bg, but the brief pre-load moment was
   * showing as a flat patch in dark). */
  border: 0.5px solid var(--border);
}
.conv-avatar-wrap { position: relative; flex-shrink: 0; }
.conv-info { flex: 1; min-width: 0; }
.conv-top { display: flex; justify-content: space-between; align-items: center; }
.conv-name-wrap { display: flex; align-items: center; gap: 6px; min-width: 0; }
.conv-name {
  font-size: 15px; font-weight: 600; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  &.unread { font-weight: 700; }
}
.pin-badge {
  width: 10px; height: 10px; position: relative; flex-shrink: 0;
  &::before {
    content: ''; position: absolute; top: 0; left: 3px;
    width: 4px; height: 6px; background: var(--warning-text); border-radius: 1px;
  }
  &::after {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 10px; height: 2px; background: var(--warning-text); border-radius: 1px;
  }
}
.mute-badge {
  width: 13px; height: 11px; position: relative; flex-shrink: 0;
  &::before {
    content: ''; position: absolute; top: 1px; left: 0;
    width: 9px; height: 9px;
    border: 1.5px solid var(--ink-faint);
    border-radius: 50% 50% 0 0 / 60% 60% 0 0;
  }
  &::after {
    content: ''; position: absolute; top: 0; right: 0;
    width: 11px; height: 1.5px; background: var(--text-faint);
    transform: rotate(-35deg); transform-origin: center;
  }
}
.unread-dot {
  width: 9px; height: 9px; border-radius: 50%; background: var(--brand);
  flex-shrink: 0; margin-left: 4px;
}
.muted-dot {
  width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint);
  flex-shrink: 0; margin-left: 4px;
}
.conv-time { font-size: 12px; color: var(--text-subtle); flex-shrink: 0; margin-left: 6px; }
.conv-preview {
  font-size: 13px; color: var(--text-subtle); margin-top: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
  &.unread { color: var(--text-primary); font-weight: 600; }
}
.conv-thumb-wrap { position: relative; flex-shrink: 0; }
.conv-thumb {
  width: 42px; height: 42px; border-radius: 7px;
  background: var(--bg-subtle);
}
.thumb-badge {
  position: absolute; bottom: -2px; right: -2px;
  font-size: 8px; font-weight: 700; padding: 1px 4px;
  border-radius: 3px; color: #fff;
  &.sold { background: var(--accent-danger); }
  &.reserved { background: var(--warning-surface); }
}

/*
 * Swipe-action visibility — the real fix for the dark-mode color leak.
 *
 * Per CSS 2.1 Appendix E painting order: a containing block's background
 * paints in layer 0, while positioned descendants (.swipe-actions,
 * position:absolute) paint in layer 7. So adding a background to .conv-row
 * — the previous attempt — could never cover the actions. Only the
 * .conv-item layer (z:2) actually covers them, and any sub-pixel rendering
 * gap (border, anti-aliasing, transform rounding) leaks the brand-orange /
 * amber / danger-red action backgrounds along the row edges.
 *
 * Real fix: keep actions visibility:hidden by default, flip to visible only
 * when the user has actually swiped past a small threshold (-5px). The
 * is-swiped class is computed in the template from swipeOffsets[conv.id].
 * With the actions truly not painting in the resting state, sub-pixel gaps
 * become irrelevant — there's nothing behind .conv-item to leak.
 *
 * The -5px threshold tolerates touch-gesture jitter at swipe-start without
 * flickering the actions visible. No transition on visibility (CSS animates
 * it binarily, not over time) — acceptable because the swipe itself is the
 * perceived animation. z-index: 0 retained so even when visible, conv-item
 * still covers the left portion until the user keeps swiping.
 */
.swipe-actions {
  position: absolute; top: 0; bottom: 0;
  display: flex;
  z-index: 0;
  visibility: hidden;
}
.conv-row.is-swiped .swipe-actions {
  visibility: visible;
}
.swipe-actions.right { right: 0; }
.swipe-actions.left { left: 0; }
.swipe-act {
  display: flex; align-items: center; justify-content: center;
  width: 70px; padding: 0 10px; cursor: pointer;
  .swipe-act-label { font-size: 13px; color: #fff; font-weight: 600; text-align: center; }
}
.act-read { background: var(--brand); }
.act-archive { background: var(--accent-ink); }
.act-pin { background: var(--warning-surface); }

.loading-tip {
  display: flex; align-items: center; justify-content: center;
  padding: 32px; gap: 8px; color: var(--text-subtle); font-size: 13px;
}
.loading-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--text-faint); animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

/* Phones: the thread pane is for the desktop two-pane only. */
.msg-thread-pane { display: none; }

@media (min-width: 768px) {
  .page-header { display: none; }
  /* Two-pane shell: the sidebar rail (.has-sidebar padding-left) + a flex
     row of [conversation list | conversation thread]. Lifts the phone-only
     480px clamp (base .page is max-width:480; margin:0 auto). */
  /* QA6 #2 (round 2): pin the two-pane shell to the viewport so the outer
     uni-page-body can't scroll. .page-lock (App.vue) only locks this <768px;
     desktop had no lock, so wheeling over the right (non-scrollable) pane
     chained the scroll to the wrapper and dragged the whole view (top row
     clipped, filter chips scrolled off). Out-of-flow fixed page → the body
     has nothing to scroll; only .msg-left scrolls internally. Same proven
     pattern as .page-lock and the plaza desktop lock. */
  .page {
    position: fixed; inset: 0; left: var(--sidebar-w, 240px);
    padding: 0; margin: 0; max-width: none;
    display: flex; overflow: hidden;
  }
  .msg-left {
    width: 340px; flex: none; height: 100vh; overflow-y: auto;
    border-right: 1px solid var(--border); box-sizing: border-box;
    /* Keep wheel scroll inside the rail — without this, hitting the top/bottom
       chains the scroll to the page and drags the whole two-pane view (QA6 #2). */
    overscroll-behavior: contain;
  }
  /* Pin the filter chips so only the conversation list scrolls beneath them
     (QA6 #2). .msg-filters already has an opaque background, so rows don't
     show through the pinned bar. */
  .msg-filters { position: sticky; top: 0; z-index: 5; }
  .conv-list { max-width: none; margin: 0; }
  .conv-item {
    border-radius: 8px; margin: 2px 8px;
    &:hover { background: var(--bg-elev-2); }
    &.active, &.active:hover { background: var(--brand-soft); }
  }
  /* Right pane — the embedded ChatThread, or an empty hint. overflow:hidden so
     the pane itself never scrolls (ChatThread owns its own message scroll-view);
     keeps the left rail and right thread scrolling independently (QA6 #2). */
  .msg-thread-pane { display: block; flex: 1; min-width: 0; height: 100vh; overflow: hidden; }
  .thread-empty {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px;
    background: var(--canvas);
  }
  .te-text { font-size: 14px; color: var(--ink-quiet); }
}
</style>
