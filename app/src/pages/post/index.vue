<template>
  <view class="page secondary-page secondary-page--post has-sidebar" :class="mpThemeClass" :style="[mpChrome, viewportStyle]">
    <!-- #ifdef H5 -->
    <AppSidebar current="plaza" />
    <!-- #endif -->
    <view class="secondary-content">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title" role="heading" aria-level="1">{{ t('plaza.title') }}</text>
      <view v-if="post && currentUser?.id === post.user_id" class="more-btn" role="button" :aria-label="t('a11y.more')" @click="onDelete">
        <view class="mb-dot"></view><view class="mb-dot"></view><view class="mb-dot"></view>
      </view>
      <view v-else style="width: 32px;"></view>
    </view>

    <scroll-view v-if="post && !authorBlocked" class="body" scroll-y>
      <view
        class="post-card"
        role="group"
        tabindex="0"
        :aria-label="post.title ? `${post.title}: ${displayContent}` : displayContent"
        aria-keyshortcuts="Shift+F10"
        @keydown="onPostKeyboardMenu"
        @touchstart="postLongPress.onTouchstart()"
        @touchend="postLongPress.onTouchend"
        @touchcancel="postLongPress.onTouchcancel"
        @touchmove="postLongPress.onTouchmove"
      >
        <view class="post-head">
          <UAvatar :src="post.profile?.avatar_url" :owner="post.user_id" :fallback="defaultAvatarSrc" :alt="post.profile?.nickname || 'avatar'" class="avatar" role="button" @click.stop="goSeller(post.user_id)" />
          <view class="head-info">
            <view class="head-name-row">
              <text class="head-name" role="button" @click.stop="goSeller(post.user_id)">{{ post.profile?.nickname || t('app.user') }}</text>
              <UBadge v-if="post.is_official" variant="official" :label="t('plaza.official')" />
              <UBadge v-else-if="post.profile?.is_illini_verified" variant="illini" :label="t('profile.illiniVerified')" />
              <view v-if="post.is_pinned" class="badge-pinned"><text class="badge-pinned-label">{{ t('plaza.pinned') }}</text></view>
            </view>
            <text class="head-time">{{ formatTime(post.created_at) }}</text>
          </view>
        </view>

        <text v-if="post.category" class="post-board" role="button" tabindex="0"
          @click.stop="openCommunityBoard(post.category)"
          @keydown.enter.prevent="openCommunityBoard(post.category)"
          @keydown.space.prevent="openCommunityBoard(post.category)">{{ t(`plaza.category.${post.category}`) }}</text>
        <text v-if="post.title" class="post-topic-title" role="heading" aria-level="2">{{ post.title }}</text>
        <view class="content-wrap">
          <text class="content">{{ displayContent }}</text>
          <view
            v-if="post.content && post.content.trim().length > 0"
            :class="['translate-btn', { loading: translatePending }]"
            role="button"
            :aria-label="t('a11y.translate')"
            @click.stop="toggleTranslate"
          >
            <text v-if="!translatePending" class="translate-btn-label">{{ t(displayContent !== post.content ? 'detail.showOriginal' : 'detail.showTranslation') }}</text>
            <text v-else class="translate-btn-label">···</text>
          </view>
        </view>

        <view v-if="post.images && post.images.length > 0" class="images">
          <!--
            Each image reserves its exact slot via DB-persisted dims
            (migration 014). widthFix is kept as a belt-and-braces
            fallback for pre-014 rows whose image_dimensions is null;
            object-fit: contain guarantees no stretching even when the
            clamp in dimsToAspectStyle kicks in on extreme uploads.
          -->
          <image
            v-for="(img, i) in post.images"
            :key="i"
            :src="img"
            :alt="'Post photo'"
            mode="widthFix"
            class="post-img"
            role="button"
            :aria-label="t('a11y.previewImage')"
            :style="dimsToAspectStyle(effectiveDims(), i)"
            @load="onImgLoad($event, i)"
            @click="previewImage(post.images, i)"
          />
        </view>

        <view v-if="attachBannerVisible" class="attach-pending" role="status">
          <text class="attach-pending-text">{{ attachBannerText }}</text>
          <text v-if="attachNotice" class="attach-pending-note">{{ attachNotice }}</text>
          <view class="attach-pending-actions">
            <view class="attach-pending-btn primary" :class="{ disabled: attachBusy }" role="button"
              :aria-disabled="attachBusy ? 'true' : 'false'" @click="onRetryAttach">
              <text>{{ attachBusy ? t('plaza.attaching') : t('plaza.attachRetry') }}</text>
            </view>
            <view class="attach-pending-btn" role="button" @click="onDismissAttach">
              <text>{{ t('plaza.attachDismiss') }}</text>
            </view>
          </view>
        </view>
        <text v-else-if="attachNotice" class="attach-pending-note standalone" role="status">{{ attachNotice }}</text>

        <view
          v-for="pi in (post.post_items || [])"
          :key="pi.item.id"
          class="attached-item-card"
          role="button"
          :aria-label="localize(pi.item.title_i18n, pi.item.title)"
          @click.stop="goToAttachedItem(pi.item.id)"
        >
          <image
            v-if="thumbUrl(pi.item.images?.[0], 'list')"
            :src="thumbUrl(pi.item.images?.[0], 'list')"
            class="aic-img"
            mode="aspectFill"
            lazy-load
            :alt="localize(pi.item.title_i18n, pi.item.title)"
          />
          <view v-else class="aic-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">玉</text></view>
          <view class="aic-body">
            <text class="aic-title">{{ localize(pi.item.title_i18n, pi.item.title) }}</text>
            <!-- SPEC 6.6: the price, whether the item can still be had, and whether it is the reader's own. -->
            <view class="aic-meta">
              <text class="aic-price">{{ listingPriceLabel(pi.item, t) }}</text>
              <text :class="['aic-tag', `aic-tag-${pi.item.status}`]">{{ t(refStatusKey(pi.item.status)) }}</text>
              <text v-if="currentUser && pi.item.user_id === currentUser.id" class="aic-tag">{{ t('plaza.ref.mine') }}</text>
            </view>
          </view>
          <UIcon name="chevron-right" size="sm" color="text-faint" />
        </view>

        <view class="stats-row">
          <view class="stat-btn" role="button" :aria-label="post.liked_by_me ? t('a11y.unlike') : t('a11y.like')" :aria-pressed="post.liked_by_me ? 'true' : 'false'" @click="onToggleLike">
            <image
              :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'"
              alt=""
              class="heart-img"
            />
            <text :class="['stat-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
          </view>
          <view class="stat-btn">
            <UIcon name="messages" size="sm" color="text-muted" />
            <text class="stat-num">{{ post.comment_count }}</text>
          </view>
          <view class="stat-btn" role="button" :aria-label="t('a11y.share')" @click="onShare">
            <UIcon name="share" size="sm" color="text-muted" />
          </view>
        </view>
      </view>

      <view class="comments-section">
        <view class="cs-header">
          <text class="cs-title">{{ t('plaza.comments') }} ({{ post.comment_count || 0 }})</text>
        </view>
        <view v-if="commentsError" class="cs-empty cs-error" role="alert" aria-live="assertive">
          <text>{{ t('error.loadFailed') }}</text>
          <view class="cs-retry" role="button" tabindex="0" @click.stop="retryComments" @keydown.enter.prevent="retryComments" @keydown.space.prevent="retryComments">{{ t('home.retry') }}</view>
        </view>
        <view v-else-if="comments.length === 0 && !loadingComments" class="cs-empty">
          <text>{{ t('plaza.noComments') }}</text>
        </view>
        <template v-for="thread in commentThreads" :key="thread.parent.id">
          <view
            class="cs-item u-rise"
            role="group"
            tabindex="0"
            :aria-label="localize(thread.parent.content_i18n, thread.parent.content)"
            aria-keyshortcuts="Shift+F10"
            @keydown="onCommentKeyboardMenu($event, thread.parent)"
            @touchstart="commentLongPress.onTouchstart(thread.parent)"
            @touchend="commentLongPress.onTouchend"
            @touchcancel="commentLongPress.onTouchcancel"
            @touchmove="commentLongPress.onTouchmove"
          >
            <UAvatar
              :src="thread.parent.profile?.avatar_url"
              :owner="thread.parent.user_id"
              :fallback="defaultAvatarSrc"
              :alt="thread.parent.profile?.nickname || 'avatar'"
              class="cs-avatar"
              lazy
            />
            <view class="cs-body">
              <view class="cs-top">
                <text class="cs-name">{{ thread.parent.profile?.nickname || t('app.user') }}</text>
                <text class="cs-time">{{ formatTime(thread.parent.created_at) }}</text>
              </view>
              <text class="cs-content">{{ localize(thread.parent.content_i18n, thread.parent.content) }}</text>
              <view class="cs-actions">
                <view class="cs-like-btn hit-target" role="button" :aria-label="thread.parent.liked_by_me ? t('a11y.unlike') : t('a11y.like')" :aria-pressed="thread.parent.liked_by_me ? 'true' : 'false'" @click.stop="onToggleCommentLike(thread.parent)">
                  <image :src="thread.parent.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'" alt="" class="cs-heart-img" />
                  <text v-if="(thread.parent.like_count ?? 0) > 0" :class="['cs-like-num', { active: thread.parent.liked_by_me }]">{{ thread.parent.like_count }}</text>
                </view>
                <text class="cs-reply-btn hit-target" role="button" @click.stop="onCommentTap(thread.parent)">{{ t('plaza.reply') }}</text>
              </view>
            </view>
          </view>

          <template v-if="thread.children.length > 0">
            <view
              v-for="child in (expandedReplies.has(thread.parent.id) ? thread.children : thread.children.slice(0, 3))"
              :key="child.id"
              class="cs-item cs-item-child"
              role="group"
              tabindex="0"
              :aria-label="localize(child.content_i18n, child.content)"
              aria-keyshortcuts="Shift+F10"
              @keydown="onCommentKeyboardMenu($event, child)"
              @touchstart="commentLongPress.onTouchstart(child)"
              @touchend="commentLongPress.onTouchend"
              @touchcancel="commentLongPress.onTouchcancel"
              @touchmove="commentLongPress.onTouchmove"
            >
              <UAvatar
                :src="child.profile?.avatar_url"
                :owner="child.user_id"
                :fallback="defaultAvatarSrc"
                :alt="child.profile?.nickname || 'avatar'"
                class="cs-avatar"
                lazy
              />
              <view class="cs-body">
                <view class="cs-top">
                  <text class="cs-name">{{ child.profile?.nickname || t('app.user') }}</text>
                  <text class="cs-time">{{ formatTime(child.created_at) }}</text>
                </view>
                <text class="cs-content">{{ localize(child.content_i18n, child.content) }}</text>
                <view class="cs-actions">
                  <view class="cs-like-btn hit-target" role="button" :aria-label="child.liked_by_me ? t('a11y.unlike') : t('a11y.like')" :aria-pressed="child.liked_by_me ? 'true' : 'false'" @click.stop="onToggleCommentLike(child)">
                    <image :src="child.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'" alt="" class="cs-heart-img" />
                    <text v-if="(child.like_count ?? 0) > 0" :class="['cs-like-num', { active: child.liked_by_me }]">{{ child.like_count }}</text>
                  </view>
                  <text class="cs-reply-btn hit-target" role="button" @click.stop="onCommentTap(child)">{{ t('plaza.reply') }}</text>
                </view>
              </view>
            </view>

            <view
              v-if="thread.children.length > 3"
              class="cs-expand-link cs-item-child"
              role="button"
              @click="toggleReplies(thread.parent.id)"
            >
              <text class="cs-expand-text">
                {{ expandedReplies.has(thread.parent.id)
                    ? t('plaza.hideReplies')
                    : t('plaza.viewMoreReplies', { count: thread.children.length - 3 }) }}
              </text>
            </view>
          </template>
        </template>
      </view>
    </scroll-view>

    <!-- SPEC 6.4: a topic by someone the reader has blocked says so, with the way to undo it. -->
    <view v-else-if="post" class="not-found">
      <text>{{ t('plaza.blockedAuthor') }}</text>
      <view class="back-home" role="button" :aria-disabled="unblocking ? 'true' : 'false'" @click="onUnblockAuthor">{{ t('plaza.unblock') }}</view>
    </view>

    <view v-else-if="loading" class="loading">
      <text>{{ t('home.loading') }}</text>
    </view>

    <!--
      A failed fetch is not a missing post. Reporting "this post does not
      exist" after a dropped connection or a 500 tells the user their content
      is gone and leaves them no way back in; the only honest options are to
      name the failure and offer a retry. See pages/detail/index.vue for the
      same three-state split.
    -->
    <view v-else-if="loadError" class="not-found" role="alert" aria-live="assertive">
      <text>{{ t('error.loadFailed') }}</text>
      <view class="back-home" role="button" :aria-label="t('home.retry')" @click="loadPostForCurrentAccount">{{ t('home.retry') }}</view>
    </view>

    <view v-else class="not-found">
      <text>{{ t('plaza.notFound') }}</text>
      <view class="back-home" role="button" @click="goPlaza">{{ t('plaza.backToPlaza') }}</view>
    </view>

    <view v-if="post && !authorBlocked" class="input-wrapper" :style="kbLift">
      <view v-if="replyTo && !replyRestricted" class="reply-bar">
        <text class="reply-label">{{ t('plaza.replyingTo') }} @{{ replyTo.profile?.nickname || t('app.user') }}</text>
        <view class="reply-x" role="button" :aria-label="t('a11y.close')" @click="replyTo = null">
          <view class="rx-inner"></view>
        </view>
      </view>
      <view v-if="replyRestricted" class="input-bar reply-restricted" role="status">
        <text>{{ t('plaza.restrictedReply') }}</text>
      </view>
      <view v-else :class="['input-bar', { 'has-note': replyFailed }]">
        <input
          v-model="commentText"
          :placeholder="replyTo ? t('plaza.replyHint') : t('plaza.commentHint')"
          :aria-label="replyTo ? t('plaza.replyHint') : t('plaza.commentHint')"
          class="input"
          confirm-type="send"
          :adjust-position="false"
          :cursor-spacing="8"
          @confirm="onSubmitComment"
          maxlength="1000"
        />
        <view
          :class="['send-btn', { disabled: !commentText.trim() || submitting }]"
          role="button"
          :aria-label="replyTo ? t('plaza.reply') : t('plaza.comment')"
          :aria-disabled="!commentText.trim() || submitting ? 'true' : 'false'"
          @click="onSubmitComment"
        >
          <text class="send-btn-label">{{ replyTo ? t('plaza.reply') : t('plaza.comment') }}</text>
        </view>
      </view>
      <!-- SPEC 6.4: a reply that did not go out stays in the box, and this line sends it again.
           Not while the account is restricted: the notice above replaces the input, and a retry would only be refused. -->
      <view v-if="replyFailed && !replyRestricted" class="reply-failed" role="button" @click="retryReply">
        <text class="reply-failed-t">{{ t('plaza.replyFailed') }}</text>
      </view>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// #ifdef H5
import AppSidebar from '../../components/AppSidebar.vue'
// #endif
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { onLoad, onUnload, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useTheme } from '../../composables/useTheme'
import { usePlaza, groupCommentsByParent, readPendingPostItems, rememberPendingPostItems } from '../../composables/usePlaza'
import { useSupabase } from '../../composables/useSupabase'
import { useModeration } from '../../composables/useModeration'
import { useHistory } from '../../composables/useHistory'
import { useTranslate } from '../../composables/useTranslate'
import { useLongPress } from '../../composables/useLongPress'
import { useKeyboardHeight } from '../../composables/useKeyboardHeight'
import { useVisualViewportBounds } from '../../composables/useVisualViewportInset'
import { createOwnedLoading } from '../../composables/ownedLoading'
import { openCommunityBoard } from '../../api/communityNavigation'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../../composables/accountScope'
import { mutationCommitState } from '../../api/mutationCommit'
import { clearLocalDuplicate } from '../../utils/contentSafety'
import { formatTime, friendlyErrorMessage, navigateBackOr, quickTranslate, thumbUrl, listingPriceLabel } from '../../utils'
import { DIALOG_DANGER, DIALOG_INK } from '../../utils/dialogColors'
import { isSuspensionActive } from '../../utils/suspension'
import { dimsToAspectStyle, readNaturalDims } from '../../utils/imgStyle'
import type { ImageDim, Post, PostComment } from '../../types'
import { BASE_URL } from '../../config/runtime'
import UBadge from '../../components/UBadge.vue'
import UAvatar from '../../components/UAvatar.vue'
import UIcon from '../../components/UIcon.vue'

const { t, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, requireAuth, awaitAuthReady } = useAuth()
const replyRestricted = computed(() => isSuspensionActive(currentUser.value))
const { fetchPost, deletePost, toggleLike, toggleCommentLike, fetchComments, createComment, deleteComment, retryAttachPostItems } = usePlaza()
const { supabase } = useSupabase()
const { reportTarget, blockedIds, ensureLoaded: ensureBlockedLoaded, unblockUser } = useModeration()
const { addPostToHistory } = useHistory()

// Mini programs lift the input from their native keyboard event. H5 resizes
// the whole flex layout so the scroll area and input share the visible bounds.
const kb = useKeyboardHeight()
const kbLift = computed(() => (kb.height.value ? { transform: `translateY(-${kb.height.value}px)` } : undefined))
const { bottomInset, visibleHeight } = useVisualViewportBounds()
const viewportStyle = computed(() => visibleHeight.value == null ? undefined : ({
  position: 'fixed' as const, left: '0', right: '0', top: 'auto',
  bottom: `${bottomInset.value}px`, height: `${visibleHeight.value}px`,
}))

const post = ref<Post | null>(null)
// SPEC 6.6: a linked item's card says whether it can still be had.
const refStatusKey = (status: string) => status === 'sold' ? 'plaza.ref.sold'
  : status === 'reserved' ? 'plaza.ref.reserved' : 'plaza.ref.available'
// SPEC 6.4: the reader blocked this author. The block list hides their posts from
// the lists; a direct link lands here, so the page says why it shows nothing.
const authorBlocked = computed(() => !!post.value && !!currentUser.value && blockedIds.value.has(post.value.user_id))
const unblocking = ref(false)
async function onUnblockAuthor() {
  const blocked = post.value
  if (!blocked || unblocking.value) return
  unblocking.value = true
  try {
    await unblockUser(blocked.user_id)
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  } finally {
    unblocking.value = false
  }
}
// P2.7: items this author's just-published post could not link (author only).
const attachPendingIds = ref<string[]>([])
const attachItemNames = ref<Record<string, string>>({})
const attachBusy = ref(false)
const attachNotice = ref('')
const attachBannerVisible = computed(() => !!post.value && !!currentUser.value
  && currentUser.value.id === post.value.user_id && attachPendingIds.value.length > 0)
const attachBannerText = computed(() => {
  const ids = attachPendingIds.value
  const name = attachItemNames.value[ids[0]] || ''
  return ids.length > 1 ? t('plaza.attachPending', { name, n: ids.length }) : t('plaza.attachPendingOne', { name })
})

async function loadAttachPending(p: Post) {
  attachPendingIds.value = []
  attachNotice.value = ''
  const accountId = currentUser.value?.id
  if (!accountId || accountId !== p.user_id) return
  const ids = readPendingPostItems(accountId, p.id)
  if (ids.length === 0) return
  try {
    const { data } = await supabase.from('items').select('id, title, title_i18n').in('id', ids)
    const names: Record<string, string> = {}
    for (const row of (data || []) as Array<{ id: string; title: string; title_i18n: Record<string, string> | null }>) {
      names[row.id] = localize(row.title_i18n, row.title)
    }
    attachItemNames.value = names
  } catch { attachItemNames.value = {} }
  if ((currentUser.value?.id ?? null) === accountId && post.value?.id === p.id) attachPendingIds.value = ids
}

async function onRetryAttach() {
  const p = post.value
  if (!p || attachBusy.value || attachPendingIds.value.length === 0) return
  attachBusy.value = true
  attachNotice.value = ''
  try {
    const result = await retryAttachPostItems(p.id, attachPendingIds.value)
    if (post.value?.id !== p.id) return
    attachPendingIds.value = result.pending
    if (result.unavailable.length) attachNotice.value = t('plaza.attachUnavailable')
    else if (result.capped.length) attachNotice.value = t('plaza.attachCap')
    if (result.linked.length) {
      const refreshed = await fetchPost(p.id).catch(() => null)
      if (refreshed && post.value?.id === p.id) post.value = refreshed
      if (!result.pending.length && !result.unavailable.length && !result.capped.length) {
        uni.showToast({ title: t('plaza.attachDone'), icon: 'success' })
      }
    }
  } finally {
    attachBusy.value = false
  }
}

function onDismissAttach() {
  const p = post.value
  const accountId = currentUser.value?.id
  if (p && accountId) rememberPendingPostItems(accountId, p.id, [])
  attachPendingIds.value = []
  attachNotice.value = ''
}
const comments = ref<PostComment[]>([])
const loading = ref(true)
const loadingComments = ref(false)
// Distinct from "post is null": a transport failure must not render as a
// missing post. Only the catch in loadPostForCurrentAccount sets this.
const loadError = ref(false)
// The same distinction for the comment list, which has its own request.
const commentsError = ref(false)
const commentText = ref('')
const replyTo = ref<PostComment | null>(null)
const submitting = ref(false)
// SPEC 6.4: a reply whose send failed stays in the box, with a line under it to
// send it again. failedReply is what that send carried, so the retry can tell
// whether it was written after all.
const replyFailed = ref(false)
let failedReply: { text: string; typed: string; token: AccountRequestToken } | null = null
watch(commentText, typed => {
  // The line belongs to the text that failed, not to whatever is typed next.
  if (replyFailed.value && typed !== failedReply?.typed) replyFailed.value = false
})
let postLoadEpoch = 0
let commentsLoadEpoch = 0
const reportLoading = createOwnedLoading()
let pageMounted = true

function resetPostAccountState() {
  postLoadEpoch += 1
  commentsLoadEpoch += 1
  commentText.value = ''
  replyTo.value = null
  submitting.value = false
  replyFailed.value = false
  failedReply = null
  translated.value = false
  originalShown.value = false
  translationEpoch += 1
  translatedContent.value = ''
  if (post.value) post.value.liked_by_me = false
  comments.value = comments.value.map(comment => ({ ...comment, liked_by_me: false }))
  reportLoading.cancel()
}

const stopAccountTransitionListener = onAccountTransition(resetPostAccountState)
onUnmounted(() => {
  pageMounted = false
  postLoadEpoch += 1
  commentsLoadEpoch += 1
  reportLoading.cancel()
  stopAccountTransitionListener()
})

watch(() => currentUser.value?.id ?? null, (userId, previousUserId) => {
  if (userId === previousUserId) return
  // This route can survive an auth event long enough for the next profile to
  // render. Never expose the previous account's in-progress comment draft.
  commentText.value = ''
  replyTo.value = null
  attachPendingIds.value = []
  attachNotice.value = ''
  if (postId.value) void loadPostForCurrentAccount()
})

// Per-thread expand state. Stores top-level comment ids whose >3 replies
// are unfolded. Replaced (not mutated) on toggle so Vue's Set reactivity
// reliably triggers re-render across both H5 and mp-weixin runtimes.
const expandedReplies = ref<Set<string>>(new Set())

function toggleReplies(parentId: string) {
  const next = new Set(expandedReplies.value)
  if (next.has(parentId)) next.delete(parentId)
  else next.add(parentId)
  expandedReplies.value = next
}

const commentThreads = computed(() => groupCommentsByParent(comments.value))

const postId = ref('')

/*
 * Render-side safety net for post.image_dimensions.
 *
 * See pages/index/index.vue for the contract. Single-post variant: the
 * cache is a plain array (no id keying needed) since this page renders
 * exactly one post. DB values always win; onImgLoad only patches the
 * idx when the DB slot is missing or 0×0.
 */
const measuredDims = ref<ImageDim[]>([])

function effectiveDims(): ImageDim[] | null {
  const fromDb = post.value?.image_dimensions
  if (Array.isArray(fromDb) && fromDb.length > 0 && fromDb.some((d) => d && d.w > 0 && d.h > 0)) {
    return fromDb
  }
  return measuredDims.value.length > 0 ? measuredDims.value : null
}

function onImgLoad(e: any, idx: number) {
  const fromDb = post.value?.image_dimensions
  if (Array.isArray(fromDb) && fromDb[idx] && fromDb[idx].w > 0 && fromDb[idx].h > 0) return
  const natural = readNaturalDims(e)
  if (!natural) return
  const next = measuredDims.value.slice()
  next[idx] = natural
  measuredDims.value = next
}

/* ---------- AI translation (post content)
   Mirrors the detail-page pattern: cache-first, A文/文A toggle,
   static-dictionary fallback when /api/translate is unavailable or the
   OPENAI_API_KEY isn't set on the edge function. */
const { translate: translateText, getCached, pending: translatePending } = useTranslate()
const translated = ref(false)
const originalShown = ref(false)
let translationEpoch = 0
const translatedContent = ref('')

/*
 * Same two-layer pattern as the item detail page:
 *   - default:  localize(post.content_i18n, post.content) picks the
 *               pre-translated entry from the jsonb map, falling back
 *               to the author's original on a missing/legacy row
 *   - A文 mode: the user explicitly asked for an AI re-translation
 */
const displayContent = computed(() => {
  if (!post.value) return ''
  if (originalShown.value) return post.value.content
  if (translated.value && translatedContent.value) return translatedContent.value
  return localize(post.value.content_i18n, post.value.content)
})

async function ensureTranslation() {
  const source = post.value
  if (!source?.content) return
  const target = lang.value as 'en' | 'zh'
  const epoch = translationEpoch
  const loadEpoch = postLoadEpoch
  const cached = getCached(source.content, target)
  translatedContent.value = cached || quickTranslate(source.content, target)
  if (cached) return
  const result = await translateText(source.content, target)
  if (pageMounted && epoch === translationEpoch && loadEpoch === postLoadEpoch
    && lang.value === target && post.value?.id === source.id && post.value.content === source.content && result) {
    translatedContent.value = result
  }
}

async function toggleTranslate() {
  if (!post.value) return
  if (displayContent.value !== post.value.content) {
    originalShown.value = true
    return
  }
  originalShown.value = false
  if (displayContent.value !== post.value.content) return
  const epoch = translationEpoch
  await awaitAuthReady()
  if (epoch !== translationEpoch || !requireAuth()) return
  translated.value = true
  await ensureTranslation()
}

watch(lang, () => {
  translationEpoch += 1
  originalShown.value = false
  translated.value = false
  translatedContent.value = ''
})

onLoad((options) => {
  if (options?.id) {
    postId.value = options.id as string
  }
})

onUnload(() => {
  expandedReplies.value = new Set()
})

onShareAppMessage(() => {
  const p = post.value
  if (!p) return { title: t('share.plaza'), path: '/pages/plaza/index' }
  const firstLine = Array.from((p.title || localize(p.content_i18n, p.content || '')).split('\n')[0]).slice(0, 50).join('').trim() || t('share.plaza')
  return {
    title: firstLine,
    path: `/pages/post/index?id=${p.id}`,
    imageUrl: p.images?.[0] || '',
  }
})

onShareTimeline(() => {
  const p = post.value
  if (!p) return { title: t('share.plaza') }
  const firstLine = Array.from((p.title || localize(p.content_i18n, p.content || '')).split('\n')[0]).slice(0, 50).join('').trim() || t('share.plaza')
  return {
    title: firstLine,
    query: `id=${p.id}`,
    imageUrl: p.images?.[0] || '',
  }
})

onMounted(() => {
  void loadPostForCurrentAccount()
})

async function loadPostForCurrentAccount() {
  if (!postId.value) {
    loading.value = false
    return
  }
  const requestEpoch = ++postLoadEpoch
  const commentsRequestEpoch = ++commentsLoadEpoch
  loading.value = true
  loadingComments.value = true
  loadError.value = false
  commentsError.value = false
  try {
    // fetchPost/fetchComments annotate liked_by_me from currentUser. Wait for
    // session hydration so a cold deep link does not permanently render every
    // like as belonging to an anonymous viewer.
    await awaitAuthReady()
    if (!pageMounted || requestEpoch !== postLoadEpoch) return
    // The block list decides what this page shows, so it is read before the topic.
    // If it cannot be read the topic still opens: a block hides, it does not gate.
    if (currentUser.value) await ensureBlockedLoaded()
    if (!pageMounted || requestEpoch !== postLoadEpoch) return
    const p = await fetchPost(postId.value)
    if (!pageMounted || requestEpoch !== postLoadEpoch) return
    if (p) {
      post.value = p
      addPostToHistory(p)
      void loadAttachPending(p)
      try {
        const rows = await fetchComments(postId.value)
        if (!pageMounted || requestEpoch !== postLoadEpoch || commentsRequestEpoch !== commentsLoadEpoch) return
        comments.value = rows
        commentsError.value = false
      } catch (err: any) {
        if (!pageMounted || requestEpoch !== postLoadEpoch || commentsRequestEpoch !== commentsLoadEpoch) return
        // Same discipline the outer catch applies to the post: a transport
        // failure must not read as "nobody has commented". Without this the
        // header still says (12) while the body says the thread is empty, and
        // the toast that explained it is gone in 2.5s.
        commentsError.value = true
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
      }
    }
  } catch (err: any) {
    if (!pageMounted || requestEpoch !== postLoadEpoch) return
    // Only a transport/server failure lands here — fetchPost resolves to null
    // for a genuinely missing row. Keeping the two apart is what stops the
    // page from claiming the post was deleted when the network dropped.
    loadError.value = true
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
  } finally {
    if (pageMounted && requestEpoch === postLoadEpoch) {
      loading.value = false
      if (commentsRequestEpoch === commentsLoadEpoch) loadingComments.value = false
    }
  }
}

async function retryComments() {
  if (!postId.value || loadingComments.value) return
  const requestPostEpoch = postLoadEpoch
  const requestCommentsEpoch = ++commentsLoadEpoch
  const requestPostId = postId.value
  const requestAccountId = currentUser.value?.id ?? null
  const isCurrent = () => (
    pageMounted
    && requestPostEpoch === postLoadEpoch
    && requestCommentsEpoch === commentsLoadEpoch
    && postId.value === requestPostId
    && (currentUser.value?.id ?? null) === requestAccountId
  )
  loadingComments.value = true
  commentsError.value = false
  try {
    const rows = await fetchComments(requestPostId)
    if (!isCurrent()) return
    comments.value = rows
  } catch (err: any) {
    if (!isCurrent()) return
    commentsError.value = true
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    if (isCurrent()) loadingComments.value = false
  }
}

function goBack() { navigateBackOr(goPlaza) }
function goPlaza() { uni.switchTab({ url: '/pages/plaza/index' }) }
function goToAttachedItem(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}
/* Author avatar/name → seller page (default 商品 tab — meeting decision). */
function goSeller(userId: string) {
  uni.navigateTo({ url: `/pages/seller/index?id=${userId}` })
}

async function onToggleLike() {
  await awaitAuthReady()
  if (!requireAuth() || !post.value) return
  try {
    await toggleLike(post.value)
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
  }
}

function onShare() {
  if (!post.value) return
  /* Server-side OG meta renders at /share-post/:id. See api/share-post.js. */
  let origin = BASE_URL
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) origin = window.location.origin
  // #endif
  const url = `${origin}/share-post/${post.value.id}`
  const preview = (post.value.title || post.value.content).slice(0, 60).replace(/\n/g, ' ')
  uni.setClipboardData({
    data: `${preview}…\n${url}`,
    success: () => uni.showToast({ title: t('plaza.contentCopied'), icon: 'success' }),
  })
}

function previewImage(urls: string[], idx: number) {
  uni.previewImage({ urls, current: urls[idx] })
}

function onDelete() {
  if (!post.value || !currentUser.value) return
  const postId = post.value.id
  const actionEpoch = postLoadEpoch
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionIsCurrent = () => (
    actionEpoch === postLoadEpoch
    && isAccountRequestCurrent(accountToken)
    && post.value?.id === postId
  )
  uni.showModal({
    title: t('plaza.deleteConfirm'),
    confirmColor: DIALOG_DANGER,
    success: async (r) => {
      if (!r.confirm || !actionIsCurrent()) return
      try {
        await deletePost(postId)
        if (!actionIsCurrent()) return
        uni.showToast({ title: t('profile.deleted'), icon: 'success' })
        setTimeout(() => { if (actionIsCurrent()) goBack() }, 800)
      } catch (err: any) {
        if (!actionIsCurrent()) return
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
      }
    },
  })
}

async function onCommentTap(c: PostComment) {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  if (replyRestricted.value) return
  replyTo.value = c
}

async function onToggleCommentLike(comment: PostComment) {
  await awaitAuthReady()
  if (!requireAuth()) return
  try {
    await toggleCommentLike(comment)
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  }
}

/* 1.5s + haptic — same rationale as the home feed and plaza pages.
   Long-press here surfaces report / delete actions; we want
   deliberate intent before either fires. Tuned 3s → 2s in batch #2,
   then 2s → 1.5s in batch #3a — 2s still tested as draggy in user
   acceptance; 1.5s keeps the deliberate-intent gate without feeling
   like waiting. Both post and comment longpress move together so the
   feel of the post detail surface is consistent. */
const postLongPress = useLongPress<[]>(() => onPostLongPress(), 1500)
const commentLongPress = useLongPress<[PostComment]>((c) => onCommentLongPress(c), 1500)

function onPostKeyboardMenu(event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  event.stopPropagation()
  void onPostLongPress()
}

function onCommentKeyboardMenu(event: KeyboardEvent, comment: PostComment) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  event.stopPropagation()
  void onCommentLongPress(comment)
}

async function onCommentLongPress(c: PostComment) {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  const isMine = c.user_id === currentUser.value.id
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = postLoadEpoch
  const actionPostId = post.value?.id || ''
  const actionIsCurrent = () => (
    actionEpoch === postLoadEpoch
    && isAccountRequestCurrent(accountToken)
    && post.value?.id === actionPostId
  )
  const items = isMine
    ? [t('plaza.delete')]
    : [t('plaza.reply'), t('plaza.reportComment'), t('plaza.reportUser')]
  uni.showActionSheet({
    itemList: items,
    itemColor: isMine ? DIALOG_DANGER : DIALOG_INK,
    success: (res) => {
      if (!actionIsCurrent()) return
      if (isMine && res.tapIndex === 0) {
        uni.showModal({
          title: t('plaza.commentDeleteConfirm'),
          confirmColor: DIALOG_DANGER,
          success: async (r) => {
            if (!r.confirm || !actionIsCurrent()) return
            try {
              await deleteComment(c.id, actionPostId)
              if (!actionIsCurrent()) return
              comments.value = comments.value.filter(x => x.id !== c.id)
              // Mirror the add path (line ~597) — usePlaza.deleteComment only
              // decrements the feed-list copy, not this detail page's post ref,
              // so the header count would otherwise go stale.
              if (post.value) post.value.comment_count = Math.max(0, (post.value.comment_count || 0) - 1)
            } catch (err: any) {
              if (!actionIsCurrent()) return
              uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
            }
          },
        })
      } else if (!isMine && res.tapIndex === 0) {
        if (replyRestricted.value) return
        replyTo.value = c
      } else if (!isMine && res.tapIndex === 1) {
        promptReport('comment', c.id)
      } else if (!isMine && res.tapIndex === 2) {
        promptReportUser(c.user_id)
      }
    },
  })
}

function promptReportUser(userId: string) {
  promptReport('user', userId)
}

async function onPostLongPress() {
  if (!post.value) return
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  if (post.value.user_id === currentUser.value.id) return
  const postId = post.value.id
  const userId = post.value.user_id
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = postLoadEpoch
  uni.showActionSheet({
    itemList: [t('report.reportPost'), t('report.reportUser')],
    success: (res) => {
      if (actionEpoch !== postLoadEpoch || !isAccountRequestCurrent(accountToken) || post.value?.id !== postId) return
      if (res.tapIndex === 0) promptReport('post', postId)
      else if (res.tapIndex === 1) promptReport('user', userId)
    },
  })
}

function promptReport(targetType: 'post' | 'user' | 'item' | 'comment', targetId: string) {
  if (!currentUser.value) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = postLoadEpoch
  const actionIsCurrent = () => actionEpoch === postLoadEpoch && isAccountRequestCurrent(accountToken)
  const reasons = targetType === 'user'
    ? [t('report.reasonSpam'), t('report.reasonAbuse'), t('report.reasonMisleading'), t('report.reasonOther')]
    : [t('report.reasonSpam'), t('report.reasonProhibited'), t('report.reasonMisleading'), t('report.reasonOther')]
  uni.showActionSheet({
    itemList: reasons,
    success: async (res) => {
      if (!actionIsCurrent()) return
      const reason = reasons[res.tapIndex]
      const loadingOwner = reportLoading.show(t('report.submitting') || t('login.wait'))
      try {
        await reportTarget(targetType, targetId, reason)
        reportLoading.hide(loadingOwner)
        if (!actionIsCurrent()) return
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
        reportLoading.hide(loadingOwner)
        if (!actionIsCurrent()) return
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('report.failed'), icon: 'none' })
      }
    },
  })
}

async function onSubmitComment() {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  if (replyRestricted.value) return
  if (!commentText.value.trim() || !post.value) return
  if (submitting.value) return
  const commentAccountToken = captureAccountRequest(currentUser.value.id)
  const submittedText = commentText.value
  const submittedReply = replyTo.value
  submitting.value = true
  replyFailed.value = false
  let text = submittedText
  try {
    if (submittedReply) {
      const name = submittedReply.profile?.nickname || t('app.user')
      text = `@${name} ${text}`
    }
    // 单层缩进语义：parent 永远指向顶层祖先。若 replyTo 是子评论，跳一级；
    // 否则就是它自己。groupCommentsByParent 渲染时也会做 walk-up 防御。
    const parentId = submittedReply
      ? (submittedReply.parent_comment_id ?? submittedReply.id)
      : undefined
    const c = await createComment(post.value.id, text, parentId)
    if (!isAccountRequestCurrent(commentAccountToken)) return
    // fetchComments hydrates reply_to_name from DB on next refresh; for the
    // optimistic push here we mirror the same logic by reading replyTo's nickname.
    c.reply_to_name = submittedReply
      ? (submittedReply.profile?.nickname ?? null)
      : null
    comments.value.push(c)
    // A slow submission must not erase a new draft or a newly selected reply.
    if (commentText.value === submittedText && replyTo.value === submittedReply) {
      commentText.value = ''
      replyTo.value = null
    }
    if (post.value) post.value.comment_count = (post.value.comment_count || 0) + 1
    uni.showToast({ title: t('plaza.commented'), icon: 'success' })
  } catch (err: any) {
    if (!isAccountRequestCurrent(commentAccountToken)) return
    if (mutationCommitState(err) === 'unknown') {
      // The request went out and no answer says what became of it: a dropped
      // connection, a 5xx, a lost response. A refusal with a reason (a rule the
      // text broke, a rejected write) is not this, and keeps its own message.
      failedReply = { text: text.trim(), typed: submittedText, token: commentAccountToken }
      replyFailed.value = true
    } else {
      uni.showToast({
        title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
        icon: 'none',
        duration: 2500,
      })
    }
  } finally {
    if (isAccountRequestCurrent(commentAccountToken)) submitting.value = false
  }
}

async function retryReply() {
  if (replyRestricted.value) return
  const failed = failedReply
  const target = post.value
  if (!failed || !target || submitting.value || !isAccountRequestCurrent(failed.token)) return
  submitting.value = true
  try {
    // The failed send may have been written after all, its answer lost on the
    // way back. The thread says which: a reply that is there is shown, and only
    // one that is not is sent again.
    const rows = await fetchComments(target.id)
    if (!isAccountRequestCurrent(failed.token) || post.value?.id !== target.id) return
    comments.value = rows
    commentsError.value = false
    if (rows.some(row => row.user_id === failed.token.userId && row.content === failed.text)) {
      failedReply = null
      replyFailed.value = false
      if (commentText.value === failed.typed) {
        commentText.value = ''
        replyTo.value = null
      }
      target.comment_count = Math.max(target.comment_count || 0, rows.length)
      uni.showToast({ title: t('plaza.commented'), icon: 'success' })
      return
    }
    // Not there. createComment still holds this text as just sent; release it so the retry is not refused as a duplicate.
    clearLocalDuplicate(failed.token, `comment:${target.id}`, failed.text)
  } catch {
    // The thread cannot be read either. The line stays, to be tapped again.
    return
  } finally {
    if (isAccountRequestCurrent(failed.token)) submitting.value = false
  }
  await onSubmitComment()
}
</script>

<style lang="scss" scoped>
.secondary-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.page {
  height: 100vh; height: 100dvh;
  background: var(--bg-subtle);
  max-width: 480px; margin: 0 auto;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px;
  padding-top: calc(11px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  /* #ifdef MP-WEIXIN */
  /* keep the owner more-menu out from under the native capsule */
  padding-right: var(--mp-navbar-right-pad, 0px);
  /* #endif */
  background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
  flex-shrink: 0;
}
.back-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.header-title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text-primary); text-align: center; }
.more-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center; gap: 3px;
  cursor: pointer;
}
.mb-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); }

.body { flex: 1; min-height: 0; }

.loading, .not-found {
  padding: 80px 16px; text-align: center; color: var(--text-subtle); font-size: 14px;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
}
.back-home {
  padding: 10px 28px; background: var(--accent-primary); color: var(--ink-inverse);
  border-radius: 22px; font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.85; }
}

.post-card {
  background: var(--bg-elev-1); padding: 16px;
}
.post-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
.avatar { width: 42px; height: 42px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.head-info { flex: 1; min-width: 0; }
.head-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.head-name { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.head-time { font-size: 11px; color: var(--text-subtle); display: block; margin-top: 2px; }

/* official + illini badges → components/UBadge.vue (variants official/illini). */
.badge-pinned {
  background: var(--warning-soft); color: var(--warning-text);
  padding: 1px 6px; border-radius: 4px;
  .badge-pinned-label { font-size: 10px; font-weight: 600; color: var(--warning-text); letter-spacing: 0.02em; }
}

.content-wrap { display: flex; flex-direction: column; align-items: flex-start; }
.content {
  font-size: 15px; color: var(--text-primary); line-height: 1.55;
  white-space: pre-wrap; word-break: break-word; display: block;
}
.translate-btn {
  min-width: 80px; min-height: 44px; border-radius: 12px;
  background: var(--bg-subtle); padding: 0 12px; margin-top: 8px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  .translate-btn-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
  &:active { background: var(--bg-inset); }
  &.loading { opacity: 0.7; pointer-events: none; padding: 0 12px; }
}

.images { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.post-img {
  /*
   * IMPORTANT: no max-height and no object-fit here. An earlier version
   * capped height at 480px which, combined with mode="widthFix", produced
   * a "stretched horizontally" effect on tall images (the element was
   * forced to 100% width but the browser clipped the computed height).
   * We now let the image's true aspect ratio dictate height — tall photos
   * just render tall. Very extreme cases (e.g. 1:5) still look reasonable
   * because the card itself is max 480px wide on mobile.
   */
  width: 100%;
  height: auto;
  display: block;
  border-radius: 10px;
  background: var(--bg-subtle);
  cursor: pointer;
}

/*
 * Attached-item chips (mig 041 post_items join table).
 * Plaza list at pages/plaza/index.vue:148-167 + :1498-1511 has the
 * source pattern. Copied verbatim here with margin adjusted: plaza's
 * "margin: 8px 14px 0 54px" left-insets to align under the avatar
 * column; detail page has no avatar inset, so margin is "12px 0 0 0"
 * (top spacing only). Sibling rule tightens subsequent chips to 8px
 * since the first chip's 12px gap from .images already reads as a
 * section break. P2b sprint may extract this into a shared component
 * (AttachedItemChip.vue); for now M0 keeps the two copies in sync
 * via grep for ".attached-item-card".
 */
.attached-item-card {
  margin: 12px 0 0 0;
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg-subtle);
  cursor: pointer;
  &:active { background: var(--bg-inset); }
}
.attached-item-card + .attached-item-card {
  margin-top: 8px;
}
.aic-img { width: 52px; height: 52px; border-radius: 8px; flex-shrink: 0; }
.aic-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.aic-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aic-price { font-size: 14px; color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.aic-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); }
/* SPEC 6.6 status tags: neutral by default, the warning pair for a reserved item, quiet for a sold one. */
.aic-tag {
  flex: none; padding: 0 var(--space-2); border-radius: var(--radius-xs);
  font-size: var(--t-meta); line-height: var(--space-5); white-space: nowrap;
  color: var(--ink-soft); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-soft);
}
.aic-tag-reserved { color: var(--warning-text); background: var(--warning-soft); box-shadow: none; }
.aic-tag-sold { color: var(--ink-quiet); }

.stats-row {
  display: flex; gap: 28px; margin-top: 16px;
  padding-top: 14px; border-top: 0.5px solid var(--line-hair);
}
.stat-btn {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.heart-img { width: 22px; height: 22px; }
.stat-num { font-size: 13px; color: var(--text-muted); font-weight: 500; &.active { color: var(--accent-danger); } }
.comments-section { background: var(--bg-elev-1); margin-top: 8px; }
.cs-header { padding: 14px 16px 8px; border-bottom: 0.5px solid var(--line-hair); }
.cs-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.cs-empty { padding: 40px 16px; text-align: center; color: var(--text-subtle); font-size: 13px; }
/* Mirrors .ci-error / .ci-retry in the plaza comment sheet. */
.cs-error { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.cs-retry {
  min-height: 44px; padding: 0 18px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent-action); color: var(--ink-inverse); font-weight: 650;
}
.cs-item {
  display: flex; gap: 10px; padding: 12px 16px;
  border-bottom: 0.5px solid var(--line-hair);
}
.cs-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.cs-body { flex: 1; min-width: 0; }
.cs-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.cs-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.cs-time { font-size: 11px; color: var(--text-subtle); }
.cs-content {
  font-size: 14px; color: var(--text-primary); line-height: 1.5;
  margin-top: 2px; display: block; word-break: break-word;
}
.cs-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
}
.cs-like-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  padding: 2px 0;
  &:active { opacity: 0.6; }
}
.cs-heart-img {
  width: 14px;
  height: 14px;
  transition: transform 0.15s;
  &:active { transform: scale(1.2); }
}
.cs-like-num {
  font-size: 11px;
  color: var(--text-subtle);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  &.active { color: var(--accent-danger); }
}
.cs-reply-btn {
  font-size: 12px;
  color: var(--text-subtle);
  font-weight: 500;
  cursor: pointer;
  padding: 2px 0;
  &:active { color: var(--text-secondary); }
}
.cs-item-child {
  padding-left: 48px;
}
.cs-expand-link {
  display: flex;
  align-items: center;
  padding: 6px 16px 6px 48px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.cs-expand-text {
  font-size: 12px;
  color: var(--campus-blue);
  font-weight: 500;
}

.input-wrapper {
  flex-shrink: 0; background: var(--bg-elev-1);
  border-top: 0.5px solid var(--line-hair);
  /* Lifted above the soft keyboard via :style translateY (useKeyboardHeight). */
  transition: transform 0.22s ease-out; will-change: transform;
}
.reply-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 14px;
  background: rgba(185,69,44,0.08);
}
.reply-label { font-size: 12px; color: var(--accent-action); font-weight: 500; flex: 1; }
.reply-x {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.rx-inner {
  width: 11px; height: 11px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 11px; height: 1.5px; background: var(--accent-action);
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.input-bar {
  display: flex; gap: 8px; padding: 9px 12px;
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
}
/* The line under the box takes over the bottom inset while it is shown. */
.input-bar.has-note { padding-bottom: var(--space-1); }
.reply-failed { padding: 0 var(--space-4) calc(var(--space-2) + env(safe-area-inset-bottom)); cursor: pointer; }
.reply-failed-t { font-size: var(--t-caption); line-height: var(--lh-caption); color: var(--danger); }
.reply-restricted {
  min-height: 44px; box-sizing: border-box; align-items: center;
  font-size: 14px; line-height: 20px; color: var(--ink-soft);
}
.input {
  flex: 1; height: 40px; background: var(--bg-subtle); border-radius: 20px;
  padding: 0 14px; font-size: 14px; color: var(--text-primary);
}
.send-btn {
  padding: 0 18px; height: 40px; border-radius: 20px;
  background: var(--accent-primary); color: var(--ink-inverse);
  display: flex; align-items: center; cursor: pointer;
  .send-btn-label { font-size: 13px; color: var(--ink-inverse); font-weight: 600; }
  &.disabled { opacity: 0.3; pointer-events: none; }
}
.post-board { display: block; font-size: 12px; color: var(--accent-action); margin-bottom: 6px; }
.attach-pending { margin: 12px 0; padding: 12px 14px; border-radius: 12px; background: var(--bg-subtle); border: 1px solid var(--line-hair); }
.attach-pending-text { display: block; font-size: 14px; line-height: 1.5; color: var(--text-primary); }
.attach-pending-note { display: block; margin-top: 6px; font-size: 13px; color: var(--danger); }
.attach-pending-note.standalone { margin: 12px 0; }
.attach-pending-actions { display: flex; gap: 8px; margin-top: 10px; }
.attach-pending-btn { padding: 6px 14px; border-radius: 999px; font-size: 14px; color: var(--text-secondary); border: 1px solid var(--line-hair); }
.attach-pending-btn.primary { color: var(--brand); border-color: var(--brand); }
.attach-pending-btn.disabled { opacity: 0.5; pointer-events: none; }
.post-topic-title { display: block; font-size: 22px; font-weight: 700; line-height: 1.4; margin-bottom: 12px; overflow-wrap: anywhere; }
</style>
