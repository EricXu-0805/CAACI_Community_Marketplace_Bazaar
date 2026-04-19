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
          <image :src="post.profile?.avatar_url || '/static/default-avatar.svg'" class="avatar" />
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

        <text class="content">{{ post.content }}</text>

        <view v-if="post.images && post.images.length > 0" class="images">
          <image
            v-for="(img, i) in post.images"
            :key="i"
            :src="img"
            mode="widthFix"
            class="post-img"
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
          <image :src="c.profile?.avatar_url || '/static/default-avatar.svg'" class="cs-avatar" />
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
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { usePlaza } from '../../composables/usePlaza'
import { useModeration } from '../../composables/useModeration'
import { useHistory } from '../../composables/useHistory'
import { formatTime, friendlyErrorMessage } from '../../utils'
import type { Post, PostComment } from '../../types'

const { t, lang } = useI18n()
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
    confirmColor: '#FF3B30',
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
  if (c.user_id === currentUser.value.id) return
  replyTo.value = c
}

function onCommentLongPress(c: PostComment) {
  if (!currentUser.value) return
  const isMine = c.user_id === currentUser.value.id
  const items = isMine ? [t('plaza.delete')] : [t('plaza.reply'), t('plaza.report')]
  uni.showActionSheet({
    itemList: items,
    itemColor: isMine ? '#FF3B30' : '#1a1a1a',
    success: (res) => {
      if (isMine && res.tapIndex === 0) {
        uni.showModal({
          title: t('plaza.commentDeleteConfirm'),
          confirmColor: '#FF3B30',
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
      try {
        await reportTarget(targetType, targetId, reason)
        uni.showToast({ title: t('report.thanks'), icon: 'success' })
      } catch (err: any) {
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
  background: #f2f2f7;
  max-width: 480px; margin: 0 auto;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 14px;
  padding-top: calc(11px + env(safe-area-inset-top, 0px));
  background: #fff;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
}
.back-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.back-arrow {
  width: 9px; height: 9px;
  border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a;
  transform: rotate(45deg); margin-left: 4px;
}
.header-title { flex: 1; font-size: 16px; font-weight: 700; color: #1a1a1a; text-align: center; }
.more-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center; gap: 3px;
  cursor: pointer;
}
.mb-dot { width: 3px; height: 3px; border-radius: 50%; background: #8e8e93; }

.body { flex: 1; min-height: 0; }

.loading, .not-found {
  padding: 80px 16px; text-align: center; color: #aeaeb2; font-size: 14px;
  display: flex; flex-direction: column; align-items: center; gap: 14px;
}
.back-home {
  padding: 10px 28px; background: #1a1a1a; color: #fff;
  border-radius: 22px; font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.85; }
}

.post-card {
  background: #fff; padding: 16px;
}
.post-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
.avatar { width: 42px; height: 42px; border-radius: 50%; background: #f2f2f7; flex-shrink: 0; }
.head-info { flex: 1; min-width: 0; }
.head-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.head-name { font-size: 15px; font-weight: 600; color: #1a1a1a; }
.head-time { font-size: 11px; color: #aeaeb2; display: block; margin-top: 2px; }

.badge-official {
  background: #FF6B35; color: #fff;
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 700; }
}
.badge-illini {
  background: #13294B; color: #fff;
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 700; color: #fff; }
}
.badge-pinned {
  background: rgba(255,107,53,0.12); color: #FF6B35;
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 600; color: #FF6B35; }
}

.content {
  font-size: 15px; color: #1a1a1a; line-height: 1.55;
  white-space: pre-wrap; word-break: break-word; display: block;
}

.images { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.post-img {
  width: 100%; max-height: 480px;
  border-radius: 10px; background: #f2f2f7; cursor: pointer;
}

.stats-row {
  display: flex; gap: 28px; margin-top: 16px;
  padding-top: 14px; border-top: 0.5px solid rgba(0,0,0,0.06);
}
.stat-btn {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.heart-img { width: 22px; height: 22px; }
.stat-num { font-size: 13px; color: #8e8e93; font-weight: 500; &.active { color: #FF3B30; } }
.bubble-ico {
  width: 20px; height: 16px; border: 1.8px solid #8e8e93;
  border-radius: 9px 9px 9px 2px;
}
.share-ico {
  width: 18px; height: 18px; position: relative;
  &::before {
    content: ''; position: absolute; top: 1px; left: 50%;
    transform: translateX(-50%);
    width: 0; height: 9px; border-left: 1.8px solid #8e8e93;
  }
  &::after {
    content: ''; position: absolute; top: 0; left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 9px; height: 9px;
    border-left: 1.8px solid #8e8e93; border-top: 1.8px solid #8e8e93;
  }
}

.comments-section { background: #fff; margin-top: 8px; }
.cs-header { padding: 14px 16px 8px; border-bottom: 0.5px solid rgba(0,0,0,0.04); }
.cs-title { font-size: 14px; font-weight: 700; color: #1a1a1a; }
.cs-empty { padding: 40px 16px; text-align: center; color: #c7c7cc; font-size: 13px; }
.cs-item {
  display: flex; gap: 10px; padding: 12px 16px;
  border-bottom: 0.5px solid rgba(0,0,0,0.04);
}
.cs-avatar { width: 32px; height: 32px; border-radius: 50%; background: #f2f2f7; flex-shrink: 0; }
.cs-body { flex: 1; min-width: 0; }
.cs-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.cs-name { font-size: 13px; font-weight: 600; color: #1a1a1a; }
.cs-time { font-size: 11px; color: #c7c7cc; }
.cs-content {
  font-size: 14px; color: #1a1a1a; line-height: 1.5;
  margin-top: 2px; display: block; word-break: break-word;
}

.input-wrapper {
  flex-shrink: 0; background: #fff;
  border-top: 0.5px solid rgba(0,0,0,0.06);
}
.reply-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 14px;
  background: rgba(255,107,53,0.08);
}
.reply-label { font-size: 12px; color: #FF6B35; font-weight: 500; flex: 1; }
.reply-x {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.rx-inner {
  width: 11px; height: 11px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 11px; height: 1.5px; background: #FF6B35;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.input-bar {
  display: flex; gap: 8px; padding: 9px 12px;
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
}
.input {
  flex: 1; height: 40px; background: #f2f2f7; border-radius: 20px;
  padding: 0 14px; font-size: 14px; color: #1a1a1a;
}
.send-btn {
  padding: 0 18px; height: 40px; border-radius: 20px;
  background: #1a1a1a; color: #fff;
  display: flex; align-items: center; cursor: pointer;
  text { font-size: 13px; color: #fff; font-weight: 600; }
  &.disabled { opacity: 0.3; pointer-events: none; }
}
</style>
