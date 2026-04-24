<template>
  <view class="page page-lock">
    <DesktopNav current="plaza" />

    <view class="page-header">
      <text class="ph-title">{{ t('plaza.title') }}</text>
      <view class="compose-btn" role="button" :aria-label="t('a11y.compose')" @click="openComposer" v-if="isLoggedIn">
        <view class="cb-pen"></view>
        <text class="cb-label">{{ t('plaza.write') }}</text>
      </view>
    </view>

    <view class="search-wrap">
      <view class="search-bar">
        <view class="sb-icon"></view>
        <input
          v-model="searchText"
          :placeholder="t('plaza.searchPlaceholder')"
          class="sb-input"
          confirm-type="search"
          @input="onSearchInput"
          @confirm="onSearchSubmit"
        />
        <view v-if="searchText" class="sb-clear" role="button" :aria-label="t('a11y.searchClear')" @click="clearSearch"></view>
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
      <PlazaBannerCarousel />

      <view v-if="loading && posts.length === 0" class="loading">
        <text>{{ t('home.loading') }}...</text>
      </view>

      <view v-else-if="posts.length === 0" class="empty">
        <view class="empty-icon"></view>
        <text class="empty-text">{{ t('plaza.empty') }}</text>
        <view v-if="isLoggedIn" class="cta-btn" @click="openComposer">{{ t('plaza.write') }}</view>
      </view>

      <view v-else class="posts">
        <view v-for="post in posts" :key="post.id" class="post-card">
          <view class="post-tappable" @click="goPostDetail(post)" @longpress="onPostLongPress(post)">
            <view class="post-header">
              <image :src="post.profile?.avatar_url || '/static/default-avatar.svg'" class="pa-avatar" mode="aspectFill" />
              <view class="pa-info">
                <view class="pa-name-row">
                  <text class="pa-name">{{ post.profile?.nickname || t('app.user') }}</text>
                  <view v-if="post.is_official" class="badge-official"><text>{{ t('plaza.official') }}</text></view>
                  <view v-else-if="post.profile?.is_illini_verified" class="badge-illini"><text>Illini</text></view>
                  <view v-if="post.is_pinned" class="badge-pinned"><text>{{ t('plaza.pinned') }}</text></view>
                </view>
                <text class="pa-time">{{ formatTime(post.created_at) }}</text>
              </view>
              <view v-if="post.user_id === currentUser?.id" class="post-more" role="button" :aria-label="t('a11y.more')" @click.stop="onDeletePost(post)">
                <view class="pm-dot"></view><view class="pm-dot"></view><view class="pm-dot"></view>
              </view>
            </view>

            <view class="post-content-wrap">
              <text class="post-content">{{ translations[post.id] ? translations[post.id] : post.content }}</text>
              <view
                v-if="post.content && post.content.trim().length > 0"
                :class="['pc-translate', { loading: translatingId === post.id }]"
                role="button"
                :aria-label="t('a11y.translate')"
                @click.stop="togglePostTranslate(post)"
              >
                <text v-if="translatingId !== post.id">{{ translations[post.id] ? 'A文' : '文A' }}</text>
                <text v-else>···</text>
              </view>
            </view>

            <view
              v-if="post.images && post.images.length > 0"
              :class="['post-images', `pi-n${Math.min(post.images.length, 4)}`]"
            >
              <!--
                Each slot reserves its exact aspect ratio from the DB-persisted
                post.image_dimensions (migration 014). Unknown slots fall back
                to 4/5 via dimsToAspectStyle's default; clamp [0.4, 2.5] stops
                freak panoramas from stretching a cell.
              -->
              <img
                v-for="(img, i) in post.images"
                :key="i"
                :src="thumbUrl(img, 'card')"
                class="post-image"
                :style="dimsToAspectStyle(post.image_dimensions, i)"
                loading="lazy"
                @click.stop="previewImage(post.images, i)"
              />
            </view>
          </view>

          <view
            v-if="post.attached_item"
            class="attached-item-card"
            @click.stop="goToAttachedItem(post.attached_item!.id)"
          >
            <image
              :src="thumbUrl(post.attached_item.images?.[0], 'list') || '/static/placeholder.svg'"
              class="aic-img"
              mode="aspectFill"
              lazy-load
              :alt="post.attached_item.title"
            />
            <view class="aic-body">
              <text class="aic-title">{{ localize(post.attached_item.title_i18n, post.attached_item.title) }}</text>
              <text class="aic-price">${{ post.attached_item.price }}</text>
              <text v-if="post.attached_item.status === 'sold'" class="aic-sold">{{ t('status.sold') }}</text>
            </view>
            <view class="aic-arrow">›</view>
          </view>

          <view class="post-actions">
            <view class="pa-btn" role="button" :aria-label="post.liked_by_me ? t('a11y.unlike') : t('a11y.like')" @click.stop="onToggleLike(post)">
              <image
                :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'"
                class="heart-img"
              />
              <text :class="['pa-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
            </view>
            <view class="pa-btn" role="button" :aria-label="t('a11y.comment')" @click.stop="openComments(post)">
              <view class="bubble-ico"></view>
              <text class="pa-num">{{ post.comment_count }}</text>
            </view>
            <view class="pa-btn" role="button" :aria-label="t('a11y.share')" @click.stop="onSharePost(post)">
              <view class="share-ico"></view>
            </view>
          </view>
        </view>
      </view>

      <view v-if="!hasMore && posts.length > 0" class="end-tip">
        <text>{{ t('home.endOf') }}</text>
      </view>
    </scroll-view>

    <view v-if="showComposer" class="composer-fullpage">
      <view class="comp-header">
        <text class="comp-cancel" @click="onComposerCancel">{{ t('plaza.cancel') }}</text>
        <text class="comp-title">{{ t('plaza.write') }}</text>
        <text :class="['comp-submit', { disabled: (!composerText.trim() && composerImages.length === 0) || submitting }]" @click="onSubmitPost">
          {{ submitting ? t('login.wait') : t('plaza.submit') }}
        </text>
      </view>
      <view class="comp-body">
        <textarea
          v-model="composerText"
          :placeholder="t('plaza.postHint')"
          class="comp-textarea"
          :adjust-position="true"
          :auto-height="true"
          :focus="composerFocused"
          maxlength="2000"
        />
        <view v-if="composerImages.length > 0" class="comp-images">
          <view v-for="(img, i) in composerImages" :key="i" class="ci-wrap">
            <image :src="img" class="ci-img" mode="aspectFill" />
            <view class="ci-remove" role="button" :aria-label="t('a11y.delete')" @click="removeComposerImage(i)">
              <view class="ci-x"></view>
            </view>
          </view>
        </view>
        <view v-if="composerAttachedItem" class="comp-attached" role="button" :aria-label="t('a11y.delete')" @click="composerAttachedItem = null">
          <image
            :src="thumbUrl(composerAttachedItem.images?.[0], 'list') || '/static/placeholder.svg'"
            class="ca-img"
            mode="aspectFill"
          />
          <view class="ca-body">
            <text class="ca-title">{{ localize(composerAttachedItem.title_i18n, composerAttachedItem.title) }}</text>
            <text class="ca-price">${{ composerAttachedItem.price }}</text>
          </view>
          <view class="ca-remove"><view class="ci-x"></view></view>
        </view>
      </view>
      <view class="comp-footer">
        <view class="comp-tools">
          <view v-if="composerImages.length < 4" class="comp-add-img" role="button" :aria-label="t('a11y.pickImage')" @click="onComposerPickImage">
            <view class="cai-ico"></view>
          </view>
          <view v-if="!composerAttachedItem" class="comp-attach-btn" @click="onOpenAttachSheet">
            <text class="cab-ico">🏷️</text>
            <text class="cab-label">{{ t('plaza.attachItem') }}</text>
          </view>
        </view>
        <text class="comp-count">{{ 2000 - composerText.length }} {{ t('plaza.charsLeft') }}</text>
      </view>
    </view>

    <view v-if="showAttachSheet" class="sheet-mask sheet-mask-over-composer" @click="showAttachSheet = false"></view>
    <view :class="['attach-sheet', { open: showAttachSheet }]">
      <view class="as-header">
        <text class="as-title">{{ t('plaza.pickItem') }}</text>
        <view class="as-close" role="button" :aria-label="t('a11y.close')" @click="showAttachSheet = false"><view class="cs-x"></view></view>
      </view>
      <scroll-view class="as-list" scroll-y>
        <view v-if="myActiveItems.length === 0" class="as-empty">
          <text>{{ t('plaza.noMyItems') }}</text>
        </view>
        <view
          v-for="it in myActiveItems"
          :key="it.id"
          class="as-item"
          @click="onPickAttachedItem(it)"
        >
          <image
            :src="thumbUrl(it.images?.[0], 'list') || '/static/placeholder.svg'"
            class="as-img"
            mode="aspectFill"
          />
          <view class="as-body">
            <text class="as-title-text">{{ localize(it.title_i18n, it.title) }}</text>
            <text class="as-price">${{ it.price }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <view v-if="commentingPost" class="sheet-mask" @click="closeComments"></view>
    <view :class="['comments-sheet', { open: !!commentingPost }]">
      <view class="cs-header">
        <text class="cs-title">{{ t('plaza.comments') }} ({{ commentingPost?.comment_count || 0 }})</text>
        <view class="cs-close" role="button" :aria-label="t('a11y.close')" @click="closeComments">
          <view class="cs-x"></view>
        </view>
      </view>
      <scroll-view class="cs-list" scroll-y>
        <view v-if="comments.length === 0 && !loadingComments" class="cs-empty">
          <text>{{ t('plaza.noComments') }}</text>
        </view>
        <view v-for="c in comments" :key="c.id" class="cs-item" @click="onCommentTap(c)" @longpress="onCommentLongPress(c)">
          <image :src="c.profile?.avatar_url || '/static/default-avatar.svg'" class="cs-avatar" mode="aspectFill" />
          <view class="cs-body">
            <view class="cs-top">
              <text class="cs-name">{{ c.profile?.nickname || t('app.user') }}</text>
              <text class="cs-time">{{ formatTime(c.created_at) }}</text>
            </view>
            <text v-if="c.reply_to_name" class="cs-reply-ref">@{{ c.reply_to_name }}</text>
            <text class="cs-content">{{ c.content }}</text>
          </view>
        </view>
      </scroll-view>
      <view v-if="replyTo" class="cs-reply-bar">
        <text class="cs-reply-label">{{ t('plaza.replyingTo') }} @{{ replyTo.profile?.nickname || t('app.user') }}</text>
        <view class="cs-reply-x" role="button" :aria-label="t('a11y.close')" @click="replyTo = null">
          <view class="cs-rx"></view>
        </view>
      </view>
      <view class="cs-input-bar">
        <input
          v-model="commentText"
          :placeholder="replyTo ? t('plaza.replyHint') : t('plaza.commentHint')"
          class="cs-input"
          confirm-type="send"
          :focus="!!commentingPost"
          @confirm="onSubmitComment"
          maxlength="1000"
        />
        <view :class="['cs-send', { disabled: !commentText.trim() || commentSubmitting }]" role="button" :aria-label="t('a11y.sendMessage')" @click="onSubmitComment">
          <text>{{ replyTo ? t('plaza.reply') : t('plaza.comment') }}</text>
        </view>
      </view>
    </view>

    <CustomTabBar v-if="!commentingPost && !showComposer" current="plaza" />
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { usePlaza } from '../../composables/usePlaza'
import { useModeration } from '../../composables/useModeration'
import { useItems } from '../../composables/useItems'
import { useHistory } from '../../composables/useHistory'
import { useTranslate } from '../../composables/useTranslate'
import type { Post, PostComment } from '../../types'
import { formatTime, compressImage, friendlyErrorMessage, quickTranslate, thumbUrl } from '../../utils'
import { dimsToAspectStyle } from '../../utils/imgStyle'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import PlazaBannerCarousel from '../../components/PlazaBannerCarousel.vue'

const { t, lang, localize } = useI18n()
const { currentUser, isLoggedIn, requireAuth } = useAuth()
const { posts, loading, hasMore, fetchPosts, createPost, updatePostI18n, deletePost, toggleLike, fetchComments, createComment, deleteComment, fetchMyActiveItems } = usePlaza()
const { ensureLoaded: ensureBlockedLoaded, reportTarget } = useModeration()

const refreshing = ref(false)
const pageIdx = ref(0)

const searchText = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    pageIdx.value = 0
    fetchPosts({ reset: true, search: searchText.value })
  }, 300)
}
function onSearchSubmit() {
  if (searchDebounce) clearTimeout(searchDebounce)
  pageIdx.value = 0
  fetchPosts({ reset: true, search: searchText.value })
}
function clearSearch() {
  searchText.value = ''
  pageIdx.value = 0
  fetchPosts({ reset: true })
}

const showComposer = ref(false)
const composerText = ref('')
const composerImages = ref<string[]>([])
const composerFocused = ref(false)
const submitting = ref(false)

type AttachableItem = NonNullable<Post['attached_item']>
const composerAttachedItem = ref<AttachableItem | null>(null)
const showAttachSheet = ref(false)
const myActiveItems = ref<AttachableItem[]>([])

async function onOpenAttachSheet() {
  if (!requireAuth()) return
  showAttachSheet.value = true
  if (myActiveItems.value.length === 0) {
    myActiveItems.value = await fetchMyActiveItems() as AttachableItem[]
  }
}

function onPickAttachedItem(it: AttachableItem) {
  composerAttachedItem.value = it
  showAttachSheet.value = false
}

function goToAttachedItem(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}
const { uploadImagesWithDims } = useItems()
const { translateContentToAll } = useTranslate()
const { addPostToHistory } = useHistory()

function openComposer() {
  showComposer.value = true
  setTimeout(() => { composerFocused.value = true }, 300)
}

const commentingPost = ref<Post | null>(null)
const comments = ref<PostComment[]>([])
const loadingComments = ref(false)
const commentText = ref('')
const replyTo = ref<PostComment | null>(null)

/* ---------- Per-card translation (plaza list)
   translations[post.id] holds the translated content; presence of a
   non-empty string means 'translated', absence means 'show original'.
   Toggle is per-card, so a user can translate one noisy post without
   redrawing the whole feed. Uses the same /api/translate + quickTranslate
   fallback pipeline as the detail page, keyed to the current app lang. */
const translations = reactive<Record<string, string>>({})
const translatingId = ref('')
const { translate: translateText, getCached } = useTranslate()

async function togglePostTranslate(post: Post) {
  if (!post.content) return
  if (translations[post.id]) {
    delete translations[post.id]
    return
  }
  const target = lang.value as 'en' | 'zh'
  const cached = getCached(post.content, target)
  if (cached) { translations[post.id] = cached; return }
  translations[post.id] = quickTranslate(post.content, target)
  translatingId.value = post.id
  try {
    const live = await translateText(post.content, target)
    if (live) translations[post.id] = live
  } finally {
    translatingId.value = ''
  }
}

onMounted(async () => {
  await ensureBlockedLoaded()
  await fetchPosts({ reset: true })
})

async function onRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  pageIdx.value = 0
  const failsafe = setTimeout(() => { refreshing.value = false }, 10000)
  try {
    await fetchPosts({ reset: true, search: searchText.value })
  } finally {
    clearTimeout(failsafe)
    refreshing.value = false
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  pageIdx.value++
  await fetchPosts({ page: pageIdx.value, search: searchText.value })
}

async function onToggleLike(post: Post) {
  if (!requireAuth()) return
  addPostToHistory(post)
  try {
    await toggleLike(post)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

function onComposerCancel() {
  composerFocused.value = false
  showComposer.value = false
  composerText.value = ''
  composerImages.value = []
  composerAttachedItem.value = null
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
  const failsafe = setTimeout(() => { submitting.value = false }, 30000)
  try {
    let imageUrls: string[] = []
    let imageDims: Array<{ w: number; h: number }> = []
    if (composerImages.value.length > 0) {
      const up = await uploadImagesWithDims(composerImages.value)
      imageUrls = up.urls
      imageDims = up.dims
    }

    const trimmed = composerText.value.trim()
    const sourceLang = lang.value

    const newPost = await createPost(
      composerText.value,
      imageUrls,
      composerAttachedItem.value?.id || null,
      {
        image_dimensions: imageDims,
        content_i18n: trimmed ? { [sourceLang]: trimmed } : null,
        source_lang: sourceLang,
      },
    )

    composerText.value = ''
    composerImages.value = []
    composerAttachedItem.value = null
    showComposer.value = false
    uni.showToast({ title: t('plaza.posted'), icon: 'success' })

    // Fire-and-forget bilingual fill. Same strategy as the item publish
    // flow: don't block the toast, best-effort upsert the other locale.
    if (trimmed && newPost?.id) {
      translateContentToAll(trimmed, sourceLang as any)
        .then((map) => {
          if (Object.keys(map).length > 1) updatePostI18n(newPost.id, map)
        })
        .catch((err) => console.warn('[plaza] bilingual fill skipped:', err))
    }
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

function onDeletePost(post: Post) {
  uni.showActionSheet({
    itemList: [t('plaza.delete')],
    itemColor: 'var(--accent-danger)',
    success: (res) => {
      if (res.tapIndex !== 0) return
      uni.showModal({
        title: t('plaza.deleteConfirm'),
        confirmColor: 'var(--accent-danger)',
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

function goPostDetail(post: Post) {
  addPostToHistory(post)
  uni.navigateTo({ url: `/pages/post/index?id=${post.id}` })
}

function onSharePost(post: Post) {
  /* Server-side OG meta renders at /share-post/:id so shared links unfurl
     into a rich card with the post title + excerpt + image in WeChat /
     Twitter / Slack / etc. See api/share-post.js. */
  let origin = 'https://caaci-community-marketplace-bazaar.vercel.app'
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) origin = window.location.origin
  // #endif
  const url = `${origin}/share-post/${post.id}`
  const preview = post.content.slice(0, 60).replace(/\n/g, ' ')
  uni.setClipboardData({
    data: `${preview}…\n${url}`,
    success: () => uni.showToast({ title: t('plaza.contentCopied'), icon: 'success' }),
  })
}

async function openComments(post: Post) {
  commentingPost.value = post
  addPostToHistory(post)
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
  replyTo.value = null
}

const commentSubmitting = ref(false)

async function onSubmitComment() {
  if (!requireAuth()) return
  if (!commentText.value.trim() || !commentingPost.value) return
  if (commentSubmitting.value) return
  commentSubmitting.value = true
  const failsafe = setTimeout(() => { commentSubmitting.value = false }, 15000)
  try {
    let text = commentText.value
    if (replyTo.value) {
      const name = replyTo.value.profile?.nickname || t('app.user')
      text = `@${name} ${text}`
    }
    const c = await createComment(commentingPost.value.id, text, replyTo.value?.id)
    if (replyTo.value) {
      ;(c as any).reply_to_name = replyTo.value.profile?.nickname || t('app.user')
    }
    comments.value.push(c)
    commentText.value = ''
    replyTo.value = null
    uni.showToast({ title: t('plaza.commented'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    clearTimeout(failsafe)
    commentSubmitting.value = false
  }
}

function onCommentTap(c: PostComment) {
  if (!currentUser.value) return
  replyTo.value = c
}

function onCommentLongPress(c: PostComment) {
  if (!currentUser.value) return
  const isMine = c.user_id === currentUser.value.id
  const items = isMine
    ? [t('plaza.reply'), t('plaza.delete')]
    : [t('plaza.reply'), t('plaza.report')]
  uni.showActionSheet({
    itemList: items,
    success: (res) => {
      if (res.tapIndex === 0) {
        replyTo.value = c
      } else if (isMine && res.tapIndex === 1) {
        uni.showModal({
          title: t('plaza.commentDeleteConfirm'),
          confirmColor: 'var(--accent-danger)',
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
      } else if (!isMine && res.tapIndex === 1) {
        promptReportUser(c.user_id)
      }
    },
  })
}

function promptReportUser(userId: string) {
  promptReport('user', userId)
}

function onPostLongPress(post: any) {
  if (!currentUser.value) {
    uni.navigateTo({ url: '/pages/login/index' })
    return
  }
  if (post.user_id === currentUser.value.id) return
  uni.showActionSheet({
    itemList: [t('report.reportPost'), t('report.reportUser')],
    success: (res) => {
      if (res.tapIndex === 0) promptReport('post', post.id)
      else if (res.tapIndex === 1) promptReport('user', post.user_id)
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
</script>

<style lang="scss" scoped>
.page {
  height: 100vh;
  height: 100dvh;
  background: var(--canvas);
  max-width: 480px;
  margin: 0 auto;
  display: flex; flex-direction: column;
  overflow: hidden;
}

.page-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 16px;
  padding-top: calc(11px + env(safe-area-inset-top, 0px));
  background: var(--canvas);
  border-bottom: 0.5px solid var(--border);
  z-index: 20;
}
.ph-title {
  font-family: var(--font-serif);
  font-size: 18px;
  font-weight: 500;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.compose-btn {
  height: 32px; padding: 0 13px 0 11px;
  border-radius: var(--radius-pill);
  background: var(--brand);
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  box-shadow: var(--shadow-cta);
  transition: background var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { background: var(--brand-deep); }
}
.cb-pen {
  width: 12px; height: 12px; position: relative;
  &::before {
    content: ''; position: absolute; inset: 0;
    background: #fff;
    clip-path: polygon(0 100%, 40% 100%, 100% 40%, 60% 0, 0 60%);
  }
}
.cb-label {
  font-size: 13px; color: #fff; font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
}

/*
 * Plaza search — refinement pattern: white input on canvas, UIUC
 * navy alpha border. Was previously parchment-on-white which blended
 * into the header chrome.
 */
.search-wrap {
  padding: 8px 16px;
  background: var(--canvas);
  border-bottom: 0.5px solid var(--border);
}
.search-bar {
  display: flex; align-items: center; gap: 8px;
  background: var(--surface);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  padding: 9px 13px;
}
.sb-icon {
  width: 14px; height: 14px; flex-shrink: 0;
  border: 1.6px solid var(--ink-faint); border-radius: 50%;
  position: relative;
  &::after {
    content: ''; position: absolute; right: -3px; bottom: -3px;
    width: 6px; height: 1.6px; background: var(--ink-faint);
    transform: rotate(45deg); transform-origin: left center;
  }
}
.sb-input {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 13px;
  color: var(--ink);
  letter-spacing: 0.02em;
}
.sb-clear {
  width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;
  background: var(--ink-faint); border-radius: 50%; position: relative;
  &::before, &::after {
    content: ''; position: absolute; inset: 0;
    margin: auto; width: 8px; height: 1.5px; background: #fff;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}

.feed {
  flex: 1;
  min-height: 0;
  padding-bottom: 76px;
}

.loading, .empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 16px; gap: 12px; color: var(--text-faint); font-size: 14px;
}
.empty-icon {
  width: 48px; height: 36px; border: 2.5px solid var(--border-strong);
  border-radius: 18px 18px 18px 4px; position: relative;
  margin-bottom: 4px;
}
.empty-text { font-size: 14px; color: var(--text-muted); }
.cta-btn {
  margin-top: 8px; padding: 10px 28px;
  background: var(--accent-primary); color: #fff; border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.85; }
}

.posts { padding: 8px 0 20px; }
.post-card {
  background: var(--bg-elev-1); padding: 14px 16px;
  border-bottom: 0.5px solid var(--line-hair);
}
.post-tappable {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.7; }
}
.post-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.pa-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
}
.pa-info { flex: 1; min-width: 0; }
.pa-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pa-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.pa-time { font-size: 11px; color: var(--text-faint); margin-top: 2px; display: block; }
.post-more {
  display: flex; gap: 3px; padding: 6px; cursor: pointer;
  &:active { opacity: 0.5; }
}
.pm-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-faint); }

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
/* Pinned uses amber warning per design spec — differentiates from
 * official (brand terracotta) and verified (campus blue). Three
 * semantic badge colors, three distinct roles, so users can scan
 * a feed of mixed posts and know "what kind of thing" each is at
 * a glance. */
.badge-pinned {
  background: var(--warning-soft); color: var(--warning);
  padding: 1px 6px; border-radius: 4px;
  text { font-size: 10px; font-weight: 600; color: var(--warning); letter-spacing: 0.02em; }
}

.post-content-wrap { position: relative; padding-right: 40px; }
.post-content {
  font-size: 15px; color: var(--text-primary); line-height: 1.5;
  white-space: pre-wrap; word-break: break-word; display: block;
}
.pc-translate {
  position: absolute; top: -2px; right: 0;
  min-width: 32px; height: 22px; border-radius: 11px;
  background: var(--bg-subtle); padding: 0 7px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  text { font-size: 10px; color: var(--text-secondary); font-weight: 600; letter-spacing: 0.2px; }
  &:active { background: var(--bg-inset); }
  &.loading { opacity: 0.7; pointer-events: none; }
}

.post-images {
  display: grid; gap: 4px; margin-top: 10px;
}
.post-images.pi-n1 {
  display: block;
  .post-image {
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 520px;
    aspect-ratio: auto;
    object-fit: contain;
    border-radius: 10px;
    background: var(--bg-subtle);
  }
}
.post-images.pi-n2 { grid-template-columns: 1fr 1fr; }
.post-images.pi-n3 { grid-template-columns: 1fr 1fr 1fr; }
.post-images.pi-n4 { grid-template-columns: 1fr 1fr; }
/*
 * Default grid tile: aspect-ratio and object-fit are overridden by the
 * per-image inline style produced by postImgStyleFor() once the first
 * image in the post reports its natural dimensions. 4/5 portrait is the
 * visual fallback (most phone photos) — critically we use `contain`, not
 * `cover`, so side pixels are never discarded. A soft background fills
 * any letterbox bands so the grid still reads as solid.
 */
.post-image {
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 8px;
  background: var(--bg-subtle);
  object-fit: contain;
  cursor: pointer;
  display: block;
}

.post-actions {
  display: flex; gap: 24px; margin-top: 12px;
  padding-top: 10px; border-top: 0.5px solid var(--line-hair);
}
.pa-btn {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.heart-img {
  width: 20px; height: 20px; transition: transform 0.15s;
  &:active { transform: scale(1.2); }
}
.pa-num { font-size: 12px; color: var(--text-muted); font-weight: 500; &.active { color: var(--accent-danger); } }

.bubble-ico {
  width: 18px; height: 15px; border: 1.8px solid var(--text-muted);
  border-radius: 8px 8px 8px 2px;
}
.share-ico {
  width: 16px; height: 16px; position: relative;
  &::before {
    content: ''; position: absolute; top: 1px; left: 50%;
    transform: translateX(-50%);
    width: 0; height: 8px; border-left: 1.8px solid var(--text-muted);
  }
  &::after {
    content: ''; position: absolute; top: 0; left: 50%;
    transform: translateX(-50%) rotate(45deg);
    width: 8px; height: 8px;
    border-left: 1.8px solid var(--text-muted); border-top: 1.8px solid var(--text-muted);
  }
}

.end-tip { text-align: center; padding: 24px; font-size: 12px; color: var(--text-faint); }

.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 1000;
}
.composer-fullpage {
  position: fixed; inset: 0; z-index: 1100;
  background: var(--bg-elev-1);
  display: flex; flex-direction: column;
  max-width: 480px; margin: 0 auto;
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.comp-body {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column;
}
.comp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--line-hair);
}
.comp-cancel { font-size: 15px; color: var(--text-muted); cursor: pointer; }
.comp-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.comp-submit {
  font-size: 15px; font-weight: 600; color: var(--accent-action); cursor: pointer;
  &.disabled { opacity: 0.3; pointer-events: none; }
}
.comp-textarea {
  width: 100%; padding: 16px; min-height: 200px;
  font-size: 16px; color: var(--text-primary); line-height: 1.5;
  box-sizing: border-box; background: transparent; border: none;
}
.comp-images {
  display: flex; gap: 8px; padding: 4px 16px 8px;
  flex-wrap: wrap;
}
.ci-wrap {
  position: relative; width: 72px; height: 72px;
  border-radius: 8px; overflow: hidden;
}
.ci-img { width: 100%; height: 100%; background: var(--bg-subtle); }
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
    width: 10px; height: 1.5px; background: var(--bg-elev-1);
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.comp-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px;
  border-top: 0.5px solid var(--line-hair);
}
.comp-tools { display: flex; gap: 12px; }
.comp-add-img {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--bg-subtle); display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { background: var(--bg-inset); }
}
.cai-ico {
  width: 18px; height: 14px; border: 1.8px solid var(--text-secondary);
  border-radius: 2px; position: relative;
  &::before {
    content: ''; position: absolute; top: 2px; left: 3px;
    width: 4px; height: 4px; border-radius: 50%; border: 1.4px solid var(--text-secondary);
  }
}
.comp-count { font-size: 12px; color: var(--text-faint); }

.comp-attach-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 8px;
  background: var(--bg-subtle); cursor: pointer;
  &:active { background: var(--bg-inset); }
}
.cab-ico { font-size: 14px; }
.cab-label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }

.comp-attached {
  margin-top: 10px;
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg-subtle); cursor: pointer;
}
.ca-img { width: 48px; height: 48px; border-radius: 8px; flex-shrink: 0; }
.ca-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ca-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-price { font-size: 13px; color: var(--accent-action); font-weight: 600; }
.ca-remove {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.attached-item-card {
  margin: 8px 14px 0 54px;
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg-subtle);
  cursor: pointer;
  &:active { background: var(--bg-inset); }
}
.aic-img { width: 52px; height: 52px; border-radius: 8px; flex-shrink: 0; }
.aic-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.aic-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aic-price { font-size: 14px; color: var(--accent-action); font-weight: 700; }
.aic-sold { font-size: 11px; color: var(--text-muted); }
.aic-arrow { font-size: 22px; color: var(--text-faint); line-height: 1; flex-shrink: 0; }

/* Attach-item picker opens ON TOP of the compose-fullpage (z-index 1100).
   Its mask + sheet must sit above 1100 so users see it without closing
   the composer first. Bumped to 1200 range. */
.sheet-mask-over-composer { z-index: 1200 !important; }
.attach-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1201;
  max-height: 70vh; background: var(--bg-elev-1); border-radius: 20px 20px 0 0;
  transform: translateY(100%); transition: transform 0.26s ease;
  display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  &.open { transform: translateY(0); }
}
.as-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--line-hair);
}
.as-title { font-size: 15px; font-weight: 600; }
.as-close {
  width: 28px; height: 28px; border-radius: 50%; background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
}
.as-list { flex: 1; padding: 8px 16px 16px; }
.as-empty { text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px; }
.as-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 0.5px solid rgba(0,0,0,0.04);
  cursor: pointer;
  &:active { background: var(--bg-subtle); }
}
.as-img { width: 56px; height: 56px; border-radius: 8px; flex-shrink: 0; }
.as-body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.as-title-text { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.as-price { font-size: 13px; color: var(--accent-action); font-weight: 600; }

.comments-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001;
  max-width: 480px; margin: 0 auto;
  background: var(--bg-elev-1); border-radius: 16px 16px 0 0;
  transform: translateY(100%);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  height: 70vh; display: flex; flex-direction: column;
  box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
  &.open { transform: translateY(0); }
}
.cs-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--line-hair);
}
.cs-title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.cs-close {
  width: 28px; height: 28px; border-radius: 50%; background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.cs-x {
  width: 12px; height: 12px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 12px; height: 1.5px; background: var(--text-secondary);
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.cs-list { flex: 1; padding: 8px 0; }
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
.cs-content { font-size: 14px; color: var(--text-primary); line-height: 1.45; margin-top: 2px; display: block; word-break: break-word; }

.cs-reply-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px;
  background: rgba(199,74,47,0.08);
  border-top: 0.5px solid rgba(199,74,47,0.2);
}
.cs-reply-label { font-size: 12px; color: var(--accent-action); font-weight: 500; flex: 1; }
.cs-reply-x {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  &:active { background: rgba(199,74,47,0.15); }
}
.cs-rx {
  width: 10px; height: 10px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 10px; height: 1.5px; background: var(--accent-action);
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.cs-reply-ref {
  display: block; font-size: 11px; color: var(--accent-action); font-weight: 500;
  margin-top: 2px;
}
.cs-input-bar {
  display: flex; gap: 8px; padding: 9px 12px;
  background: var(--bg-elev-1); border-top: 0.5px solid var(--line-hair);
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
}
.cs-input {
  flex: 1; height: 40px; background: var(--bg-subtle); border-radius: 20px;
  padding: 0 14px; font-size: 14px; color: var(--text-primary);
}
.cs-send {
  padding: 0 16px; height: 40px; border-radius: 20px;
  background: var(--accent-primary); color: #fff; display: flex; align-items: center;
  cursor: pointer;
  text { font-size: 13px; color: #fff; font-weight: 600; }
  &.disabled { opacity: 0.3; pointer-events: none; }
}

@media (min-width: 768px) {
  .page-header { display: none; }
  .page { padding-bottom: 0; height: auto; min-height: 100vh; overflow: visible; }
  .feed { padding-bottom: 0; }
}
</style>
