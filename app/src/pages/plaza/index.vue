<template>
  <view class="page">
    <DesktopNav current="plaza" />

    <view class="page-header">
      <text class="ph-title">{{ t('plaza.title') }}</text>
      <view class="compose-btn" @click="showComposer = true" v-if="isLoggedIn">
        <view class="cb-pen"></view>
      </view>
    </view>

    <scroll-view
      class="feed"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="loadMore"
    >
      <view v-if="loading && posts.length === 0" class="loading">
        <text>{{ t('home.loading') }}...</text>
      </view>

      <view v-else-if="posts.length === 0" class="empty">
        <view class="empty-icon"></view>
        <text class="empty-text">{{ t('plaza.empty') }}</text>
        <view v-if="isLoggedIn" class="cta-btn" @click="showComposer = true">{{ t('plaza.write') }}</view>
      </view>

      <view v-else class="posts">
        <view v-for="post in posts" :key="post.id" class="post-card">
          <view class="post-header">
            <image :src="post.profile?.avatar_url || '/static/default-avatar.svg'" class="pa-avatar" />
            <view class="pa-info">
              <view class="pa-name-row">
                <text class="pa-name">{{ post.profile?.nickname || t('app.user') }}</text>
                <view v-if="post.is_official" class="badge-official"><text>{{ t('plaza.official') }}</text></view>
                <view v-else-if="post.profile?.is_illini_verified" class="badge-illini"><text>Illini</text></view>
                <view v-if="post.is_pinned" class="badge-pinned"><text>{{ t('plaza.pinned') }}</text></view>
              </view>
              <text class="pa-time">{{ formatTime(post.created_at) }}</text>
            </view>
            <view v-if="post.user_id === currentUser?.id" class="post-more" @click="onDeletePost(post)">
              <view class="pm-dot"></view><view class="pm-dot"></view><view class="pm-dot"></view>
            </view>
          </view>

          <text class="post-content">{{ post.content }}</text>

          <view v-if="post.images && post.images.length > 0" class="post-images">
            <image
              v-for="(img, i) in post.images"
              :key="i"
              :src="img"
              mode="aspectFill"
              class="post-image"
              @click="previewImage(post.images, i)"
            />
          </view>

          <view class="post-actions">
            <view class="pa-btn" @click="onToggleLike(post)">
              <view :class="['heart', { active: post.liked_by_me }]"></view>
              <text :class="['pa-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
            </view>
            <view class="pa-btn" @click="openComments(post)">
              <view class="bubble-ico"></view>
              <text class="pa-num">{{ post.comment_count }}</text>
            </view>
            <view class="pa-btn" @click="onSharePost(post)">
              <view class="share-ico"></view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="!hasMore && posts.length > 0" class="end-tip">
        <text>{{ t('home.endOf') }}</text>
      </view>
    </scroll-view>

    <view v-if="showComposer" class="sheet-mask" @click="showComposer = false"></view>
    <view :class="['composer', { open: showComposer }]">
      <view class="comp-header">
        <text class="comp-cancel" @click="onComposerCancel">{{ t('plaza.cancel') }}</text>
        <text class="comp-title">{{ t('plaza.write') }}</text>
        <text :class="['comp-submit', { disabled: (!composerText.trim() && composerImages.length === 0) || submitting }]" @click="onSubmitPost">
          {{ submitting ? t('login.wait') : t('plaza.submit') }}
        </text>
      </view>
      <textarea
        v-model="composerText"
        :placeholder="t('plaza.postHint')"
        class="comp-textarea"
        :focus="showComposer"
        maxlength="2000"
      />
      <view v-if="composerImages.length > 0" class="comp-images">
        <view v-for="(img, i) in composerImages" :key="i" class="ci-wrap">
          <image :src="img" class="ci-img" mode="aspectFill" />
          <view class="ci-remove" @click="removeComposerImage(i)">
            <view class="ci-x"></view>
          </view>
        </view>
      </view>
      <view class="comp-footer">
        <view class="comp-tools">
          <view v-if="composerImages.length < 4" class="comp-add-img" @click="onComposerPickImage">
            <view class="cai-ico"></view>
          </view>
        </view>
        <text class="comp-count">{{ 2000 - composerText.length }} {{ t('plaza.charsLeft') }}</text>
      </view>
    </view>

    <view v-if="commentingPost" class="sheet-mask" @click="closeComments"></view>
    <view :class="['comments-sheet', { open: !!commentingPost }]">
      <view class="cs-header">
        <text class="cs-title">{{ t('plaza.comments') }} ({{ commentingPost?.comment_count || 0 }})</text>
        <view class="cs-close" @click="closeComments">
          <view class="cs-x"></view>
        </view>
      </view>
      <scroll-view class="cs-list" scroll-y>
        <view v-if="comments.length === 0 && !loadingComments" class="cs-empty">
          <text>{{ t('plaza.noComments') }}</text>
        </view>
        <view v-for="c in comments" :key="c.id" class="cs-item" @longpress="onCommentLongPress(c)">
          <image :src="c.profile?.avatar_url || '/static/default-avatar.svg'" class="cs-avatar" />
          <view class="cs-body">
            <view class="cs-top">
              <text class="cs-name">{{ c.profile?.nickname || t('app.user') }}</text>
              <text class="cs-time">{{ formatTime(c.created_at) }}</text>
            </view>
            <text class="cs-content">{{ c.content }}</text>
          </view>
        </view>
      </scroll-view>
      <view class="cs-input-bar">
        <input
          v-model="commentText"
          :placeholder="t('plaza.commentHint')"
          class="cs-input"
          confirm-type="send"
          :focus="!!commentingPost"
          @confirm="onSubmitComment"
          maxlength="1000"
        />
        <view :class="['cs-send', { disabled: !commentText.trim() }]" @click="onSubmitComment">
          <text>{{ t('plaza.comment') }}</text>
        </view>
      </view>
    </view>

    <CustomTabBar current="plaza" />
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onPullDownRefresh } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { usePlaza } from '../../composables/usePlaza'
import { useModeration } from '../../composables/useModeration'
import { useItems } from '../../composables/useItems'
import type { Post, PostComment } from '../../types'
import { formatTime, compressImage } from '../../utils'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'

const { t } = useI18n()
const { currentUser, isLoggedIn, requireAuth } = useAuth()
const { posts, loading, hasMore, fetchPosts, createPost, deletePost, toggleLike, fetchComments, createComment, deleteComment } = usePlaza()
const { ensureLoaded: ensureBlockedLoaded, reportTarget } = useModeration()

const refreshing = ref(false)
const pageIdx = ref(0)

const showComposer = ref(false)
const composerText = ref('')
const composerImages = ref<string[]>([])
const submitting = ref(false)
const { uploadImages } = useItems()

const commentingPost = ref<Post | null>(null)
const comments = ref<PostComment[]>([])
const loadingComments = ref(false)
const commentText = ref('')

onMounted(async () => {
  await ensureBlockedLoaded()
  await fetchPosts({ reset: true })
})

async function onRefresh() {
  refreshing.value = true
  pageIdx.value = 0
  await fetchPosts({ reset: true })
  refreshing.value = false
}

onPullDownRefresh(async () => {
  await onRefresh()
  uni.stopPullDownRefresh()
})

async function loadMore() {
  if (loading.value || !hasMore.value) return
  pageIdx.value++
  await fetchPosts({ page: pageIdx.value })
}

async function onToggleLike(post: Post) {
  if (!requireAuth()) return
  try {
    await toggleLike(post)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

function onComposerCancel() {
  showComposer.value = false
  composerText.value = ''
  composerImages.value = []
}

function onComposerPickImage() {
  uni.chooseImage({
    count: 4 - composerImages.value.length,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res: any) => {
      const paths: string[] = res.tempFilePaths || []
      for (const p of paths) {
        try {
          const c = await compressImage(p, 1600, 0.82)
          composerImages.value.push(c)
        } catch {
          composerImages.value.push(p)
        }
      }
    },
  })
}

function removeComposerImage(idx: number) {
  composerImages.value.splice(idx, 1)
}

async function onSubmitPost() {
  if (!requireAuth()) return
  if (!composerText.value.trim() && composerImages.value.length === 0) {
    uni.showToast({ title: t('plaza.needContent'), icon: 'none' })
    return
  }
  if (submitting.value) return
  submitting.value = true
  try {
    let imageUrls: string[] = []
    if (composerImages.value.length > 0) {
      imageUrls = await uploadImages(composerImages.value)
    }
    await createPost(composerText.value, imageUrls)
    composerText.value = ''
    composerImages.value = []
    showComposer.value = false
    uni.showToast({ title: t('plaza.posted'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('plaza.postFail'), icon: 'none' })
  } finally {
    submitting.value = false
  }
}

function onDeletePost(post: Post) {
  uni.showActionSheet({
    itemList: [t('plaza.delete')],
    itemColor: '#FF3B30',
    success: (res) => {
      if (res.tapIndex !== 0) return
      uni.showModal({
        title: t('plaza.deleteConfirm'),
        confirmColor: '#FF3B30',
        success: async (r) => {
          if (!r.confirm) return
          try {
            await deletePost(post.id)
            uni.showToast({ title: t('profile.deleted'), icon: 'success' })
          } catch (err: any) {
            uni.showToast({ title: err?.message || t('profile.markFail'), icon: 'none' })
          }
        },
      })
    },
  })
}

function previewImage(urls: string[], idx: number) {
  uni.previewImage({ urls, current: urls[idx] })
}

function onSharePost(post: Post) {
  const preview = post.content.slice(0, 80)
  uni.setClipboardData({
    data: preview,
    success: () => uni.showToast({ title: t('detail.linkCopied'), icon: 'success' }),
  })
}

async function openComments(post: Post) {
  commentingPost.value = post
  comments.value = []
  loadingComments.value = true
  try {
    comments.value = await fetchComments(post.id)
  } catch {} finally {
    loadingComments.value = false
  }
}

function closeComments() {
  commentingPost.value = null
  comments.value = []
  commentText.value = ''
}

async function onSubmitComment() {
  if (!requireAuth()) return
  if (!commentText.value.trim() || !commentingPost.value) return
  try {
    const c = await createComment(commentingPost.value.id, commentText.value)
    comments.value.push(c)
    commentText.value = ''
    uni.showToast({ title: t('plaza.commented'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('plaza.postFail'), icon: 'none' })
  }
}

function onCommentLongPress(c: PostComment) {
  if (!currentUser.value || c.user_id !== currentUser.value.id) return
  uni.showActionSheet({
    itemList: [t('plaza.delete')],
    itemColor: '#FF3B30',
    success: (res) => {
      if (res.tapIndex !== 0) return
      uni.showModal({
        title: t('plaza.commentDeleteConfirm'),
        confirmColor: '#FF3B30',
        success: async (r) => {
          if (!r.confirm || !commentingPost.value) return
          try {
            await deleteComment(c.id, commentingPost.value.id)
            comments.value = comments.value.filter(x => x.id !== c.id)
          } catch (err: any) {
            uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
          }
        },
      })
    },
  })
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f2f2f7;
  max-width: 480px;
  margin: 0 auto;
  padding-bottom: 70px;
  display: flex; flex-direction: column;
  height: 100vh;
}

.page-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 16px;
  padding-top: calc(11px + env(safe-area-inset-top, 0px));
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  z-index: 20;
}
.ph-title { font-size: 17px; font-weight: 700; color: #1a1a1a; }
.compose-btn {
  width: 34px; height: 34px; border-radius: 50%;
  background: #1a1a1a; display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { opacity: 0.8; }
}
.cb-pen {
  width: 14px; height: 14px; position: relative;
  &::before {
    content: ''; position: absolute; inset: 0;
    background: #fff;
    clip-path: polygon(0 100%, 40% 100%, 100% 40%, 60% 0, 0 60%);
  }
}

.feed {
  flex: 1;
  height: calc(100vh - 115px);
}

.loading, .empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 16px; gap: 12px; color: #aeaeb2; font-size: 14px;
}
.empty-icon {
  width: 48px; height: 36px; border: 2.5px solid #d1d1d6;
  border-radius: 18px 18px 18px 4px; position: relative;
  margin-bottom: 4px;
}
.empty-text { font-size: 14px; color: #8e8e93; }
.cta-btn {
  margin-top: 8px; padding: 10px 28px;
  background: #1a1a1a; color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.85; }
}

.posts { padding: 8px 0 20px; }
.post-card {
  background: #fff; padding: 14px 16px;
  border-bottom: 0.5px solid rgba(0,0,0,0.05);
}
.post-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.pa-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: #f2f2f7; flex-shrink: 0;
}
.pa-info { flex: 1; min-width: 0; }
.pa-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pa-name { font-size: 14px; font-weight: 600; color: #1a1a1a; }
.pa-time { font-size: 11px; color: #aeaeb2; margin-top: 2px; display: block; }
.post-more {
  display: flex; gap: 3px; padding: 6px; cursor: pointer;
  &:active { opacity: 0.5; }
}
.pm-dot { width: 3px; height: 3px; border-radius: 50%; background: #aeaeb2; }

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

.post-content {
  font-size: 15px; color: #1a1a1a; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word; display: block;
}

.post-images {
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  gap: 4px; margin-top: 10px;
}
.post-image {
  width: 100%; aspect-ratio: 1; border-radius: 8px;
  background: #f2f2f7; object-fit: cover; cursor: pointer;
}

.post-actions {
  display: flex; gap: 24px; margin-top: 12px;
  padding-top: 10px; border-top: 0.5px solid rgba(0,0,0,0.05);
}
.pa-btn {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.heart {
  width: 18px; height: 16px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 0;
    width: 9px; height: 13px; border-radius: 9px 9px 0 0;
    background: transparent; border: 1.8px solid #8e8e93;
  }
  &::before { left: 0; transform: rotate(-45deg); transform-origin: bottom right; }
  &::after { right: 0; transform: rotate(45deg); transform-origin: bottom left; }
  &.active::before, &.active::after { background: #FF3B30; border-color: #FF3B30; }
}
.pa-num { font-size: 12px; color: #8e8e93; font-weight: 500; &.active { color: #FF3B30; } }

.bubble-ico {
  width: 18px; height: 15px; border: 1.8px solid #8e8e93;
  border-radius: 8px 8px 8px 2px;
}
.share-ico {
  width: 16px; height: 16px; position: relative;
  &::before {
    content: ''; position: absolute; top: 1px; left: 50%;
    transform: translateX(-50%);
    width: 0; height: 8px; border-left: 1.8px solid #8e8e93;
  }
  &::after {
    content: ''; position: absolute; top: 0; left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 8px; height: 8px;
    border-left: 1.8px solid #8e8e93; border-top: 1.8px solid #8e8e93;
  }
}

.end-tip { text-align: center; padding: 24px; font-size: 12px; color: #c7c7cc; }

.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 500;
}
.composer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 501;
  background: #fff; border-radius: 16px 16px 0 0;
  transform: translateY(100%);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  max-height: 70vh;
  padding-bottom: env(safe-area-inset-bottom, 0);
  &.open { transform: translateY(0); }
}
.comp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.comp-cancel { font-size: 15px; color: #8e8e93; cursor: pointer; }
.comp-title { font-size: 16px; font-weight: 700; color: #1a1a1a; }
.comp-submit {
  font-size: 15px; font-weight: 600; color: #FF6B35; cursor: pointer;
  &.disabled { opacity: 0.3; pointer-events: none; }
}
.comp-textarea {
  width: 100%; padding: 16px; min-height: 160px; max-height: 300px;
  font-size: 15px; color: #1a1a1a; line-height: 1.5;
  box-sizing: border-box;
}
.comp-images {
  display: flex; gap: 8px; padding: 4px 16px 8px;
  flex-wrap: wrap;
}
.ci-wrap {
  position: relative; width: 72px; height: 72px;
  border-radius: 8px; overflow: hidden;
}
.ci-img { width: 100%; height: 100%; background: #f2f2f7; }
.ci-remove {
  position: absolute; top: 3px; right: 3px;
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  &:active { opacity: 0.7; }
}
.ci-x {
  width: 10px; height: 10px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 10px; height: 1.5px; background: #fff;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.comp-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px;
  border-top: 0.5px solid rgba(0,0,0,0.06);
}
.comp-tools { display: flex; gap: 12px; }
.comp-add-img {
  width: 32px; height: 32px; border-radius: 8px;
  background: #f2f2f7; display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { background: #e5e5ea; }
}
.cai-ico {
  width: 18px; height: 14px; border: 1.8px solid #636366;
  border-radius: 2px; position: relative;
  &::before {
    content: ''; position: absolute; top: 2px; left: 3px;
    width: 4px; height: 4px; border-radius: 50%; border: 1.4px solid #636366;
  }
}
.comp-count { font-size: 12px; color: #c7c7cc; }

.comments-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 501;
  max-width: 480px; margin: 0 auto;
  background: #fff; border-radius: 16px 16px 0 0;
  transform: translateY(100%);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  height: 70vh; display: flex; flex-direction: column;
  &.open { transform: translateY(0); }
}
.cs-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.cs-title { font-size: 15px; font-weight: 700; color: #1a1a1a; }
.cs-close {
  width: 28px; height: 28px; border-radius: 50%; background: #f2f2f7;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.cs-x {
  width: 12px; height: 12px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 12px; height: 1.5px; background: #636366;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.cs-list { flex: 1; padding: 8px 0; }
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
.cs-content { font-size: 14px; color: #1a1a1a; line-height: 1.45; margin-top: 2px; display: block; word-break: break-word; }

.cs-input-bar {
  display: flex; gap: 8px; padding: 9px 12px;
  background: #fff; border-top: 0.5px solid rgba(0,0,0,0.06);
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
}
.cs-input {
  flex: 1; height: 40px; background: #f2f2f7; border-radius: 20px;
  padding: 0 14px; font-size: 14px; color: #1a1a1a;
}
.cs-send {
  padding: 0 16px; height: 40px; border-radius: 20px;
  background: #1a1a1a; color: #fff; display: flex; align-items: center;
  cursor: pointer;
  text { font-size: 13px; color: #fff; font-weight: 600; }
  &.disabled { opacity: 0.3; pointer-events: none; }
}

@media (min-width: 768px) {
  .page-header { display: none; }
  .page { padding-bottom: 0; height: auto; min-height: 100vh; }
  .feed { height: calc(100vh - 65px); }
}
</style>
