<template>
  <view class="page has-sidebar">
    <AppSidebar current="messages" />

    <view class="page-header">
      <text class="page-title">{{ t('nav.messages') }}</text>
    </view>

    <!-- Left column: filters + conversation list. Becomes a fixed-width
         rail in the desktop two-pane; full width on phones. -->
    <view class="msg-left">
    <!-- Filter chips (v5 kit: 全部 / 未读 / 商品) — client-side filter. -->
    <view v-if="isLoggedIn && conversations.length > 0" class="msg-filters">
      <view
        v-for="f in msgFilters"
        :key="f.key"
        :class="['mf-chip', { active: msgFilter === f.key }]"
        role="tab"
        :aria-selected="msgFilter === f.key"
        @click="msgFilter = f.key"
      >
        <text>{{ f.label }}</text>
      </view>
    </view>

    <view v-if="!isLoggedIn" class="login-prompt">
      <view class="prompt-icon">
        <view class="pi-bubble"></view>
      </view>
      <text class="prompt-text">{{ t('msg.signIn') }}</text>
      <view class="login-btn" @click="goLogin">{{ t('profile.signIn') }}</view>
    </view>

    <view v-else-if="conversations.length === 0 && !loading" class="empty">
      <view class="empty-icon">
        <view class="ei-bubble"></view>
      </view>
      <text class="empty-title">{{ t('msg.empty') }}</text>
      <text class="empty-sub">{{ t('msg.emptySub') }}</text>
    </view>

    <view v-else class="conv-list">
      <view v-if="visibleConversations.length === 0" class="filtered-empty">
        <text>{{ t('msg.noFiltered') }}</text>
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
          @click="onItemTap(conv)"
          @longpress="onMoreMenu(conv)"
        >
          <view class="conv-avatar-wrap">
            <image
              :src="getOtherUser(conv)?.avatar_url || defaultAvatar"
              :alt="getOtherUser(conv)?.nickname || 'avatar'"
              class="conv-avatar"
              mode="aspectFill"
            />
            <view v-if="isOnline(getOtherUser(conv)?.id)" class="online-dot" :aria-label="t('chat.online')"></view>
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
             even at a partial swipe; delete is farthest from the thumb
             so it's harder to trigger by accident. -->
        <view class="swipe-actions right">
          <view class="swipe-act act-pin" @click="togglePin(conv)">
            <text>{{ isPinned(conv) ? t('msg.unpin') : t('msg.pin') }}</text>
          </view>
          <view class="swipe-act act-read" @click="toggleRead(conv)">
            <text>{{ unreadConvIds.has(conv.id) ? t('msg.markRead') : t('msg.markUnread') }}</text>
          </view>
          <view class="swipe-act act-delete" @click="onDelete(conv)">
            <text>{{ t('profile.delete') }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="loading-tip">
      <view class="loading-dot"></view>
      <text>{{ t('msg.loading') }}</text>
    </view>
    </view><!-- /.msg-left -->

    <!-- Desktop two-pane (≥768px): the selected conversation's thread,
         embedded. Hidden on phones, where tapping navigates to /chat. -->
    <view class="msg-thread-pane">
      <ChatThread
        v-if="selectedConvId"
        :key="selectedConvId"
        :conversation-id="selectedConvId"
        embedded
      />
      <view v-else class="thread-empty">
        <view class="te-bubble"></view>
        <text class="te-text">{{ t('msg.selectHint') }}</text>
      </view>
    </view>
    <CustomTabBar current="messages" />
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { onShow, onPullDownRefresh, onUnload } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useMessages } from '../../composables/useMessages'
import { useUnread } from '../../composables/useUnread'
import { usePresence } from '../../composables/usePresence'
import { useTheme } from '../../composables/useTheme'
import { formatTime, thumbUrl } from '../../utils'
import { DIALOG_DANGER } from '../../utils/dialogColors'
import type { Conversation, Profile } from '../../types'
import AppSidebar from '../../components/AppSidebar.vue'
import ChatThread from '../../components/ChatThread.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import { parseStickerToken } from '../../components/stickers/registry'

const { t, localize } = useI18n()

const { currentUser, isLoggedIn } = useAuth()
const {
  conversations,
  loading,
  fetchConversations,
  deleteConversation,
  setConversationPinned,
  setConversationMuted,
  markAsRead,
  markConversationUnread,
  clearMessages,
} = useMessages()
const { unreadConvIds, refreshUnreadCount } = useUnread()
const { startPresence, isOnline } = usePresence()
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

// Desktop two-pane (≥768px): tapping a conversation opens it in the right
// pane (ChatThread embedded) instead of pushing the chat route. Phones keep
// navigating. isWide flips on resize so dragging a desktop window across the
// breakpoint switches behaviour live.
const selectedConvId = ref('')
const isWide = ref(false)
function detectWide() {
  try { isWide.value = uni.getSystemInfoSync().windowWidth >= 768 } catch {}
}
onMounted(() => {
  detectWide()
  try {
    const onResize = (uni as any).onWindowResize
    if (typeof onResize === 'function') {
      onResize((res: { size: { windowWidth: number } }) => { isWide.value = res.size.windowWidth >= 768 })
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

onShow(() => {
  detectWide()
  if (currentUser.value) {
    fetchConversations(currentUser.value.id)
    refreshUnreadCount()
    startPresence()
  }
})

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

async function togglePin(conv: Conversation) {
  if (!currentUser.value) return
  closeSwipe(conv.id)
  try {
    await setConversationPinned(conv, currentUser.value.id, !isPinned(conv))
    await fetchConversations(currentUser.value.id)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleMute(conv: Conversation) {
  if (!currentUser.value) return
  try {
    await setConversationMuted(conv, currentUser.value.id, !isMuted(conv))
    await refreshUnreadCount()
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleRead(conv: Conversation) {
  if (!currentUser.value) return
  closeSwipe(conv.id)
  try {
    if (unreadConvIds.value.has(conv.id)) {
      await markAsRead(conv.id, currentUser.value.id)
    } else {
      await markConversationUnread(conv.id, currentUser.value.id)
    }
    await refreshUnreadCount()
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

function onDelete(conv: Conversation) {
  closeSwipe(conv.id)
  uni.showModal({
    title: t('msg.deleteTitle'),
    content: t('msg.deleteHint'),
    confirmColor: DIALOG_DANGER,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await deleteConversation(conv.id)
        uni.showToast({ title: t('msg.deleted'), icon: 'success' })
      } catch (err: any) {
        uni.showToast({
          title: err?.message || t('msg.deleteFailed'),
          icon: 'none',
          duration: 2500,
        })
      }
    },
  })
}

function onMoreMenu(conv: Conversation) {
  const items = [
    isPinned(conv) ? t('msg.unpin') : t('msg.pin'),
    isMuted(conv) ? t('msg.unmute') : t('msg.mute'),
    unreadConvIds.value.has(conv.id) ? t('msg.markRead') : t('msg.markUnread'),
    t('msg.deleteConv'),
  ]
  uni.showActionSheet({
    itemList: items,
    success: (res) => {
      if (res.tapIndex === 0) togglePin(conv)
      else if (res.tapIndex === 1) toggleMute(conv)
      else if (res.tapIndex === 2) toggleRead(conv)
      else if (res.tapIndex === 3) onDelete(conv)
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
  max-width: 480px; margin: 0 auto; padding-bottom: 76px;
}

.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
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
  text { font-size: 12.5px; font-weight: 500; color: var(--ink-quiet); line-height: 1; }
  &:active { transform: scale(0.94); }
  &.active {
    background: var(--ink);
    text { color: var(--ink-inverse); font-weight: 600; }
  }
}
.filtered-empty {
  padding: 48px 16px; text-align: center;
  text { font-size: 13px; color: var(--text-muted); }
}

.login-prompt, .empty {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 120px; gap: 10px;
}

.prompt-icon, .empty-icon {
  width: 52px; height: 52px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
}
.pi-bubble, .ei-bubble {
  width: 36px; height: 28px; border: 2.5px solid var(--border-strong);
  border-radius: 16px 16px 16px 4px; position: relative;
  &::before {
    content: ''; position: absolute; top: 8px; left: 7px;
    width: 4px; height: 4px; border-radius: 50%; background: var(--border-strong);
  }
  &::after {
    content: ''; position: absolute; top: 8px; left: 15px;
    width: 4px; height: 4px; border-radius: 50%; background: var(--border-strong);
  }
}
.prompt-text { font-size: 14px; color: var(--text-faint); }
.empty-title { font-size: 16px; color: var(--text-primary); font-weight: 600; }
.empty-sub { font-size: 13px; color: var(--text-faint); }
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
/* Presence dot (v5 Phase 7) — sage-green, sits over the avatar's bottom-right
   with a paper-colored ring so it reads as a status pip, not part of the photo. */
.conv-avatar-wrap { position: relative; flex-shrink: 0; }
.online-dot {
  position: absolute; right: 0; bottom: 2px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--success);
  border: 2px solid var(--bg-elev-1);
}
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
    width: 4px; height: 6px; background: var(--accent-warn); border-radius: 1px;
  }
  &::after {
    content: ''; position: absolute; bottom: 0; left: 0;
    width: 10px; height: 2px; background: var(--accent-warn); border-radius: 1px;
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
.conv-time { font-size: 12px; color: var(--text-faint); flex-shrink: 0; margin-left: 6px; }
.conv-preview {
  font-size: 13px; color: var(--text-faint); margin-top: 4px;
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
  &.reserved { background: var(--accent-warn); }
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
  text { font-size: 13px; color: #fff; font-weight: 600; text-align: center; }
}
.act-read { background: var(--brand); }
.act-delete { background: var(--accent-danger); }
.act-pin { background: var(--accent-warn); }

.loading-tip {
  display: flex; align-items: center; justify-content: center;
  padding: 32px; gap: 8px; color: var(--text-faint); font-size: 13px;
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
  .page { padding-bottom: 0; max-width: none; margin: 0; display: flex; height: 100vh; overflow: hidden; }
  .msg-left {
    width: 340px; flex: none; height: 100vh; overflow-y: auto;
    border-right: 1px solid var(--border); box-sizing: border-box;
  }
  .conv-list { max-width: none; margin: 0; }
  .conv-item {
    border-radius: 8px; margin: 2px 8px;
    &:hover { background: var(--bg-elev-2); }
    &.active, &.active:hover { background: var(--brand-soft); }
  }
  /* Right pane — the embedded ChatThread, or an empty hint. */
  .msg-thread-pane { display: block; flex: 1; min-width: 0; height: 100vh; }
  .thread-empty {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px;
    background: var(--canvas);
  }
  .te-bubble {
    width: 48px; height: 48px; border-radius: 14px 14px 14px 4px;
    border: 2px solid var(--border-strong); opacity: 0.7;
  }
  .te-text { font-size: 14px; color: var(--ink-quiet); }
}
</style>
