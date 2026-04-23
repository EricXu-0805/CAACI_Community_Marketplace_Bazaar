<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('plaza.title') }}</text>
      <view v-if="post && currentUser?.id === post.user_id" class="more-btn" @click="onDelete">
        <view class="mb-dot"></view><view class="mb-dot"></view><view class="mb-dot"></view>
      </view>
      <view v-else style="width: 32px;"></view>
    </view>

    <scroll-view v-if="post" class="body" scroll-y>
      <view class="post-card" @longpress="onPostLongPress">
        <view class="post-head">
          <image :src="post.profile?.avatar_url || '/static/default-avatar.svg'" class="avatar" mode="aspectFill" />
          <view class="head-info">
            <view class="head-name-row">
              <text class="head-name">{{ post.profile?.nickname || t('app.user') }}</text>
              <view v-if="post.is_official" class="badge-official"><text>{{ t('plaza.official') }}</text></view>
              <view v-else-if="post.profile?.is_illini_verified" class="badge-illini"><text>Illini</text></view>
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
            @click.stop="toggleTranslate"
          >
            <text v-if="!translatePending">{{ translated ? 'A文' : '文A' }}</text>
            <text v-else>···</text>
          </view>
        </view>

        <view v-if="post.images && post.images.length > 0" class="images">
          <!--
            widthFix alone is unreliable on uni-app H5: the component adds
            an inline `height` once the image loads, but combined with any
            CSS max-height it was previously clipped horizontally on tall
            photos, producing the "stretched" feel users reported. We drive
            the layout via `aspect-ratio` when we know the natural ratio
            (captured via @load below) and fall back to widthFix + the image's
            intrinsic height. Either way, object-fit stays `contain` so the
            original aspect is preserved and nothing is ever cropped or
            stretched — this is the same contract as an Instagram long post.
          -->
          <image
            v-for="(img, i) in post.images"
            :key="i"
            :src="img"
            mode="widthFix"
            class="post-img"
            :style="postImgStyles[i]"
            @load="onImgLoad(i, $event)"
            @click="previewImage(post.images, i)"
          />
        </view>

        <view class="stats-row">
          <view class="stat-btn" @click="onToggleLike">
            <image
              :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'"
              class="heart-img"
            />
            <text :class="['stat-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
          </view>
          <view class="stat-btn">
            <view class="bubble-ico"></view>
            <text class="stat-num">{{ post.comment_count }}</text>
          </view>
          <view class="stat-btn" @click="onShare">
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
        <view
          v-for="c in comments"
          :key="c.id"
          class="cs-item"
          @click="onCommentTap(c)"
          @longpress="onCommentLongPress(c)"
        >
          <image :src="c.profile?.avatar_url || '/static/default-avatar.svg'" class="cs-avatar" mode="aspectFill" />
          <view class="cs-body">
            <view class="cs-top">
              <text class="cs-name">{{ c.profile?.nickname || t('app.user') }}</text>
              <text class="cs-time">{{ formatTime(c.created_at) }}</text>
            </view>
            <text class="cs-content">{{ c.content }}</text>
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-else-if="loading" class="loading">
      <text>{{ t('home.loading') }}</text>
    </view>

    <view v-else class="not-found">
      <text>{{ t('plaza.notFound') }}</text>
      <view class="back-home" @click="goPlaza">{{ t('plaza.backToPlaza') }}</view>
    </view>

    <view v-if="post" class="input-wrapper">
      <view v-if="replyTo" class="reply-bar">
        <text class="reply-label">{{ t('plaza.replyingTo') }} @{{ replyTo.profile?.nickname || t('app.user') }}</text>
        <view class="reply-x" @click="replyTo = null">
          <view class="rx-inner"></view>
        </view>
      </view>
      <view class="input-bar">
        <input
          v-model="commentText"
          :placeholder="replyTo ? t('plaza.replyHint') : t('plaza.commentHint')"
          class="input"
          confirm-type="send"
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
import { onLoad } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { usePlaza } from '../../composables/usePlaza'
import { useModeration } from '../../composables/useModeration'
import { useHistory } from '../../composables/useHistory'
import { useTranslate } from '../../composables/useTranslate'
import { formatTime, friendlyErrorMessage, quickTranslate } from '../../utils'
import type { Post, PostComment } from '../../types'

const { t, lang, localize } = useI18n()
const { currentUser, requireAuth } = useAuth()
const { fetchPost, deletePost, toggleLike, fetchComments, createComment, deleteComment } = usePlaza()
const { reportTarget } = useModeration()
const { addPostToHistory } = useHistory()

const post = ref<Post | null>(null)
const comments = ref<PostComment[]>([])
const loading = ref(true)
const loadingComments = ref(false)
const commentText = ref('')
const replyTo = ref<PostComment | null>(null)
const submitting = ref(false)

const postId = ref('')

/*
 * Per-image style map keyed by array index. We populate aspect-ratio
 * once the image reports its natural dimensions via @load. Until then
 * widthFix is what holds the layout, and the image reserves 0 height —
 * this is a minor CLS but unavoidable without DB-stored dimensions
 * (see docs/audit recommendation: add image_dimensions jsonb column).
 */
const postImgStyles = ref<Record<number, Record<string, string>>>({})

function onImgLoad(i: number, ev: any) {
  // uni-app H5 and the native img element both surface naturalWidth/Height
  // on ev.detail.{width,height} — fall back to the underlying target if not.
  const detail = ev?.detail || {}
  const w = detail.width || ev?.target?.naturalWidth || 0
  const h = detail.height || ev?.target?.naturalHeight || 0
  if (w > 0 && h > 0) {
    postImgStyles.value = {
      ...postImgStyles.value,
      [i]: { 'aspect-ratio': `${w} / ${h}`, height: 'auto' },
    }
  }
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
  } catch {} finally {
    loadingComments.value = false
  }
}

function goBack() { uni.navigateBack({ fail: () => goPlaza() }) }
function goPlaza() { uni.switchTab({ url: '/pages/plaza/index' }) }

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
  let origin = 'https://caaci-community-marketplace-bazaar.vercel.app'
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
    confirmColor: 'var(--accent-danger)',
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

function onCommentLongPress(c: PostComment) {
  if (!currentUser.value) return
  const isMine = c.user_id === currentUser.value.id
  const items = isMine ? [t('plaza.delete')] : [t('plaza.reply'), t('plaza.report')]
  uni.showActionSheet({
    itemList: items,
    itemColor: isMine ? 'var(--accent-danger)' : '#1a1a1a',
    success: (res) => {
      if (isMine && res.tapIndex === 0) {
        uni.showModal({
          title: t('plaza.commentDeleteConfirm'),
          confirmColor: 'var(--accent-danger)',
          success: async (r) => {
            if (!r.confirm || !post.value) return
            try {
              await deleteComment(c.id, post.value.id)
              comments.value = comments.value.filter(x => x.id !== c.id)
            } catch (err: any) {
              uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none' })
            }
          },
        })
      } else if (!isMine && res.tapIndex === 0) {
        replyTo.value = c
      } else if (!isMine && res.tapIndex === 1) {
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
        uni.showToast({ title: err?.message || t('report.failed'), icon: 'none' })
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
    const c = await createComment(post.value.id, text, replyTo.value?.id)
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
  padding-top: calc(11px + env(safe-area-inset-top, 0px));
  background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
  flex-shrink: 0;
}
.back-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.back-arrow {
  width: 9px; height: 9px;
  border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary);
  transform: rotate(45deg); margin-left: 4px;
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

.badge-official {
  background: var(--accent-action); color: #fff;
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 700; }
}
.badge-illini {
  background: var(--campus-blue); color: #fff;
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 700; color: #fff; }
}
.badge-pinned {
  background: rgba(255,107,53,0.12); color: var(--accent-action);
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 600; color: var(--accent-action); }
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
.cs-header { padding: 14px 16px 8px; border-bottom: 0.5px solid rgba(0,0,0,0.04); }
.cs-title { font-size: 14px; font-weight: 700; color: var(--text-primary); }
.cs-empty { padding: 40px 16px; text-align: center; color: var(--text-faint); font-size: 13px; }
.cs-item {
  display: flex; gap: 10px; padding: 12px 16px;
  border-bottom: 0.5px solid rgba(0,0,0,0.04);
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

.input-wrapper {
  flex-shrink: 0; background: var(--bg-elev-1);
  border-top: 0.5px solid var(--line-hair);
}
.reply-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 14px;
  background: rgba(255,107,53,0.08);
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
