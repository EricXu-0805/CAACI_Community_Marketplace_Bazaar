<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ t('plaza.title') }}</text>
      <view v-if="post && currentUser?.id === post.user_id" class="more-btn" role="button" :aria-label="t('a11y.more')" @click="onDelete">
        <view class="mb-dot"></view><view class="mb-dot"></view><view class="mb-dot"></view>
      </view>
      <view v-else style="width: 32px;"></view>
    </view>

    <scroll-view v-if="post" class="body" scroll-y>
      <view
        class="post-card"
        @touchstart="postLongPress.onTouchstart()"
        @touchend="postLongPress.onTouchend"
        @touchcancel="postLongPress.onTouchcancel"
        @touchmove="postLongPress.onTouchmove"
      >
        <view class="post-head">
          <image :src="post.profile?.avatar_url || defaultAvatarSrc" :alt="post.profile?.nickname || 'avatar'" class="avatar" mode="aspectFill" @click.stop="goSeller(post.user_id)" />
          <view class="head-info">
            <view class="head-name-row">
              <text class="head-name" @click.stop="goSeller(post.user_id)">{{ post.profile?.nickname || t('app.user') }}</text>
              <UBadge v-if="post.is_official" variant="official">{{ t('plaza.official') }}</UBadge>
              <UBadge v-else-if="post.profile?.is_illini_verified" variant="illini">Illini</UBadge>
              <view v-if="post.is_pinned" class="badge-pinned"><text>{{ t('plaza.pinned') }}</text></view>
            </view>
            <text class="head-time">{{ formatTime(post.created_at) }}</text>
          </view>
        </view>

        <view class="content-wrap">
          <text class="content">{{ displayContent }}</text>
          <view
            v-if="post.content && post.content.trim().length > 0"
            :class="['translate-btn', { loading: translatePending }]"
            role="button"
            :aria-label="t('a11y.translate')"
            @click.stop="toggleTranslate"
          >
            <text v-if="!translatePending">{{ translated ? 'A文' : '文A' }}</text>
            <text v-else>···</text>
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
            :style="dimsToAspectStyle(effectiveDims(), i)"
            @load="onImgLoad($event, i)"
            @click="previewImage(post.images, i)"
          />
        </view>

        <view
          v-for="pi in (post.post_items || [])"
          :key="pi.item.id"
          class="attached-item-card"
          @click.stop="goToAttachedItem(pi.item.id)"
        >
          <image
            v-if="thumbUrl(pi.item.images?.[0], 'list')"
            :src="thumbUrl(pi.item.images?.[0], 'list')"
            class="aic-img"
            mode="aspectFill"
            lazy-load
            :alt="pi.item.title"
          />
          <view v-else class="aic-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">集</text></view>
          <view class="aic-body">
            <text class="aic-title">{{ localize(pi.item.title_i18n, pi.item.title) }}</text>
            <text class="aic-price">{{ listingPriceLabel(pi.item, t) }}</text>
            <text v-if="pi.item.status === 'sold'" class="aic-sold">{{ t('status.sold') }}</text>
          </view>
          <UIcon name="chevron-right" size="sm" color="text-faint" />
        </view>

        <view class="stats-row">
          <view class="stat-btn" role="button" :aria-label="post.liked_by_me ? t('a11y.unlike') : t('a11y.like')" @click="onToggleLike">
            <image
              :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'"
              alt=""
              class="heart-img"
            />
            <text :class="['stat-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
          </view>
          <view class="stat-btn">
            <view class="bubble-ico"></view>
            <text class="stat-num">{{ post.comment_count }}</text>
          </view>
          <view class="stat-btn" role="button" :aria-label="t('a11y.share')" @click="onShare">
            <view class="share-ico"></view>
          </view>
        </view>
      </view>

      <view class="comments-section">
        <view class="cs-header">
          <text class="cs-title">{{ t('plaza.comments') }} ({{ post.comment_count || 0 }})</text>
        </view>
        <view v-if="comments.length === 0 && !loadingComments" class="cs-empty">
          <text>{{ t('plaza.noComments') }}</text>
        </view>
        <template v-for="thread in commentThreads" :key="thread.parent.id">
          <view
            class="cs-item u-rise"
            @touchstart="commentLongPress.onTouchstart(thread.parent)"
            @touchend="commentLongPress.onTouchend"
            @touchcancel="commentLongPress.onTouchcancel"
            @touchmove="commentLongPress.onTouchmove"
          >
            <image
              :src="thread.parent.profile?.avatar_url || defaultAvatarSrc"
              :alt="thread.parent.profile?.nickname || 'avatar'"
              class="cs-avatar"
              mode="aspectFill"
              @click="onCommentTap(thread.parent)"
            />
            <view class="cs-body" @click="onCommentTap(thread.parent)">
              <view class="cs-top">
                <text class="cs-name">{{ thread.parent.profile?.nickname || t('app.user') }}</text>
                <text class="cs-time">{{ formatTime(thread.parent.created_at) }}</text>
              </view>
              <text class="cs-content">{{ thread.parent.content }}</text>
              <view class="cs-actions">
                <view class="cs-like-btn" role="button" :aria-label="thread.parent.liked_by_me ? t('a11y.unlike') : t('a11y.like')" @click.stop="onToggleCommentLike(thread.parent)">
                  <image :src="thread.parent.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'" alt="" class="cs-heart-img" />
                  <text v-if="(thread.parent.like_count ?? 0) > 0" :class="['cs-like-num', { active: thread.parent.liked_by_me }]">{{ thread.parent.like_count }}</text>
                </view>
                <text class="cs-reply-btn" @click.stop="onCommentTap(thread.parent)">{{ t('plaza.reply') }}</text>
              </view>
            </view>
          </view>

          <template v-if="thread.children.length > 0">
            <view
              v-for="child in (expandedReplies.has(thread.parent.id) ? thread.children : thread.children.slice(0, 3))"
              :key="child.id"
              class="cs-item cs-item-child"
              @touchstart="commentLongPress.onTouchstart(child)"
              @touchend="commentLongPress.onTouchend"
              @touchcancel="commentLongPress.onTouchcancel"
              @touchmove="commentLongPress.onTouchmove"
            >
              <image
                :src="child.profile?.avatar_url || defaultAvatarSrc"
                :alt="child.profile?.nickname || 'avatar'"
                class="cs-avatar"
                mode="aspectFill"
                @click="onCommentTap(child)"
              />
              <view class="cs-body" @click="onCommentTap(child)">
                <view class="cs-top">
                  <text class="cs-name">{{ child.profile?.nickname || t('app.user') }}</text>
                  <text class="cs-time">{{ formatTime(child.created_at) }}</text>
                </view>
                <text class="cs-content">{{ child.content }}</text>
                <view class="cs-actions">
                  <view class="cs-like-btn" role="button" :aria-label="child.liked_by_me ? t('a11y.unlike') : t('a11y.like')" @click.stop="onToggleCommentLike(child)">
                    <image :src="child.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'" alt="" class="cs-heart-img" />
                    <text v-if="(child.like_count ?? 0) > 0" :class="['cs-like-num', { active: child.liked_by_me }]">{{ child.like_count }}</text>
                  </view>
                  <text class="cs-reply-btn" @click.stop="onCommentTap(child)">{{ t('plaza.reply') }}</text>
                </view>
              </view>
            </view>

            <view
              v-if="thread.children.length > 3"
              class="cs-expand-link cs-item-child"
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

    <view v-else-if="loading" class="loading">
      <text>{{ t('home.loading') }}</text>
    </view>

    <view v-else class="not-found">
      <text>{{ t('plaza.notFound') }}</text>
      <view class="back-home" @click="goPlaza">{{ t('plaza.backToPlaza') }}</view>
    </view>

    <view v-if="post" class="input-wrapper" :style="kbLift">
      <view v-if="replyTo" class="reply-bar">
        <text class="reply-label">{{ t('plaza.replyingTo') }} @{{ replyTo.profile?.nickname || t('app.user') }}</text>
        <view class="reply-x" role="button" :aria-label="t('a11y.close')" @click="replyTo = null">
          <view class="rx-inner"></view>
        </view>
      </view>
      <view class="input-bar">
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
        <view :class="['send-btn', { disabled: !commentText.trim() || submitting }]" @click="onSubmitComment">
          <text>{{ replyTo ? t('plaza.reply') : t('plaza.comment') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { onLoad, onUnload, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useTheme } from '../../composables/useTheme'
import { usePlaza, groupCommentsByParent } from '../../composables/usePlaza'
import { useModeration } from '../../composables/useModeration'
import { useHistory } from '../../composables/useHistory'
import { useTranslate } from '../../composables/useTranslate'
import { useLongPress } from '../../composables/useLongPress'
import { useKeyboardHeight } from '../../composables/useKeyboardHeight'
import { formatTime, friendlyErrorMessage, quickTranslate, thumbUrl, listingPriceLabel } from '../../utils'
import { DIALOG_DANGER, DIALOG_INK } from '../../utils/dialogColors'
import { dimsToAspectStyle, readNaturalDims } from '../../utils/imgStyle'
import type { ImageDim, Post, PostComment } from '../../types'
import { BASE_URL } from '../../config/runtime'
import UBadge from '../../components/UBadge.vue'
import UIcon from '../../components/UIcon.vue'

const { t, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, requireAuth } = useAuth()
const { fetchPost, deletePost, toggleLike, toggleCommentLike, fetchComments, createComment, deleteComment } = usePlaza()
const { reportTarget } = useModeration()
const { addPostToHistory } = useHistory()

// Lift the comment bar above the soft keyboard (mirrors the plaza composer);
// the comment input sets adjust-position=false so this transform is the only
// lift source. Page is a fixed-height flex column so the bar otherwise sits
// behind the iOS keyboard.
const kb = useKeyboardHeight()
const kbLift = computed(() => (kb.height.value ? { transform: `translateY(-${kb.height.value}px)` } : undefined))

const post = ref<Post | null>(null)
const comments = ref<PostComment[]>([])
const loading = ref(true)
const loadingComments = ref(false)
const commentText = ref('')
const replyTo = ref<PostComment | null>(null)
const submitting = ref(false)

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
  if (translated.value && translatedContent.value) return translatedContent.value
  return localize(post.value.content_i18n, post.value.content)
})

async function ensureTranslation() {
  if (!post.value || !post.value.content) return
  const target = lang.value as 'en' | 'zh'
  const cached = getCached(post.value.content, target)
  translatedContent.value = cached || quickTranslate(post.value.content, target)
  if (cached) return
  const t2 = await translateText(post.value.content, target)
  if (!post.value) return
  if (t2) translatedContent.value = t2
}

async function toggleTranslate() {
  translated.value = !translated.value
  if (translated.value) await ensureTranslation()
}

watch(lang, async () => {
  if (translated.value && post.value) await ensureTranslation()
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
  if (!p) return { title: '校园广场 · Illini Market', path: '/pages/plaza/index' }
  const firstLine = (p.content || '').split('\n')[0].slice(0, 50).trim() || '校园广场 · Illini Market'
  return {
    title: firstLine,
    path: `/pages/post/index?id=${p.id}`,
    imageUrl: p.images?.[0] || '',
  }
})

onShareTimeline(() => {
  const p = post.value
  if (!p) return { title: '校园广场 · Illini Market' }
  const firstLine = (p.content || '').split('\n')[0].slice(0, 50).trim() || '校园广场 · Illini Market'
  return {
    title: firstLine,
    query: `id=${p.id}`,
    imageUrl: p.images?.[0] || '',
  }
})

onMounted(async () => {
  if (!postId.value) {
    loading.value = false
    return
  }
  try {
    const p = await fetchPost(postId.value)
    if (p) {
      post.value = p
      addPostToHistory(p)
      loadComments()
    }
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
  } finally {
    loading.value = false
  }
})

async function loadComments() {
  if (!postId.value) return
  loadingComments.value = true
  try {
    comments.value = await fetchComments(postId.value)
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    loadingComments.value = false
  }
}

function goBack() { uni.navigateBack({ fail: () => goPlaza() }) }
function goPlaza() { uni.switchTab({ url: '/pages/plaza/index' }) }
function goToAttachedItem(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}
/* Author avatar/name → seller page (default 商品 tab — meeting decision). */
function goSeller(userId: string) {
  uni.navigateTo({ url: `/pages/seller/index?id=${userId}` })
}

async function onToggleLike() {
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
  const preview = post.value.content.slice(0, 60).replace(/\n/g, ' ')
  uni.setClipboardData({
    data: `${preview}…\n${url}`,
    success: () => uni.showToast({ title: t('plaza.contentCopied'), icon: 'success' }),
  })
}

function previewImage(urls: string[], idx: number) {
  uni.previewImage({ urls, current: urls[idx] })
}

function onDelete() {
  if (!post.value) return
  uni.showModal({
    title: t('plaza.deleteConfirm'),
    confirmColor: DIALOG_DANGER,
    success: async (r) => {
      if (!r.confirm || !post.value) return
      try {
        await deletePost(post.value.id)
        uni.showToast({ title: t('profile.deleted'), icon: 'success' })
        setTimeout(() => goBack(), 800)
      } catch (err: any) {
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
      }
    },
  })
}

function onCommentTap(c: PostComment) {
  if (!currentUser.value) return
  replyTo.value = c
}

async function onToggleCommentLike(comment: PostComment) {
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

function onCommentLongPress(c: PostComment) {
  if (!currentUser.value) return
  const isMine = c.user_id === currentUser.value.id
  const items = isMine
    ? [t('plaza.delete')]
    : [t('plaza.reply'), t('plaza.reportComment'), t('plaza.reportUser')]
  uni.showActionSheet({
    itemList: items,
    itemColor: isMine ? DIALOG_DANGER : DIALOG_INK,
    success: (res) => {
      if (isMine && res.tapIndex === 0) {
        uni.showModal({
          title: t('plaza.commentDeleteConfirm'),
          confirmColor: DIALOG_DANGER,
          success: async (r) => {
            if (!r.confirm || !post.value) return
            try {
              await deleteComment(c.id, post.value.id)
              comments.value = comments.value.filter(x => x.id !== c.id)
              // Mirror the add path (line ~597) — usePlaza.deleteComment only
              // decrements the feed-list copy, not this detail page's post ref,
              // so the header count would otherwise go stale.
              if (post.value) post.value.comment_count = Math.max(0, (post.value.comment_count || 0) - 1)
            } catch (err: any) {
              uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
            }
          },
        })
      } else if (!isMine && res.tapIndex === 0) {
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

function onPostLongPress() {
  if (!post.value) return
  if (!currentUser.value) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  if (post.value.user_id === currentUser.value.id) return
  const postId = post.value.id
  const userId = post.value.user_id
  uni.showActionSheet({
    itemList: [t('report.reportPost'), t('report.reportUser')],
    success: (res) => {
      if (res.tapIndex === 0) promptReport('post', postId)
      else if (res.tapIndex === 1) promptReport('user', userId)
    },
  })
}

function promptReport(targetType: 'post' | 'user' | 'item' | 'comment', targetId: string) {
  const reasons = targetType === 'user'
    ? [t('report.reasonSpam'), t('report.reasonAbuse'), t('report.reasonMisleading'), t('report.reasonOther')]
    : [t('report.reasonSpam'), t('report.reasonProhibited'), t('report.reasonMisleading'), t('report.reasonOther')]
  uni.showActionSheet({
    itemList: reasons,
    success: async (res) => {
      const reason = reasons[res.tapIndex]
      uni.showLoading({ title: t('report.submitting') || t('login.wait'), mask: true })
      try {
        await reportTarget(targetType, targetId, reason)
        uni.hideLoading()
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
        uni.hideLoading()
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('report.failed'), icon: 'none' })
      }
    },
  })
}

async function onSubmitComment() {
  if (!requireAuth()) return
  if (!commentText.value.trim() || !post.value) return
  if (submitting.value) return
  submitting.value = true
  const failsafe = setTimeout(() => { submitting.value = false }, 15000)
  try {
    let text = commentText.value
    if (replyTo.value) {
      const name = replyTo.value.profile?.nickname || t('app.user')
      text = `@${name} ${text}`
    }
    // 单层缩进语义：parent 永远指向顶层祖先。若 replyTo 是子评论，跳一级；
    // 否则就是它自己。groupCommentsByParent 渲染时也会做 walk-up 防御。
    const parentId = replyTo.value
      ? (replyTo.value.parent_comment_id ?? replyTo.value.id)
      : undefined
    const c = await createComment(post.value.id, text, parentId)
    // fetchComments hydrates reply_to_name from DB on next refresh; for the
    // optimistic push here we mirror the same logic by reading replyTo's nickname.
    c.reply_to_name = replyTo.value
      ? (replyTo.value.profile?.nickname ?? null)
      : null
    comments.value.push(c)
    commentText.value = ''
    replyTo.value = null
    if (post.value) post.value.comment_count = (post.value.comment_count || 0) + 1
    uni.showToast({ title: t('plaza.commented'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    clearTimeout(failsafe)
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
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
  padding-top: calc(11px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
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
  padding: 80px 16px; text-align: center; color: var(--text-faint); font-size: 14px;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
}
.back-home {
  padding: 10px 28px; background: var(--accent-primary); color: #fff;
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
.head-time { font-size: 11px; color: var(--text-faint); display: block; margin-top: 2px; }

/* official + illini badges → components/UBadge.vue (variants official/illini). */
.badge-pinned {
  background: var(--warning-soft); color: var(--warning);
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 600; color: var(--warning); letter-spacing: 0.02em; }
}

.content-wrap { position: relative; padding-right: 44px; }
.content {
  font-size: 15px; color: var(--text-primary); line-height: 1.55;
  white-space: pre-wrap; word-break: break-word; display: block;
}
.translate-btn {
  position: absolute; top: 0; right: 0;
  min-width: 36px; height: 24px; border-radius: 12px;
  background: var(--bg-subtle); padding: 0 8px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  text { font-size: 11px; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.3px; }
  &:active { background: var(--bg-inset); }
  &.loading { opacity: 0.7; pointer-events: none; }
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
.aic-price { font-size: 14px; color: var(--accent-action); font-weight: 700; }
.aic-sold { font-size: 11px; color: var(--text-muted); }

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
.bubble-ico {
  width: 20px; height: 16px; border: 1.8px solid var(--text-muted);
  border-radius: 9px 9px 9px 2px;
}
.share-ico {
  width: 18px; height: 18px; position: relative;
  &::before {
    content: ''; position: absolute; top: 1px; left: 50%;
    transform: translateX(-50%);
    width: 0; height: 9px; border-left: 1.8px solid var(--text-muted);
  }
  &::after {
    content: ''; position: absolute; top: 0; left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 9px; height: 9px;
    border-left: 1.8px solid var(--text-muted); border-top: 1.8px solid var(--text-muted);
  }
}

.comments-section { background: var(--bg-elev-1); margin-top: 8px; }
.cs-header { padding: 14px 16px 8px; border-bottom: 0.5px solid var(--line-hair); }
.cs-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.cs-empty { padding: 40px 16px; text-align: center; color: var(--text-faint); font-size: 13px; }
.cs-item {
  display: flex; gap: 10px; padding: 12px 16px;
  border-bottom: 0.5px solid var(--line-hair);
}
.cs-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.cs-body { flex: 1; min-width: 0; }
.cs-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.cs-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.cs-time { font-size: 11px; color: var(--text-faint); }
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
  color: var(--text-faint);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  &.active { color: var(--accent-danger); }
}
.cs-reply-btn {
  font-size: 12px;
  color: var(--text-faint);
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
  background: rgba(199,74,47,0.08);
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
.input {
  flex: 1; height: 40px; background: var(--bg-subtle); border-radius: 20px;
  padding: 0 14px; font-size: 14px; color: var(--text-primary);
}
.send-btn {
  padding: 0 18px; height: 40px; border-radius: 20px;
  background: var(--accent-primary); color: #fff;
  display: flex; align-items: center; cursor: pointer;
  text { font-size: 13px; color: #fff; font-weight: 600; }
  &.disabled { opacity: 0.3; pointer-events: none; }
}
</style>
