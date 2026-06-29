<template>
  <view class="chat-thread" :class="{ embedded }">
    <!-- Header with item context -->
    <view class="chat-header u-glass u-glass--hair-b">
      <view v-if="!embedded" class="ch-back" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <view class="ch-arrow"></view>
      </view>
      <view class="ch-info" v-if="itemInfo">
        <text class="ch-name">{{ otherUserName }}</text>
        <text v-if="headerStatus" :class="['ch-status', { typing: peerTyping }]">{{ headerStatus }}</text>
        <text v-else class="ch-item-title">{{ localize(itemInfo.title_i18n, itemInfo.title) }}</text>
      </view>
      <text v-else class="ch-name-only">{{ otherUserName || t('nav.messages') }}</text>
      <view class="ch-more" role="button" :aria-label="t('a11y.conversationMore')" @click="onMoreActions">
        <view class="more-dot"></view><view class="more-dot"></view><view class="more-dot"></view>
      </view>
    </view>

    <!-- Item Context Card -->
    <view class="item-card" v-if="itemInfo" @click="goToItem">
      <image
        :src="itemInfo.images?.[0] || '/static/placeholder.svg'"
        :alt="localize(itemInfo.title_i18n, itemInfo.title)"
        class="ic-img"
        mode="aspectFill"
      />
      <view class="ic-info">
        <text class="ic-title">{{ localize(itemInfo.title_i18n, itemInfo.title) }}</text>
        <view class="ic-bottom">
          <text v-if="itemInfo.listing_type === 'wanted'" class="u-wanted-tag">{{ t('item.wanted') }}</text>
          <text class="ic-price">{{ listingPriceLabel(itemInfo, t) }}</text>
          <text v-if="itemInfo.status === 'sold'" class="ic-sold">{{ t('status.sold') }}</text>
          <text v-else-if="itemInfo.status === 'reserved'" class="ic-reserved">{{ t('status.reserved') }}</text>
        </view>
      </view>
      <view class="ic-arrow"></view>
    </view>

    <view
      v-if="itemInfo && itemInfo.status === 'active'"
      class="offer-bar"
    >
      <view
        v-if="itemInfo.negotiable && currentUser?.id !== itemInfo.user_id"
        class="offer-btn"
        @click="openOfferSheet"
      >
        <text>{{ t('chat.makeOffer') }}</text>
      </view>
      <view :class="['meetup-btn', { disabled: hasPendingMeetup }]" @click="openMeetupSheet">
        <text>📍 {{ t('chat.proposeMeetup') }}</text>
      </view>
    </view>

    <scroll-view
      v-if="messages.length === 0 && itemInfo && itemInfo.status === 'active' && currentUser?.id !== itemInfo.user_id"
      scroll-x
      class="quick-replies"
    >
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrStillAvailable'))">{{ t('chat.qrStillAvailable') }}</view>
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrLowerPrice'))">{{ t('chat.qrLowerPrice') }}</view>
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrWhenMeet'))">{{ t('chat.qrWhenMeet') }}</view>
      <view class="qr-chip" @click="sendQuickReply(t('chat.qrMoreDetails'))">{{ t('chat.qrMoreDetails') }}</view>
    </scroll-view>

    <scroll-view
      class="message-list"
      scroll-y
      :show-scrollbar="false"
      :scroll-into-view="scrollTarget"
      scroll-with-animation
      @click="onMessageAreaTap"
    >
      <template v-for="(entry, idx) in timeline" :key="entry.key">
        <view v-if="shouldShowTimeAt(idx)" class="time-divider">
          <text>{{ formatChatTime(entry.created_at) }}</text>
        </view>

        <!-- ===== Offer entry (structured negotiation, migration 051) ===== -->
        <template v-if="entry.kind === 'offer'">
          <view :id="entry.key" class="offer-entry" :class="{ mine: entry.offer.from_user === currentUser?.id }">
            <view class="offer-card" :class="'oc-st-' + entry.offer.status">
              <view class="oc-head">
                <text class="oc-eyebrow">{{ entry.offer.from_user === currentUser?.id ? t('chat.offerYou') : t('chat.offerThem') }}</text>
                <text class="oc-status">{{ offerStatusLabel(entry.offer) }}</text>
              </view>
              <text class="oc-price">${{ fmtOfferPrice(entry.offer.price) }}</text>
              <text v-if="entry.offer.note" class="oc-note">{{ entry.offer.note }}</text>
              <view v-if="entry.offer.status === 'pending' && offerIncoming(entry.offer) && !offerExpired(entry.offer)" class="oc-actions">
                <view class="oc-btn oc-decline" @click="declineOffer(entry.offer)"><text>{{ t('chat.offerDecline') }}</text></view>
                <view class="oc-btn oc-counter" @click="openCounter(entry.offer)"><text>{{ t('chat.offerCounter') }}</text></view>
                <view class="oc-btn oc-accept" @click="acceptOffer(entry.offer)"><text>{{ t('chat.offerAccept') }}</text></view>
              </view>
              <text v-else-if="entry.offer.status === 'pending'" class="oc-meta">
                {{ offerExpired(entry.offer) ? t('chat.offerExpired') : t('chat.offerWaiting') }}
              </text>
              <text v-if="entry.offer.status === 'pending' && !offerExpired(entry.offer)" class="oc-expiry">{{ t('chat.offerExpiry') }}</text>
            </view>
          </view>
          <view v-if="entry.offer.status === 'accepted'" class="deal-line">
            <text>🎉 {{ t('chat.dealReached').replace('{price}', '$' + fmtOfferPrice(entry.offer.price)) }}</text>
          </view>
        </template>

        <!-- ===== Meetup entry (structured scheduling, migration 052) ===== -->
        <template v-else-if="entry.kind === 'meetup'">
          <view :id="entry.key" class="offer-entry" :class="{ mine: entry.meetup.from_user === currentUser?.id }">
            <view class="offer-card meetup-card" :class="'oc-st-' + entry.meetup.status">
              <view class="oc-head">
                <text class="oc-eyebrow">📍 {{ entry.meetup.from_user === currentUser?.id ? t('chat.meetupYou') : t('chat.meetupThem') }}</text>
                <text class="oc-status">{{ meetupStatusLabel(entry.meetup) }}</text>
              </view>
              <text class="mc-spot">{{ meetupSpotLabel(entry.meetup) }}</text>
              <text class="mc-when">{{ fmtMeetupWhen(entry.meetup.meet_at) }}</text>
              <text v-if="entry.meetup.note" class="oc-note">{{ entry.meetup.note }}</text>
              <view v-if="entry.meetup.status === 'pending' && meetupIncoming(entry.meetup) && !meetupExpired(entry.meetup)" class="oc-actions">
                <view class="oc-btn oc-decline" @click="declineMeetup(entry.meetup)"><text>{{ t('chat.meetupDecline') }}</text></view>
                <view class="oc-btn oc-counter" @click="openReschedule(entry.meetup)"><text>{{ t('chat.meetupReschedule') }}</text></view>
                <view class="oc-btn oc-accept" @click="acceptMeetup(entry.meetup)"><text>{{ t('chat.meetupAccept') }}</text></view>
              </view>
              <text v-else-if="entry.meetup.status === 'pending'" class="oc-meta">
                {{ meetupExpired(entry.meetup) ? t('chat.meetupExpired') : t('chat.meetupWaiting') }}
              </text>
              <text v-if="entry.meetup.status === 'pending' && !meetupExpired(entry.meetup)" class="oc-expiry">{{ t('chat.meetupExpiry') }}</text>
            </view>
          </view>
          <view v-if="entry.meetup.status === 'accepted'" class="deal-line">
            <text>🤝 {{ t('chat.meetupSet').replace('{spot}', meetupSpotLabel(entry.meetup)).replace('{when}', fmtMeetupWhen(entry.meetup.meet_at)) }}</text>
            <text class="deal-reschedule" role="button" @click="openRescheduleAccepted(entry.meetup)">{{ t('chat.meetupReschedule') }}</text>
          </view>
        </template>

        <!-- ===== Message entry ===== -->
        <template v-else>
          <view
            :id="entry.key"
            :class="['msg-row', { mine: entry.msg.sender_id === currentUser?.id }]"
          >
            <image
              v-if="entry.msg.sender_id !== currentUser?.id"
              :src="entry.msg.sender?.avatar_url || defaultAvatar"
              :alt="entry.msg.sender?.nickname || 'avatar'"
              class="msg-avatar"
            />
            <!-- Sticker message: whole body is one [sticker:*] token — bare
                 artwork, no bubble chrome (WeChat sticker semantics). -->
            <view
              v-if="stickerOf(entry.msg)"
              class="msg-sticker"
              @touchstart="msgLongPress.onTouchstart(entry.msg)"
              @touchend="msgLongPress.onTouchend"
              @touchcancel="msgLongPress.onTouchcancel"
              @touchmove="msgLongPress.onTouchmove"
            >
              <USticker :name="stickerOf(entry.msg)!" :size="84" />
            </view>
            <view
              class="msg-bubble"
              v-else-if="entry.msg.message_type !== 'image' && entry.msg.message_type !== 'video'"
              @touchstart="msgLongPress.onTouchstart(entry.msg)"
              @touchend="msgLongPress.onTouchend"
              @touchcancel="msgLongPress.onTouchcancel"
              @touchmove="msgLongPress.onTouchmove"
            >
              <text>{{ entry.msg.content }}</text>
            </view>
            <image
              v-else-if="entry.msg.message_type === 'image'"
              :src="entry.msg.content"
              alt="Photo"
              class="msg-image"
              mode="widthFix"
              lazy-load
              @click="previewImg(entry.msg.content)"
              @touchstart="msgLongPress.onTouchstart(entry.msg)"
              @touchend="msgLongPress.onTouchend"
              @touchcancel="msgLongPress.onTouchcancel"
              @touchmove="msgLongPress.onTouchmove"
            />
            <!-- 私信视频 (migration 048) — native controls; no autoplay so a
                 scroll through history doesn't start playback. -->
            <video
              v-else
              :src="entry.msg.content"
              class="msg-video"
              controls
              :show-fullscreen-btn="true"
              object-fit="contain"
            />
            <image
              v-if="entry.msg.sender_id === currentUser?.id"
              :src="currentUser?.avatar_url || defaultAvatar"
              :alt="currentUser?.nickname || 'avatar'"
              class="msg-avatar"
            />
          </view>
          <view v-if="entry.msg.sender_id === currentUser?.id && entry.msg._pending" class="msg-status pending">
            <text>{{ t('chat.sending') }}</text>
          </view>
          <view v-else-if="entry.msg.sender_id === currentUser?.id && entry.msg._failed" class="msg-status failed" @click="retrySend(entry.msg)">
            <text>{{ t('chat.sendFailed') }}</text>
          </view>
        </template>
      </template>

      <view v-if="timeline.length === 0" class="empty-chat">
        <view class="ec-icon">
          <view class="ec-wave"></view>
        </view>
        <text>{{ t('chat.empty') }}</text>
      </view>
    </scroll-view>

    <view v-if="replyToMsg" class="reply-ctx">
      <view class="rc-bar"></view>
      <view class="rc-body">
        <text class="rc-label">{{ t('chat.replyingTo') }}</text>
        <text class="rc-text">{{ replyPreview(replyToMsg).slice(0, 80) }}</text>
      </view>
      <view class="rc-x" role="button" :aria-label="t('a11y.close')" @click="replyToMsg = null">
        <UIcon name="close" size="xs" color="accent-action" />
      </view>
    </view>

    <!-- 键盘联想 (P3): typed keyword tail → emoji quick-insert chips.
         Appends to the input; never replaces typed text. -->
    <view v-if="emojiSuggestions.length" class="suggest-row" :style="kbLift">
      <view
        v-for="e in emojiSuggestions"
        :key="e"
        class="suggest-chip"
        role="button"
        :aria-label="e"
        @click="applySuggestion(e)"
      >
        <text class="suggest-emoji">{{ e }}</text>
      </view>
    </view>

    <view class="input-bar" :style="kbLift">
      <view class="img-btn" role="button" :aria-label="t('a11y.pickImage')" :title="t('a11y.pickImage')" @click="onSendImage">
        <UIcon name="image" size="sm" color="text-secondary" />
      </view>
      <view class="img-btn" role="button" :aria-label="t('a11y.pickVideo')" :title="t('a11y.pickVideo')" @click="onSendVideo">
        <UIcon name="video" size="sm" color="text-secondary" />
      </view>
      <view :class="['emoji-btn', { active: emojiOpen }]" role="button" :aria-label="t('a11y.emojiToggle')" :title="t('a11y.emojiToggle')" @click="toggleEmoji">
        <text class="emoji-btn-glyph">😊</text>
      </view>
      <textarea
        ref="chatInputRef"
        v-model="inputText"
        :placeholder="replyToMsg ? t('chat.replyingHint') : t('chat.placeholder')"
        confirm-type="send"
        :confirm-hold="false"
        :show-confirm-bar="false"
        auto-height
        :maxlength="-1"
        :focus="inputFocused"
        :adjust-position="false"
        :cursor-spacing="8"
        @confirm="onSend"
        @keydown="onComposerKeydown"
        @focus="emojiOpen = false"
        @blur="inputFocused = false"
        class="msg-input"
      />
      <view :class="['send-btn', { disabled: !inputText.trim() || sending }]" role="button" :aria-label="t('a11y.sendMessage')" :title="t('a11y.sendMessage')" @click="onSend">
        <UIcon name="send" size="sm" color="#fff" />
        <text class="send-label">{{ t('chat.send') }}</text>
      </view>
    </view>
    <ChatEmojiPanel :open="emojiOpen" @pick="onPickEmoji" @pick-sticker="onPickSticker" />

    <!-- Offer composer (new offer + counter) -->
    <view v-if="offerSheet.open" class="offer-mask u-mask-in" @click="closeOfferSheet"></view>
    <view :class="['offer-sheet', { open: offerSheet.open }]" :style="sheetLift(offerSheet.open)">
      <view class="os-handle"></view>
      <text class="os-title">{{ offerSheet.mode === 'counter' ? t('chat.offerCounterTitle') : t('chat.offerTitle') }}</text>
      <text v-if="itemInfo" class="os-ref">{{ localize(itemInfo.title_i18n, itemInfo.title) }} · {{ t('chat.offerListPrice') }} {{ listingPriceLabel(itemInfo, t) }}</text>
      <view class="os-input-row">
        <text class="os-dollar">$</text>
        <input v-model="offerPriceInput" type="digit" class="os-input" :placeholder="t('chat.offerPricePh')" />
      </view>
      <scroll-view v-if="quickAmounts.length" scroll-x class="os-quick">
        <view v-for="a in quickAmounts" :key="a" class="os-quick-chip" @click="offerPriceInput = String(a)">
          <text>${{ a }}</text>
        </view>
      </scroll-view>
      <input v-model="offerNoteInput" class="os-note" :placeholder="t('chat.offerNotePh')" maxlength="300" />
      <view :class="['os-submit', { disabled: !Number(offerPriceInput) || offerSubmitting }]" @click="submitOfferSheet">
        <text>{{ offerSheet.mode === 'counter' ? t('chat.offerSendCounter') : t('chat.offerSend') }}</text>
      </view>
      <text class="os-expiry-hint">{{ t('chat.offerExpiry') }}</text>
    </view>

    <!-- Meetup composer (propose + reschedule) -->
    <view v-if="meetupSheet.open" class="offer-mask u-mask-in" @click="closeMeetupSheet"></view>
    <view :class="['offer-sheet', { open: meetupSheet.open }]" :style="sheetLift(meetupSheet.open)">
      <view class="os-handle"></view>
      <text class="os-title">{{ meetupSheet.mode !== 'new' ? t('chat.meetupRescheduleTitle') : t('chat.meetupTitle') }}</text>
      <text class="mt-label">{{ t('chat.meetupSpot') }}</text>
      <scroll-view scroll-x class="os-quick mt-spots">
        <view
          v-for="s in safeSpots"
          :key="s.id"
          :class="['os-quick-chip', { on: meetupSpotInput === (lang === 'zh' ? s.zh : s.en) }]"
          @click="meetupSpotInput = (lang === 'zh' ? s.zh : s.en)"
        >
          <text>{{ lang === 'zh' ? s.zh : s.en }}</text>
        </view>
      </scroll-view>
      <!-- Free-text spot (#6d): chips are quick-fills; a custom value just
           leaves all chips unhighlighted. Kept ABOVE the date/time pickers so
           neither text field sits under uni's lingering picker overlay (#6b). -->
      <input v-model="meetupSpotInput" class="os-note mt-spot-input" :placeholder="t('chat.meetupSpotPh')" maxlength="60" :adjust-position="false" />
      <input v-model="meetupNoteInput" class="os-note" :placeholder="t('chat.offerNotePh')" maxlength="300" :adjust-position="false" />
      <view class="mt-row">
        <view class="mt-cell">
          <picker mode="date" :value="meetupDateInput" :start="todayStr" :end="maxDateStr" @change="meetupDateInput = $event.detail.value">
            <view class="mt-picker"><text>{{ meetupDateInput || t('chat.meetupPickDate') }}</text></view>
          </picker>
        </view>
        <view class="mt-cell">
          <picker mode="time" :value="meetupTimeInput" @change="meetupTimeInput = $event.detail.value">
            <view class="mt-picker"><text>{{ meetupTimeInput || t('chat.meetupPickTime') }}</text></view>
          </picker>
        </view>
      </view>
      <text class="mt-safe-hint">{{ t('chat.meetupSafeHint') }}</text>
      <view :class="['os-submit', { disabled: !meetupSpotInput || !meetupDateInput || !meetupTimeInput || meetupSubmitting }]" @click="submitMeetupSheet">
        <text>{{ meetupSheet.mode !== 'new' ? t('chat.meetupSendReschedule') : t('chat.meetupSend') }}</text>
      </view>
      <text class="os-expiry-hint">{{ t('chat.meetupExpiry') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useTheme } from '../composables/useTheme'
import { useMessages } from '../composables/useMessages'
import { useOffers } from '../composables/useOffers'
import { useMeetups } from '../composables/useMeetups'
import { CAMPUS_SPOTS, localizeLocation, matchSpot } from '../composables/useCampusSpots'
import { usePresence } from '../composables/usePresence'
import { useItems } from '../composables/useItems'
import { useUnread } from '../composables/useUnread'
import { useI18n } from '../composables/useI18n'
import { useModeration } from '../composables/useModeration'
import { useLongPress } from '../composables/useLongPress'
import { useKeyboardHeight } from '../composables/useKeyboardHeight'
import { listingPriceLabel, friendlyErrorMessage } from '../utils'
import { DIALOG_DANGER } from '../utils/dialogColors'
import { captureException } from '../utils/sentry'
import type { Item, Offer, Meetup } from '../types'
import ChatEmojiPanel from './ChatEmojiPanel.vue'
import UIcon from './UIcon.vue'
import USticker from './USticker.vue'
import { parseStickerToken, stickerToken, type StickerName } from './stickers/registry'
import { suggestEmoji } from '../composables/useEmojiSuggest'

const props = defineProps<{ conversationId: string; prefill?: string; embedded?: boolean }>()

const { t, lang, localize } = useI18n()

const { currentUser, requireAuth } = useAuth()
const { messages, fetchMessages, sendMessage, subscribeToMessages, markAsRead, deleteMessage, fetchConversationDetail, setConversationPinned, setConversationMuted } = useMessages()
const { offers, fetchOffers, makeOffer, respondToOffer, subscribeToOffers } = useOffers()
const { meetups, fetchMeetups, proposeMeetup, respondToMeetup, rescheduleAccepted, subscribeToMeetups } = useMeetups()
const { startPresence, isOnline, subscribeTyping } = usePresence()
const { uploadOneImage, uploadOneVideo } = useItems()
const { refreshUnreadCount } = useUnread()
const { reportTarget, blockUser } = useModeration()
const { isDark } = useTheme()

// Soft-keyboard avoidance (mirrors the plaza composer): lift the footer +
// the offer/meetup sheets above the keyboard so their inputs stay visible on
// iOS H5 (where a bottom-anchored flex child sits behind the keyboard) and
// mp-weixin. The composer textarea sets adjust-position=false so this transform
// is the single source of lift — no double-jump on mp.
const kb = useKeyboardHeight()
const kbLift = computed(() => (kb.height.value ? { transform: `translateY(-${kb.height.value}px)` } : undefined))
const sheetLift = (open: boolean) => (open && kb.height.value ? { transform: `translateY(-${kb.height.value}px)` } : undefined)

/*
 * Theme-aware avatar fallback (v3 P1, spec §1.4).
 *
 * Both the incoming-message avatar (sender) and outgoing-message
 * avatar (current user) fall back to default-avatar.svg when no
 * avatar_url is set. The light SVG glares on dark canvas — see
 * messages/index.vue for the full rationale.
 */
const defaultAvatar = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)

const inputText = ref('')
const chatInputRef = ref<any>(null)
const emojiOpen = ref(false)
/*
 * inputFocused drives the uni-app `<input :focus>` binding so we can
 * programmatically refocus after onSend. The contract:
 *   · Default false on mount — chat shouldn't grab focus over scrollback
 *     the moment the user lands on the page
 *   · Toggle false → nextTick → true to re-trigger focus after a
 *     successful send (uni-app's :focus is edge-triggered on the
 *     false→true transition, not level-triggered on identity)
 *   · @blur resets to false so the next send-cycle's toggle is a real
 *     transition, not a no-op
 *   · toggleEmoji also clears it so opening the emoji panel doesn't
 *     race with the focus binding to keep the keyboard up
 *
 * The earlier H5-only native.focus() (commit a395107) didn't reliably
 * re-engage the keyboard on iOS Safari because focus() outside the
 * user-gesture stack is silently ignored. The :focus prop is the
 * canonical uni-app surface for this and works on both H5 and mp.
 */
const inputFocused = ref(false)
const replyToMsg = ref<any>(null)
const scrollTarget = ref('')
const conversationId = ref('')
const itemInfo = ref<Item | null>(null)
const otherUserName = ref('')
const otherUserId = ref('')
const conversationDetail = ref<any>(null)
const convPinned = ref(false)
const convMuted = ref(false)
let unsubscribe: (() => void) | null = null
let offersUnsub: (() => void) | null = null
let meetupsUnsub: (() => void) | null = null
// #ifdef H5
// Re-fetch when the tab is re-foregrounded. Realtime is a known-weak channel
// and H5 has no polling fallback, so a socket that died (CHANNEL_ERROR / proxy
// / backgrounded tab) silently stops delivering inserts with no recovery. A
// foreground heal recovers any window missed while the socket was degraded.
let onVisible: (() => void) | null = null
// #endif

// Presence + typing (v5 Phase 7, H5 best-effort).
const peerTyping = ref(false)
let typingApi: { sendTyping: () => void; unsubscribe: () => void } | null = null
let typingClear: ReturnType<typeof setTimeout> | null = null
const headerStatus = computed(() => {
  if (peerTyping.value) return t('chat.typing')
  if (isOnline(otherUserId.value)) return t('chat.onlineReply')
  return ''
})
watch(inputText, (v) => { if (v && typingApi) typingApi.sendTyping() })

onMounted(async () => {
  if (!requireAuth()) return
  const options = { id: props.conversationId, prefill: props.prefill }

  if (options?.id) {
    conversationId.value = options.id
    await fetchMessages(options.id)
    try { await fetchOffers(options.id) } catch { /* offers are additive — never block the chat */ }
    try { await fetchMeetups(options.id) } catch { /* meetups are additive — never block the chat */ }
    scrollToBottom()

    if (currentUser.value) {
      await markAsRead(options.id, currentUser.value.id)
      refreshUnreadCount()
    }

    if (options.prefill && messages.value.length === 0) {
      try { inputText.value = decodeURIComponent(options.prefill as string) } catch {}
    }

    try {
      const detail = await fetchConversationDetail(options.id)
      if (detail) {
        conversationDetail.value = detail
        if (detail.item) {
          itemInfo.value = detail.item
        }
        if (currentUser.value) {
          const other = detail.buyer_id === currentUser.value.id ? detail.seller : detail.buyer
          otherUserName.value = other?.nickname || t('app.user')
          otherUserId.value = other?.id || ''
          const isBuyer = detail.buyer_id === currentUser.value.id
          convPinned.value = isBuyer ? !!detail.is_pinned_buyer : !!detail.is_pinned_seller
          convMuted.value = isBuyer ? !!detail.is_muted_buyer : !!detail.is_muted_seller
        }
      }
    } catch {
      uni.showToast({ title: t('chat.fail'), icon: 'none' })
    }

    unsubscribe = subscribeToMessages(options.id, (newMsg) => {
      // Idempotent: a reconnect replay, or our own optimistic push in onSend,
      // can deliver a row we already hold — never render it twice.
      if (messages.value.some(m => m.id === newMsg.id)) return
      // The realtime payload.new carries no sender join, so an incoming peer
      // message would render with the default avatar. Hydrate from the peer
      // profile we already resolved (conversationDetail) so it's right on the
      // first live paint, not only after the foreground-heal refetch.
      if (currentUser.value && newMsg.sender_id !== currentUser.value.id && !newMsg.sender) {
        const d = conversationDetail.value
        const peer = d && (d.buyer_id === currentUser.value.id ? d.seller : d.buyer)
        if (peer) (newMsg as any).sender = { id: peer.id, nickname: peer.nickname, avatar_url: peer.avatar_url }
      }
      messages.value.push(newMsg)
      nextTick(() => scrollToBottom())
      if (currentUser.value && newMsg.sender_id !== currentUser.value.id) {
        markAsRead(options.id, currentUser.value.id)
        refreshUnreadCount()
      }
    })

    // Live offer cards (H5 realtime; mp degrades to the onLoad fetch).
    offersUnsub = subscribeToOffers(options.id, () => {
      fetchOffers(options.id!).then(() => nextTick(() => scrollToBottom())).catch(() => {})
    })

    // Live meetup cards (same realtime contract as offers).
    meetupsUnsub = subscribeToMeetups(options.id, () => {
      fetchMeetups(options.id!).then(() => nextTick(() => scrollToBottom())).catch(() => {})
    })

    // Presence + typing (best-effort): peer online label + "正在输入…".
    startPresence()
    typingApi = subscribeTyping(options.id, () => {
      peerTyping.value = true
      if (typingClear) clearTimeout(typingClear)
      typingClear = setTimeout(() => { peerTyping.value = false }, 3000)
    })

    // #ifdef H5
    onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible' || !options.id) return
      fetchMessages(options.id).then(() => nextTick(() => scrollToBottom())).catch(() => {})
      fetchOffers(options.id).catch(() => {})
      fetchMeetups(options.id).catch(() => {})
      if (currentUser.value) { markAsRead(options.id, currentUser.value.id); refreshUnreadCount() }
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    // #endif
  }
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (offersUnsub) offersUnsub()
  if (meetupsUnsub) meetupsUnsub()
  if (typingApi) typingApi.unsubscribe()
  if (typingClear) clearTimeout(typingClear)
  // #ifdef H5
  if (onVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  // #endif
})

function goBack() {
  uni.navigateBack()
}

function goToItem() {
  if (itemInfo.value) {
    uni.navigateTo({ url: `/pages/detail/index?id=${itemInfo.value.id}` })
  }
}

async function sendQuickReply(text: string) {
  if (!currentUser.value || !conversationId.value) return
  try {
    await sendMessage(conversationId.value, currentUser.value.id, text)
    markAsRead(conversationId.value, currentUser.value.id)
    refreshUnreadCount()
    nextTick(() => scrollToBottom())
  } catch {
    uni.showToast({ title: t('chat.fail'), icon: 'none' })
  }
}

const sending = ref(false)

/*
 * Tapping the message area dismisses the emoji panel (N#5). A scroll
 * gesture fires touchmove, not click, so scrolling the history won't
 * close it; only a discrete tap does. The panel is a sibling of this
 * scroll-view, so picking emojis (which keeps the panel open by design)
 * does not bubble here. No-op when already closed.
 */
function onMessageAreaTap() {
  if (emojiOpen.value) emojiOpen.value = false
}

function toggleEmoji() {
  emojiOpen.value = !emojiOpen.value
  if (emojiOpen.value) {
    /* Releasing the focus binding before hiding the keyboard prevents
       the next render from re-engaging :focus="true" and bouncing the
       keyboard right back up. */
    inputFocused.value = false
    try { uni.hideKeyboard?.() } catch {}
  }
}

function onPickEmoji(emoji: string) {
  /*
   * Insert the emoji into the input value instead of sending it as its
   * own message. The previous behaviour was to fire sendMessage(emoji)
   * directly, which surprised users — they expected to compose a
   * sentence with emoji embedded, not blast a one-glyph message every
   * time they tapped the panel.
   *
   * We try cursor-aware insertion on H5 (where the underlying <input>
   * exposes selectionStart). If that's not available — mp targets, or
   * the input hasn't been focused yet — fall back to appending to the
   * end of inputText. The user can always backspace and reposition;
   * the contract is "emoji enters the field, never escapes as a
   * standalone message".
   *
   * Keep the panel open so the user can tap several in a row. Closing
   * it would force them to re-toggle for the second emoji.
   */
  // #ifdef H5
  try {
    const root = (chatInputRef.value as any)?.$el as HTMLElement | undefined
    const native = root?.querySelector?.('textarea, input') as HTMLTextAreaElement | HTMLInputElement | null
    if (native && typeof native.selectionStart === 'number') {
      const before = inputText.value.slice(0, native.selectionStart)
      const after = inputText.value.slice(native.selectionEnd ?? native.selectionStart)
      const next = `${before}${emoji}${after}`
      inputText.value = next
      nextTick(() => {
        try {
          native.focus()
          const pos = before.length + emoji.length
          native.setSelectionRange(pos, pos)
        } catch { /* fallback: cursor stays where it lands */ }
      })
      return
    }
  } catch { /* fall through to append */ }
  // #endif
  inputText.value = `${inputText.value}${emoji}`
}

function stickerOf(msg: any): StickerName | null {
  if (msg.message_type && msg.message_type !== 'text') return null
  return parseStickerToken(msg.content || '')
}

function replyPreview(msg: any): string {
  if (msg.message_type === 'image') return `[${t('chat.photo')}]`
  if (msg.message_type === 'video') return `[${t('chat.video')}]`
  if (stickerOf(msg)) return `[${t('chat.sticker')}]`
  return msg.content || ''
}

/* Stickers send immediately on tap (panel stays open) — unlike unicode
   emoji, which insert into the input via onPickEmoji above. */
async function onPickSticker(name: StickerName) {
  if (!currentUser.value || !conversationId.value || sending.value) return
  sending.value = true
  try {
    await sendMessage(conversationId.value, currentUser.value.id, stickerToken(name))
    markAsRead(conversationId.value, currentUser.value.id)
    refreshUnreadCount()
    nextTick(() => scrollToBottom())
  } catch (error: any) {
    uni.showToast({
      title: friendlyErrorMessage(error, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    sending.value = false
  }
}

const emojiSuggestions = computed(() => suggestEmoji(inputText.value))

function applySuggestion(emoji: string) {
  inputText.value = `${inputText.value}${emoji}`
}

async function retrySend(msg: any) {
  if (!currentUser.value || !conversationId.value) return
  const text = msg?.content
  if (!text) return
  const idx = messages.value.findIndex(m => m.id === msg.id)
  if (idx < 0) return
  // Flip the existing bubble back to _pending IN PLACE — never remove it before
  // the resend resolves, or a second failure would lose the message entirely
  // (no copy in the composer either, since the content carries the reply quote).
  messages.value[idx]._failed = false
  messages.value[idx]._pending = true
  try {
    const sent = await sendMessage(conversationId.value, currentUser.value.id, text, msg.message_type || 'text')
    const i = messages.value.findIndex(m => m.id === msg.id)
    const echoed = sent ? messages.value.some(m => m.id === sent.id) : false
    if (i >= 0) {
      if (sent && !echoed) messages.value.splice(i, 1, sent)
      else messages.value.splice(i, 1)
    } else if (sent && !echoed) {
      messages.value.push(sent)
    }
    nextTick(() => scrollToBottom())
  } catch (err: any) {
    const i = messages.value.findIndex(m => m.id === msg.id)
    if (i >= 0) { messages.value[i]._pending = false; messages.value[i]._failed = true }
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  }
}

/*
 * Physical-keyboard send vs newline (H5 desktop only — mp has no keydown,
 * so this never fires there). Enter sends; Shift/Ctrl/Cmd+Enter falls
 * through to the textarea's default newline insert. The keydown bubbles
 * from the inner <textarea> to the uni component root we bound on.
 */
function onComposerKeydown(e: KeyboardEvent) {
  if (!e) return
  // Let the IME consume the Enter that confirms a candidate — Chinese/JP/KR
  // users press Enter to pick a pinyin candidate, and the browser fires
  // keydown with isComposing (legacy keyCode 229) before compositionend.
  // Without this guard we'd preventDefault + send a half-composed message.
  if (e.isComposing || (e as any).keyCode === 229) return
  if (e.key !== 'Enter') return
  if (e.shiftKey || e.ctrlKey || e.metaKey) return
  if (typeof e.preventDefault === 'function') e.preventDefault()
  onSend()
}

async function onSend() {
  const text = inputText.value.trim()
  if (!text || !currentUser.value || !conversationId.value) return
  if (sending.value) return

  let finalText = text
  if (replyToMsg.value) {
    const quoted = replyPreview(replyToMsg.value).slice(0, 80)
    finalText = `> ${quoted}\n${text}`
  }

  const convId = conversationId.value
  const me = currentUser.value.id
  inputText.value = ''
  const wasReplying = replyToMsg.value
  replyToMsg.value = null
  sending.value = true
  const failsafe = setTimeout(() => { sending.value = false }, 15000)

  /*
   * Optimistic render — drop the message into the thread IMMEDIATELY as a
   * _pending bubble, before any await. Local + remote (OpenAI) moderation +
   * the insert round-trip can take ~1s, and waiting on all of it before
   * showing anything is exactly what made sending feel laggy. We reconcile
   * the temp row with the real one on success, flip it to _failed (tap to
   * retry) on a transient error, or drop it + hand the text back on a content
   * rejection. The realtime echo dedupes by real id, so no double render.
   */
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  messages.value.push({
    id: tempId,
    conversation_id: convId,
    sender_id: me,
    content: finalText,
    message_type: 'text',
    is_read: false,
    created_at: new Date().toISOString(),
    _pending: true,
  })
  nextTick(() => scrollToBottom())

  /*
   * SYNCHRONOUS H5 focus — must happen BEFORE `await sendMessage`,
   * still inside the click event's user-gesture stack. iOS Safari
   * silently ignores focus() called from a nextTick / setTimeout /
   * post-await microtask; once we yield the event loop, the gesture
   * is released and the keyboard dismisses for good.
   *
   * Two prior attempts at this issue both put the focus call inside
   * a nextTick AFTER the await — exactly the broken pattern:
   *   · a395107 — direct native.focus() inside post-await nextTick
   *   · 5c8623c — :focus binding toggled inside post-await nextTick
   * Both passed code review and desktop Chrome (looser gesture rules)
   * and both failed real-device acceptance on iOS Safari.
   *
   * The native.focus() call is now placed synchronously, before any
   * await, so it runs while the click handler is still on the user-
   * gesture stack. The :focus binding toggle stays after the await
   * for mp-weixin only, where the documented uni-app pattern works
   * because mp targets don't enforce iOS Safari's gesture model.
   */
  // #ifdef H5
  try {
    const root = (chatInputRef.value as any)?.$el as HTMLElement | undefined
    const native = root?.querySelector?.('textarea, input') as HTMLTextAreaElement | HTMLInputElement | null
    native?.focus()
  } catch { /* fall through — :focus toggle below is the mp backup */ }
  // #endif

  try {
    const sent = await sendMessage(convId, me, finalText)
    // Reconcile the optimistic temp row with the real one. If the realtime
    // echo already added the real id (it can land mid-await), just drop the
    // temp; otherwise swap temp -> real in place. Dedup keeps it single.
    const idx = messages.value.findIndex(m => m.id === tempId)
    const echoed = sent ? messages.value.some(m => m.id === sent.id) : false
    if (idx >= 0) {
      if (sent && !echoed) messages.value.splice(idx, 1, sent)
      else messages.value.splice(idx, 1)
    } else if (sent && !echoed) {
      messages.value.push(sent)
    }
    markAsRead(convId, me)
    refreshUnreadCount()
    nextTick(() => {
      scrollToBottom()
      /*
       * mp-weixin re-focus path. H5 already engaged via the synchronous
       * native.focus() above; this toggle is for the platforms that
       * don't have iOS Safari's gesture-window restriction. uni-app's
       * `:focus` prop is edge-triggered (false → true triggers focus,
       * level-true is a no-op), so toggle false → nextTick → true to
       * force the transition even if the previous send left it true.
       */
      // #ifndef H5
      inputFocused.value = false
      nextTick(() => { inputFocused.value = true })
      // #endif
    })
  } catch (error: any) {
    const reason = String(error?.message || '')
    const contentRejected = reason.startsWith('moderation_block') || reason === 'duplicate_message' || reason === 'message_too_long'
    const idx = messages.value.findIndex(m => m.id === tempId)
    uni.showToast({
      title: friendlyErrorMessage(error, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
    if (contentRejected) {
      // Content was rejected — remove the bubble and hand the text back to edit.
      if (idx >= 0) messages.value.splice(idx, 1)
      inputText.value = text
      replyToMsg.value = wasReplying
    } else if (idx >= 0) {
      // Transient/network failure — keep the bubble, flip it to retryable.
      messages.value[idx]._pending = false
      messages.value[idx]._failed = true
    }
  } finally {
    clearTimeout(failsafe)
    sending.value = false
  }
}


function onMoreActions() {
  uni.showActionSheet({
    itemList: [
      convMuted.value ? t('chat.unmute') : t('chat.mute'),
      convPinned.value ? t('msg.unpin') : t('msg.pin'),
      t('chat.blockUser'),
      t('detail.report'),
    ],
    success: (res) => {
      if (res.tapIndex === 0) toggleMute()
      else if (res.tapIndex === 1) togglePin()
      else if (res.tapIndex === 2) doBlock()
      else if (res.tapIndex === 3) doReport()
    },
  })
}

async function togglePin() {
  if (!conversationDetail.value || !currentUser.value) return
  try {
    await setConversationPinned(conversationDetail.value, currentUser.value.id, !convPinned.value)
    convPinned.value = !convPinned.value
    uni.showToast({ title: convPinned.value ? t('msg.pinned') : t('msg.unpin'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  }
}

async function toggleMute() {
  if (!conversationDetail.value || !currentUser.value) return
  try {
    await setConversationMuted(conversationDetail.value, currentUser.value.id, !convMuted.value)
    convMuted.value = !convMuted.value
    uni.showToast({ title: convMuted.value ? t('msg.muted') : t('chat.unmute'), icon: 'success' })
    refreshUnreadCount()
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  }
}

function doBlock() {
  if (!otherUserId.value) return
  uni.showModal({
    title: t('block.confirm'),
    content: t('block.hint'),
    confirmColor: DIALOG_DANGER,
    success: async (r) => {
      if (!r.confirm) return
      try {
        await blockUser(otherUserId.value)
        uni.showToast({ title: t('block.success'), icon: 'success' })
        setTimeout(() => uni.navigateBack(), 800)
      } catch (err: any) {
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('block.failed'), icon: 'none' })
      }
    },
  })
}

function doReport() {
  if (!otherUserId.value) return
  const reasons = [
    t('report.reasonSpam'),
    t('report.reasonAbuse'),
    t('report.reasonMisleading'),
    t('report.reasonOther'),
  ]
  uni.showActionSheet({
    itemList: reasons,
    success: async (res) => {
      const reason = reasons[res.tapIndex]
      uni.showLoading({ title: t('report.submitting') || t('login.wait'), mask: true })
      try {
        await reportTarget('user', otherUserId.value, reason)
        uni.hideLoading()
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
        uni.hideLoading()
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('report.failed'), icon: 'none' })
      }
    },
  })
}

/*
 * Unified chat timeline: messages + offers merged and sorted by created_at,
 * so structured offers (migration 051) interleave with text in the right
 * place. Each entry is tagged so the template renders a bubble or an offer
 * card. Time dividers run over this merged list.
 */
type TimelineEntry =
  | { kind: 'msg'; key: string; created_at: string; msg: any }
  | { kind: 'offer'; key: string; created_at: string; offer: Offer }
  | { kind: 'meetup'; key: string; created_at: string; meetup: Meetup }

const timeline = computed<TimelineEntry[]>(() => {
  const out: TimelineEntry[] = []
  for (const m of messages.value) out.push({ kind: 'msg', key: 'm-' + m.id, created_at: m.created_at, msg: m })
  for (const o of offers.value) out.push({ kind: 'offer', key: 'o-' + o.id, created_at: o.created_at, offer: o })
  for (const mt of meetups.value) out.push({ kind: 'meetup', key: 'mt-' + mt.id, created_at: mt.created_at, meetup: mt })
  out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  return out
})

function shouldShowTimeAt(idx: number): boolean {
  if (idx === 0) return true
  const curr = new Date(timeline.value[idx].created_at).getTime()
  const prev = new Date(timeline.value[idx - 1].created_at).getTime()
  return curr - prev > 5 * 60 * 1000
}

// ---- Offer helpers ----
function fmtOfferPrice(p: number): string {
  return Number.isInteger(p) ? String(p) : String(Math.round(p * 100) / 100)
}
function offerIncoming(o: Offer): boolean {
  return o.to_user === currentUser.value?.id
}
function offerExpired(o: Offer): boolean {
  return new Date(o.expires_at).getTime() <= Date.now()
}
function offerStatusLabel(o: Offer): string {
  if (o.status === 'pending' && offerExpired(o)) return t('chat.offerStatus.expired')
  return t('chat.offerStatus.' + o.status)
}

// ---- Offer composer (new offer + counter share one bottom sheet) ----
const offerSheet = ref<{ open: boolean; mode: 'new' | 'counter'; targetId: string }>({ open: false, mode: 'new', targetId: '' })
const offerPriceInput = ref('')
const offerNoteInput = ref('')
const offerSubmitting = ref(false)
const quickAmounts = computed<number[]>(() => {
  const p = itemInfo.value?.price || 0
  if (!p || p <= 0) return []
  // De-dupe: on cheap items (e.g. $1 → [1,1,1], $3 → [3,2,2]) the three
  // rounded values collide, producing duplicate :key + redundant chips.
  return [...new Set([0.9, 0.8, 0.7].map(r => Math.max(1, Math.round(p * r))))]
})

function openOfferSheet() {
  offerPriceInput.value = ''
  offerNoteInput.value = ''
  offerSheet.value = { open: true, mode: 'new', targetId: '' }
}
function openCounter(o: Offer) {
  offerPriceInput.value = ''
  offerNoteInput.value = ''
  offerSheet.value = { open: true, mode: 'counter', targetId: o.id }
}
function closeOfferSheet() {
  offerSheet.value.open = false
}
async function submitOfferSheet() {
  const price = Number(offerPriceInput.value)
  if (!conversationId.value || !price || price <= 0 || offerSubmitting.value) return
  offerSubmitting.value = true
  try {
    if (offerSheet.value.mode === 'counter' && offerSheet.value.targetId) {
      await respondToOffer(offerSheet.value.targetId, 'counter', price, offerNoteInput.value)
    } else {
      await makeOffer(conversationId.value, price, offerNoteInput.value)
    }
    await fetchOffers(conversationId.value)
    offerSheet.value.open = false
    nextTick(() => scrollToBottom())
  } catch (err: any) {
    captureException(err, { tags: { source: 'chat.offer' } })
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    offerSubmitting.value = false
  }
}
async function acceptOffer(o: Offer) { await respondOffer(o, 'accept') }
async function declineOffer(o: Offer) { await respondOffer(o, 'decline') }
async function respondOffer(o: Offer, action: 'accept' | 'decline') {
  if (!conversationId.value) return
  try {
    await respondToOffer(o.id, action)
    await fetchOffers(conversationId.value)
    nextTick(() => scrollToBottom())
  } catch (err: any) {
    captureException(err, { tags: { source: 'chat.offer' } })
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  }
}

// ---- Meetup helpers (structured scheduling, migration 052) ----
function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }
function meetupIncoming(m: Meetup): boolean { return m.to_user === currentUser.value?.id }
function meetupExpired(m: Meetup): boolean { return new Date(m.expires_at).getTime() <= Date.now() }
function meetupStatusLabel(m: Meetup): string {
  if (m.status === 'pending' && meetupExpired(m)) return t('chat.meetupStatus.expired')
  return t('chat.meetupStatus.' + m.status)
}
function meetupSpotLabel(m: Meetup): string { return localizeLocation(m.spot, lang.value as 'en' | 'zh') }
function fmtMeetupWhen(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

// ---- Meetup composer (propose + reschedule share one bottom sheet) ----
const safeSpots = computed(() => CAMPUS_SPOTS.filter(s => s.safe))
const todayStr = computed(() => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` })
const maxDateStr = computed(() => { const d = new Date(Date.now() + 89 * 86400000); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` })
const meetupSheet = ref<{ open: boolean; mode: 'new' | 'reschedule' | 'reschedule-accepted'; targetId: string }>({ open: false, mode: 'new', targetId: '' })

// #6c — only one live pending proposal per conversation (DB enforces it too).
const hasPendingMeetup = computed(() =>
  meetups.value.some((m) => m.status === 'pending' && new Date(m.expires_at).getTime() > Date.now()),
)
const meetupSpotInput = ref('')
const meetupDateInput = ref('')
const meetupTimeInput = ref('')
const meetupNoteInput = ref('')
const meetupSubmitting = ref(false)

function resetMeetupSheet() {
  meetupSpotInput.value = ''
  meetupDateInput.value = ''
  meetupTimeInput.value = ''
  meetupNoteInput.value = ''
}
function openMeetupSheet() {
  if (hasPendingMeetup.value) {
    uni.showToast({ title: t('chat.meetupPendingExists'), icon: 'none' })
    return
  }
  resetMeetupSheet()
  // Prefill from the item's pickup location only when it's a known safe spot,
  // using the localized chip label so the matching chip highlights (a raw
  // zh-stored value wouldn't match the en chips, and vice versa).
  const spot = matchSpot(itemInfo.value?.location)
  if (spot && spot.safe) meetupSpotInput.value = lang.value === 'zh' ? spot.zh : spot.en
  meetupSheet.value = { open: true, mode: 'new', targetId: '' }
}
function openReschedule(m: Meetup) {
  resetMeetupSheet()
  meetupSpotInput.value = m.spot
  meetupSheet.value = { open: true, mode: 'reschedule', targetId: m.id }
}
// #6a — either party reschedules an already-accepted meetup (new RPC).
function openRescheduleAccepted(m: Meetup) {
  // Mirror openMeetupSheet + the server-side guard (migration 063): a
  // reschedule re-enters pending, so block it when a live pending proposal
  // already exists rather than stacking two — give feedback before the RPC.
  if (hasPendingMeetup.value) {
    uni.showToast({ title: t('chat.meetupPendingExists'), icon: 'none' })
    return
  }
  resetMeetupSheet()
  meetupSpotInput.value = m.spot
  meetupSheet.value = { open: true, mode: 'reschedule-accepted', targetId: m.id }
}
function closeMeetupSheet() { meetupSheet.value.open = false }

function meetupAtIso(): string | null {
  if (!meetupDateInput.value || !meetupTimeInput.value) return null
  const dt = new Date(`${meetupDateInput.value}T${meetupTimeInput.value}:00`)
  if (isNaN(dt.getTime())) return null
  return dt.toISOString()
}
async function submitMeetupSheet() {
  const iso = meetupAtIso()
  if (!conversationId.value || !meetupSpotInput.value || !iso || meetupSubmitting.value) return
  // The date picker has a today floor but the time picker has none, so today +
  // an already-past time slips through (the server only rejects > 2h stale).
  // Block a past meet time client-side with feedback instead of silently
  // proposing a meetup that renders in the past.
  if (new Date(iso).getTime() <= Date.now()) {
    uni.showToast({ title: t('chat.meetupPast'), icon: 'none' })
    return
  }
  meetupSubmitting.value = true
  try {
    if (meetupSheet.value.mode === 'reschedule' && meetupSheet.value.targetId) {
      await respondToMeetup(meetupSheet.value.targetId, 'reschedule', meetupSpotInput.value, iso, meetupNoteInput.value)
    } else if (meetupSheet.value.mode === 'reschedule-accepted' && meetupSheet.value.targetId) {
      await rescheduleAccepted(meetupSheet.value.targetId, meetupSpotInput.value, iso, meetupNoteInput.value)
    } else {
      await proposeMeetup(conversationId.value, meetupSpotInput.value, iso, meetupNoteInput.value)
    }
    await fetchMeetups(conversationId.value)
    meetupSheet.value.open = false
    nextTick(() => scrollToBottom())
  } catch (err: any) {
    captureException(err, { tags: { source: 'chat.meetup' } })
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    meetupSubmitting.value = false
  }
}
async function acceptMeetup(m: Meetup) { await respondMeetup(m, 'accept') }
async function declineMeetup(m: Meetup) { await respondMeetup(m, 'decline') }
async function respondMeetup(m: Meetup, action: 'accept' | 'decline') {
  if (!conversationId.value) return
  try {
    await respondToMeetup(m.id, action)
    await fetchMeetups(conversationId.value)
    nextTick(() => scrollToBottom())
  } catch (err: any) {
    captureException(err, { tags: { source: 'chat.meetup' } })
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  }
}

function formatChatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (msgDay.getTime() === today.getTime()) return time
  if (msgDay.getTime() === yesterday.getTime()) return `${t('chat.yesterday')} ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

/* 1.5s + haptic recognizer to reduce mis-fires on the chat surface
   (a thumb resting on a bubble used to fire reply/copy/delete with
   a 350ms accident). Tuned 3s → 2s in batch #2, then 2s → 1.5s in
   batch #3a — 2s still tested as draggy in user acceptance; 1.5s
   keeps the deliberate-intent gate while feeling snappy enough that
   "yes I really wanted to long-press this" doesn't feel like waiting. */
const msgLongPress = useLongPress<[any]>((msg) => onMsgLongPress(msg), 1500)

function onMsgLongPress(msg: any) {
  const isMine = msg.sender_id === currentUser.value?.id
  const isText = msg.message_type !== 'image'

  /*
   * Action ordering for non-mine messages: reply → copy (text only) → report.
   * Report goes LAST so a finger sliding through the sheet doesn't blast
   * the destructive option first. For mine messages we keep delete-only
   * (you don't report your own messages and copying your own message
   * isn't a common workflow — keep the sheet short).
   */
  const actions: string[] = []
  if (!isMine) actions.push(t('chat.reply'))
  if (isText) actions.push(t('chat.copy'))
  if (!isMine) actions.push(t('detail.report'))
  if (isMine) actions.push(t('chat.deleteMsg'))
  if (actions.length === 0) return

  uni.showActionSheet({
    itemList: actions,
    success: (res) => {
      const action = actions[res.tapIndex]
      if (action === t('chat.reply')) {
        replyToMsg.value = msg
        nextTick(() => { /* keyboard opens via input focus naturally */ })
      } else if (action === t('chat.copy')) {
        uni.setClipboardData({ data: msg.content })
        uni.showToast({ title: t('chat.copied'), icon: 'success' })
      } else if (action === t('detail.report')) {
        /* Re-uses the same reason sheet + reportTarget pipeline as the
           header's "more → Report" action. In a 1:1 chat, the message
           sender (when !isMine) is by definition otherUserId, so we
           don't need to thread msg.sender_id through. */
        doReport()
      } else if (action === t('chat.deleteMsg')) {
        uni.showModal({
          title: t('chat.deleteMsgTitle'),
          content: t('chat.deleteMsgHint'),
          confirmColor: DIALOG_DANGER,
          success: async (r) => {
            if (!r.confirm) return
            try {
              await deleteMessage(msg.id)
              uni.showToast({ title: t('chat.deleted'), icon: 'success' })
            } catch {
              uni.showToast({ title: t('chat.fail'), icon: 'none' })
            }
          },
        })
      }
    },
  })
}

function previewImg(url: string) {
  uni.previewImage({ urls: [url], current: url })
}

async function onSendImage() {
  if (!currentUser.value || !conversationId.value) return
  if (sending.value) return
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const tempPath = res.tempFilePaths?.[0]
      if (!tempPath) return
      sending.value = true
      const failsafe = setTimeout(() => { sending.value = false }, 30000)
      try {
        /*
         * uploadOneImage (added in batch #2) replaces the previous
         * compressImage(...) → uploadImages([compressed]) chain. The
         * old chain pre-compressed the photo into a data:URL and then
         * uploadImages re-compressed it inside uploadImagesWithDims —
         * a wasted pass on H5 and a quality loss for mp. Worse,
         * uploadImagesWithDims's per-file error handler swallowed
         * Supabase storage failures and returned an empty urls array,
         * which surfaced to the user as a generic 'imageUploadFailed'
         * toast with no actionable diagnostic. uploadOneImage throws
         * with the actual underlying error message (RLS violation,
         * 413 payload too large, network error, etc.) so the toast
         * below shows what really went wrong.
         */
        const { url } = await uploadOneImage(tempPath, { entryPoint: 'chat' })
        await sendMessage(conversationId.value, currentUser.value!.id, url, 'image')
        nextTick(() => scrollToBottom())
      } catch (err: any) {
        /*
         * Surface the underlying error string directly. friendlyErrorMessage
         * was generic-ifying 'Storage upload failed: 413 Payload Too
         * Large' and 'new row violates row-level security policy …'
         * into a vague 'something went wrong' toast that left users
         * with no path forward. The Supabase error string is plain
         * English and tells the user whether to retry, pick a smaller
         * file, or report the bug. Capped at 80 chars so a long
         * stack-trace-style error doesn't overflow the toast.
         *
         * HEIC errors get a dedicated translated toast — the raw
         * heic-to error string ('Can\'t convert canvas to blob.') is
         * meaningless to end users.
         */
        const heicMsg = err?.heic === true ? t('heic.unsupported') : null
        const raw = err?.message ? `${err.message}` : ''
        const fallback = t('chat.imageUploadFailed')
        uni.showToast({
          title: heicMsg || (raw ? raw.slice(0, 80) : fallback),
          icon: 'none',
          duration: 3500,
        })
      } finally {
        clearTimeout(failsafe)
        sending.value = false
      }
    },
  })
}

async function onSendVideo() {
  if (!currentUser.value || !conversationId.value) return
  if (sending.value) return
  uni.chooseVideo({
    sourceType: ['album', 'camera'],
    maxDuration: 60,
    compressed: true,
    success: async (res: any) => {
      const tempPath = res.tempFilePath
      if (!tempPath) return
      /* Early reject when the picker reports size (mp does; H5 varies) —
         saves the user from uploading 19MB before hearing "too large".
         uploadOneVideo re-checks authoritatively either way. */
      if (res.size && res.size > 20 * 1024 * 1024) {
        uni.showToast({ title: t('chat.videoTooLarge'), icon: 'none', duration: 3000 })
        return
      }
      sending.value = true
      const failsafe = setTimeout(() => { sending.value = false }, 60000)
      try {
        const { url } = await uploadOneVideo(tempPath)
        await sendMessage(conversationId.value, currentUser.value!.id, url, 'video')
        nextTick(() => scrollToBottom())
      } catch (err: any) {
        const raw = err?.message ? `${err.message}` : ''
        const friendly = raw === 'video_too_large' ? t('chat.videoTooLarge') : null
        uni.showToast({
          title: friendly || (raw ? raw.slice(0, 80) : t('chat.videoUploadFailed')),
          icon: 'none',
          duration: 3500,
        })
      } finally {
        clearTimeout(failsafe)
        sending.value = false
      }
    },
  })
}

function scrollToBottom() {
  const tl = timeline.value
  if (tl.length === 0) return
  // Target the true last TIMELINE entry (msg / offer / meetup), not just the
  // last message — a trailing offer/meetup card sits below the last bubble.
  // scroll-into-view is edge-triggered: an unchanged bound value is a no-op,
  // so when a new card arrives while the last message id is unchanged it would
  // never re-scroll. Toggle through '' to force the transition every call.
  const last = tl[tl.length - 1].key
  scrollTarget.value = ''
  nextTick(() => { scrollTarget.value = last })
}
</script>

<style lang="scss" scoped>
.chat-thread {
  height: 100%; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--bg-subtle);
  overflow: hidden;
  position: relative;  /* anchor for the embedded offer sheet/mask */
}
/* When embedded in the desktop two-pane, confine the offer composer sheet
   + its backdrop to this pane instead of fixing them to the whole viewport
   (which would dim the sidebar + conversation list too). */
.chat-thread.embedded .offer-mask,
.chat-thread.embedded .offer-sheet { position: absolute; }

/* ========== Chat Header ========== */
.chat-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  padding-top: calc(12px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  /* fill + blur + bottom hairline come from .u-glass + .u-glass--hair-b */
  z-index: 10;
}
.ch-back {
  width: 32px; height: 32px; display: flex;
  align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { opacity: 0.5; }
}
.ch-arrow {
  width: 9px; height: 9px;
  border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary);
  transform: rotate(45deg); margin-left: 4px;
}
.ch-info { flex: 1; min-width: 0; }
.ch-name {
  font-size: 16px; font-weight: 600; color: var(--text-primary); display: block;
}
.ch-item-title {
  font-size: 12px; color: var(--text-faint); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
/* Presence/typing subtitle — sage when online, terracotta while typing. */
.ch-status {
  font-size: 12px; color: var(--success); margin-top: 1px; display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ch-status.typing { color: var(--brand); }
.ch-name-only {
  font-size: 16px; font-weight: 600; color: var(--text-primary); flex: 1;
}
.ch-more {
  display: flex; gap: 3px; padding: 8px; cursor: pointer; flex-shrink: 0;
  &:active { opacity: 0.5; }
}
.more-dot {
  width: 4px; height: 4px; border-radius: 50%; background: var(--text-muted);
}

.item-card {
  display: flex; align-items: center; gap: 10px;
  margin: 9px 12px 0; padding: 9px 12px;
  background: var(--surface);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  &:active { background: var(--paper-2); }
}
.offer-bar {
  padding: 6px 12px 2px;
  display: flex; gap: 8px;
}
.offer-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  background: var(--warning-soft); border: 0.5px solid var(--warning);
  border-radius: var(--radius-md); padding: 8px; cursor: pointer;
  text {
    font-size: 13px; font-weight: 600;
    color: var(--warning);
    filter: brightness(0.75);
    letter-spacing: 0.02em;
  }
  &:active { background: rgba(212, 146, 60, 0.2); }
}
/* Meetup CTA — campus-blue accent so it reads as a distinct action from
   the amber "make offer". Available to both parties on any active item. */
.meetup-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  background: var(--campus-blue-soft); border: 0.5px solid var(--campus-blue);
  border-radius: var(--radius-md); padding: 8px; cursor: pointer;
  text { font-size: 13px; font-weight: 600; color: var(--campus-blue); letter-spacing: 0.02em; }
  &:active { background: rgba(42, 92, 170, 0.16); }
  &.disabled { opacity: 0.45; }
}
.quick-replies {
  white-space: nowrap; padding: 8px 12px 4px;
}
.qr-chip {
  display: inline-block; padding: 7px 14px; margin-right: 8px;
  background: var(--bg-elev-1); border: 1px solid var(--line-soft);
  border-radius: 16px; font-size: 13px; color: var(--text-primary);
  cursor: pointer;
  &:active { background: var(--bg-elev-2); }
}
.ic-img {
  width: 40px; height: 40px; border-radius: 6px;
  flex-shrink: 0; background: var(--bg-subtle);
}
.ic-info { flex: 1; min-width: 0; }
.ic-title {
  font-size: 13px; color: var(--text-primary); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
.ic-bottom { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.ic-price { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.ic-sold { font-size: 11px; color: var(--accent-danger); font-weight: 600; }
.ic-reserved { font-size: 11px; color: var(--accent-warn); font-weight: 600; }
.ic-arrow {
  width: 7px; height: 7px;
  border-top: 1.5px solid var(--text-faint); border-right: 1.5px solid var(--text-faint);
  transform: rotate(45deg); flex-shrink: 0;
}

/* ========== Messages ========== */
.message-list {
  flex: 1; min-height: 0;
  padding: 12px 12px 12px 16px;
  scrollbar-width: none;
  -ms-overflow-style: none;
  box-sizing: border-box;
}
/* Guarantee the right-side (mine) avatar never clips against the scroll
   container edge. The row is flex-end, so a 4px right offset on the
   avatar itself gives reliable clearance even when uni-scroll-view adds
   its own padding/overlay scrollbar on H5 Chrome. */
.msg-row.mine .msg-avatar { margin-right: 4px; }
/* Belt-and-suspenders — on H5 Chrome the uni-scroll-view overlay
   scrollbar was clipping ~15px off the right-side avatar on "mine"
   messages. :show-scrollbar="false" is the primary fix; these
   selectors are fallbacks in case scoped styles don't reach through
   uni's inner render. */
.message-list::-webkit-scrollbar,
.message-list :deep(.uni-scroll-view)::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.message-list :deep(.uni-scroll-view) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
/* ===== Structured offer cards (migration 051) ===== */
.offer-entry { display: flex; margin: 4px 0 9px; }
.offer-entry.mine { justify-content: flex-end; }
.offer-card {
  width: 72%; max-width: 270px;
  background: var(--surface);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  padding: 12px 14px;
}
.offer-entry.mine .offer-card { background: var(--brand-ghost); border-color: var(--brand-soft); }
.oc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.oc-eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-quiet); }
.oc-status { font-size: 11px; font-weight: 600; color: var(--ink-quiet); }
.oc-st-accepted .oc-status { color: var(--success); }
.oc-st-declined .oc-status, .oc-st-expired .oc-status { color: var(--ink-faint); }
.oc-st-countered .oc-status { color: var(--warning); }
.oc-price { display: block; font-family: var(--font-serif); font-size: 26px; font-weight: 600; color: var(--brand); letter-spacing: -0.02em; line-height: 1.1; }
.oc-st-declined .oc-price, .oc-st-expired .oc-price, .oc-st-countered .oc-price { color: var(--ink-quiet); text-decoration: line-through; }
.oc-note { display: block; margin-top: 4px; font-size: 12px; color: var(--ink-soft); line-height: 1.5; }
.oc-meta { display: block; margin-top: 8px; font-size: 12px; color: var(--ink-quiet); }
.oc-expiry { display: block; margin-top: 6px; font-size: 10px; color: var(--ink-faint); }
.oc-actions { display: flex; gap: 6px; margin-top: 10px; }
.oc-btn {
  flex: 1; height: 32px; border-radius: var(--radius-pill);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  text { font-size: 12px; font-weight: 600; }
  &:active { transform: scale(0.96); }
}
.oc-accept { background: var(--brand); text { color: #fff; } }
.oc-decline { background: var(--surface-alt); text { color: var(--ink-soft); } }
.oc-counter { background: var(--surface-alt); text { color: var(--ink); } }

.deal-line {
  text-align: center; margin: 2px 0 12px;
  text { font-size: 12px; font-weight: 600; color: var(--success); background: var(--success-soft); padding: 5px 14px; border-radius: var(--radius-pill); }
  .deal-reschedule { display: inline-block; margin-left: 8px; color: var(--campus-blue); background: var(--campus-blue-soft); cursor: pointer; }
  .deal-reschedule:active { opacity: 0.7; }
}

/* ===== Offer composer sheet ===== */
.offer-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); z-index: 1000; }
.offer-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001;
  background: var(--bg-elev-1);
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  padding: 8px 20px calc(20px + env(safe-area-inset-bottom, 0px));
  transform: translateY(100%);
  transition: transform var(--dur-3) var(--ease-warm);
  max-width: 480px; margin: 0 auto;
  /* QA7-r2 #4: the meetup sheet (spot + note inputs, then date/time pickers)
     is tall. As a bottom-anchored fixed sheet with no height bound, tapping an
     input opened the keyboard, interactive-widget=resizes-content shrank the
     viewport, and the sheet's top (where the inputs sit) overflowed above the
     screen with no way to scroll to it — the field appeared unresponsive.
     max-height:100% resolves against the fixed ICB (which shrinks with the
     keyboard), so the sheet always fits above it and scrolls internally to
     keep the focused input in view. */
  max-height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch;
  /* QA7-r2 #4 (real cause): Eric confirmed tapping the meetup note / custom-spot
     inputs opens NO keyboard — the tap never reaches the input. On iOS Safari a
     position:fixed element that keeps a `transform` mis-hit-tests its descendant
     form controls: they paint where you see them but the tap lands at the
     untransformed position, so the input looks dead. translateY(0) still keeps a
     transform layer; settle the OPEN state to `transform: none` (visually
     identical) so the inputs become tappable. The slide-in still animates
     none ⇄ translateY(100%). (Desktop WebKit doesn't exhibit this, so it passed
     the headless probe — it's iOS-only.) */
  &.open { transform: none; }
}
.os-handle { width: 36px; height: 4px; border-radius: 2px; background: var(--border-strong); margin: 0 auto 14px; }
.os-title { display: block; font-family: var(--font-serif); font-size: 18px; font-weight: 600; color: var(--ink); }
.os-ref { display: block; margin-top: 4px; font-size: 12px; color: var(--ink-quiet); }
.os-input-row { display: flex; align-items: center; gap: 6px; margin-top: 16px; padding: 12px 14px; background: var(--bg-subtle); border-radius: var(--radius-md); }
.os-dollar { font-family: var(--font-serif); font-size: 22px; font-weight: 600; color: var(--brand); }
.os-input { flex: 1; font-family: var(--font-serif); font-size: 22px; color: var(--ink); background: transparent; }
.os-quick { white-space: nowrap; margin-top: 10px; }
.os-quick-chip {
  display: inline-flex; align-items: center; height: 30px; padding: 0 14px; margin-right: 8px;
  border-radius: var(--radius-pill); background: var(--surface-alt);
  text { font-family: var(--font-mono); font-size: 13px; color: var(--ink-soft); }
  &:active { background: var(--frame); }
  &.on {
    background: var(--brand-soft);
    text { color: var(--brand-deep); }
  }
}
/* Meetup card body (reuses .offer-card / .oc-* shell) + composer pickers. */
.mc-spot { display: block; font-family: var(--font-serif); font-size: 19px; font-weight: 600; color: var(--campus-blue); letter-spacing: -0.01em; line-height: 1.2; }
.mc-when { display: block; margin-top: 2px; font-size: 14px; font-weight: 600; color: var(--ink); }
.mt-label { display: block; margin-top: 6px; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--ink-quiet); letter-spacing: 0.02em; }
.mt-spots { white-space: nowrap; }
.mt-spots .os-quick-chip text { font-family: inherit; }
.mt-row { display: flex; gap: 8px; margin-top: 12px; }
/* Each <picker> (uni-picker is display:block) is the flex child; flex:1 must
   land on it, not the inner .mt-picker view, or the pickers collapse to text
   width and bunch up on the left. The cell carries the 50/50 split; the inner
   view fills it. */
.mt-cell { flex: 1; min-width: 0; }
.mt-picker {
  width: 100%; height: 44px; display: flex; align-items: center; justify-content: center;
  background: var(--bg-subtle); border-radius: var(--radius-md);
  text { font-size: 14px; color: var(--ink); }
}
/* QA7-r3 #4: Eric reports tapping the meetup inputs opens no keyboard and the
   target feels small. Give them a big, unambiguous hit area — taller min-height,
   more padding, font-size 16px (also stops iOS zoom-on-focus), and a higher
   stacking than any sibling rail so nothing can shadow the tap. */
.os-note { position: relative; z-index: 3; margin-top: 12px; min-height: 52px; padding: 16px 14px; background: var(--bg-subtle); border-radius: var(--radius-md); font-size: 16px; color: var(--ink); width: 100%; box-sizing: border-box; }
.mt-spot-input { margin-top: 8px; }
.mt-safe-hint { display: block; margin-top: 10px; font-size: 11px; color: var(--ink-faint); line-height: 1.4; }
.os-submit {
  margin-top: 16px; height: 48px; border-radius: var(--radius-pill);
  background: var(--brand); display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-cta); cursor: pointer;
  text { font-size: 15px; font-weight: 600; color: #fff; }
  &:active { opacity: 0.85; }
  &.disabled { background: var(--ink-faint); box-shadow: none; pointer-events: none; }
}
.os-expiry-hint { display: block; text-align: center; margin-top: 10px; font-size: 11px; color: var(--ink-faint); }

.time-divider {
  text-align: center; padding: 12px 0 6px;
  text { font-size: 11px; color: var(--text-faint); background: var(--bg-subtle); padding: 2px 10px; border-radius: 8px; }
}
.msg-row {
  display: flex; align-items: flex-end; margin-bottom: 9px; gap: 8px;
  width: 100%; box-sizing: border-box;
  &.mine {
    justify-content: flex-end;
    .msg-bubble {
      background: var(--accent-primary); color: #fff;
      border-radius: 18px 18px 4px 18px;
    }
  }
}
.msg-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  flex-shrink: 0; background: var(--bg-inset);
  object-fit: cover;
}
.msg-bubble {
  max-width: calc(100% - 48px); padding: 10px 14px;
  background: var(--bg-elev-1); border-radius: 4px 18px 18px 18px;
  font-size: 15px; line-height: 1.5; word-break: break-all;
  box-sizing: border-box;
}
.msg-image {
  /* widthFix handles the common case (natural-ratio photo in a 200px
     bubble). The max-height: 60vh cap is the belt: a 1:5 full-phone
     screenshot used to blow past an entire viewport inside the thread
     and push every earlier message off-screen. Clamped to 60% of the
     viewport's height it fills the bubble prominently without hijacking
     the scroll. object-fit: contain is the braces — once max-height
     clamps the box, contain keeps the screenshot letterboxed instead
     of stretched. */
  max-width: 200px;
  max-height: 60vh;
  height: auto;
  display: block;
  object-fit: contain;
  border-radius: 12px;
  background: var(--bg-inset);
}
.msg-video {
  width: 220px;
  max-width: 60vw;
  height: 160px;
  border-radius: 12px;
  background: var(--bg-inset);
}
/* Sticker messages float bare — no bubble chrome. */
.msg-sticker {
  padding: 2px;
}
.img-btn {
  width: 38px; height: 38px; display: flex;
  align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
  background: var(--bg-subtle); border-radius: 50%;
  &:active { background: var(--bg-inset); }
}
.emoji-btn {
  width: 38px; height: 38px; display: flex;
  align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;
  background: var(--bg-subtle); border-radius: 50%;
  &:active { background: var(--bg-inset); }
  &.active { background: var(--accent-primary); }
  &.active .emoji-btn-glyph { opacity: 1; filter: none; }
}
.emoji-btn-glyph {
  font-size: 20px; line-height: 1;
  /* Inactive opacity raised from 0.45 → 0.78 so the button is
     legible at rest. The grayscale filter softened from 0.6 → 0.2
     so the smiley still reads as colourful, just dimmed. The
     .active rule above resets to opacity 1 + no filter when the
     panel is open. */
  opacity: 0.78;
  filter: grayscale(0.2);
  transition: opacity 0.15s, filter 0.15s;
}

.empty-chat {
  display: flex; flex-direction: column; align-items: center;
  padding-top: 80px; gap: 10px; color: var(--text-faint); font-size: 14px;
}
/* CSS Wave Icon */
.ec-icon { margin-bottom: 4px; }
.ec-wave {
  width: 32px; height: 24px; position: relative;
  &::before {
    content: ''; position: absolute; top: 2px; left: 0;
    width: 28px; height: 20px; border: 2px solid var(--border-strong);
    border-radius: 14px 14px 14px 4px;
  }
  &::after {
    content: ''; position: absolute; top: 9px; left: 7px;
    width: 12px; height: 3px; border-radius: 2px;
    background: var(--border-strong);
  }
}

/* ========== Input Bar ========== */
.reply-ctx {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  background: rgba(199,74,47,0.08);
  border-top: 0.5px solid rgba(199,74,47,0.15);
  max-width: 480px; margin: 0 auto;
  width: 100%; box-sizing: border-box;
}
.rc-bar { width: 3px; align-self: stretch; background: var(--accent-action); border-radius: 2px; }
.rc-body { flex: 1; min-width: 0; }
.rc-label { display: block; font-size: 11px; color: var(--accent-action); font-weight: 600; }
.rc-text {
  display: block; font-size: 13px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 2px;
}
.rc-x {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { background: rgba(199,74,47,0.15); }
}

.suggest-row {
  display: flex; gap: 8px; padding: 6px 14px;
  background: var(--bg-elev-1); border-top: 0.5px solid var(--line-hair);
  max-width: 480px; margin: 0 auto; width: 100%; box-sizing: border-box;
  overflow-x: auto;
  transition: transform 0.22s ease-out; will-change: transform;
}
.suggest-chip {
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { background: var(--bg-inset); }
}
.suggest-emoji { font-size: 19px; line-height: 1; }

.input-bar {
  display: flex; align-items: center; padding: 9px 14px;
  background: var(--bg-elev-1); border-top: 0.5px solid var(--line-hair); gap: 8px;
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
  /* Lifted above the soft keyboard via :style translateY (useKeyboardHeight). */
  transition: transform 0.22s ease-out; will-change: transform;
}
.msg-input {
  flex: 1; min-height: 40px; max-height: 120px; background: var(--bg-subtle);
  border-radius: 20px; box-sizing: border-box;
  padding: 9px 16px; line-height: 22px; font-size: 15px; color: var(--text-primary);
}
.send-btn {
  height: 40px; padding: 0 14px; background: var(--accent-primary);
  border-radius: 20px;
  display: flex; align-items: center; justify-content: center; gap: 5px;
  cursor: pointer; flex-shrink: 0;
  &.disabled { opacity: 0.45; pointer-events: none; }
  &:active { opacity: 0.7; }
}
/* Labelled pill (QA6 #6): the bare paper-plane icon wasn't obvious as the
   send action; pairing it with a 发送/Send text makes the affordance clear.
   nowrap so the label never wraps on ultra-narrow viewports. */
.send-label { font-size: 14px; font-weight: 600; color: #fff; line-height: 1; white-space: nowrap; }
</style>
