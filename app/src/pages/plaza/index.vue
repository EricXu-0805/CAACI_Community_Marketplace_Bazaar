<template>
  <view class="page page-lock has-sidebar">
    <AppSidebar current="plaza" />

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

    <!-- Feed tabs live OUTSIDE the scroll area (directly under search) so
         they stay put while the feed scrolls — 闲鱼/xhs pattern. -->
    <scroll-view class="feed-tabs" scroll-x :show-scrollbar="false">
      <view class="ft-row">
        <view
          v-for="tab in feedTabs"
          :key="tab.key"
          :class="['ft-chip', { active: activeTab === tab.key }]"
          role="button"
          :aria-pressed="activeTab === tab.key ? 'true' : 'false'"
          @click="activeTab = tab.key"
        >
          <text class="t-tag ft-label">{{ tab.label }}</text>
        </view>
      </view>
    </scroll-view>

    <scroll-view
      class="feed"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="loadMore"
    >
      <PlazaBannerCarousel />

      <template v-if="activeTab === 'following'">
        <view v-if="followLoading && followItems.length === 0" class="loading">
          <text>{{ t('home.loading') }}...</text>
        </view>

        <view v-else-if="followItems.length === 0" class="empty">
          <view class="empty-icon"></view>
          <text class="u-thumb-ph-seal" style="opacity:0.14;font-size:48px">集</text>
          <text class="empty-text">{{ isLoggedIn ? t('follow.emptyFeed') : t('profile.signInHint') }}</text>
        </view>

        <view v-else class="follow-grid">
          <view
            v-for="it in followItems"
            :key="it.id"
            class="follow-card u-rise"
            @click="goToFollowItem(it.id)"
          >
            <image
              v-if="thumbUrl(it.images?.[0], 'card')"
              :src="thumbUrl(it.images?.[0], 'card')"
              class="fc-img"
              mode="aspectFill"
              lazy-load
            />
            <view v-else class="fc-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal">集</text></view>
            <view class="fc-body">
              <text class="fc-title">{{ localize(it.title_i18n, it.title) }}</text>
              <view class="fc-price-row">
                <text v-if="it.listing_type === 'wanted'" class="u-wanted-tag">{{ t('item.wanted') }}</text>
                <text class="fc-price">{{ listingPriceLabel(it, t) }}</text>
              </view>
              <view v-if="it.profile" class="fc-seller">
                <image :src="it.profile.avatar_url || defaultAvatarSrc" class="fc-avatar" mode="aspectFill" />
                <text class="fc-nick">{{ it.profile.nickname }}</text>
              </view>
            </view>
          </view>
        </view>
      </template>

      <view v-else-if="loading && posts.length === 0" class="loading">
        <text>{{ t('home.loading') }}...</text>
      </view>

      <view v-else-if="visiblePosts.length === 0" class="empty">
        <view class="empty-icon"></view>
        <text class="u-thumb-ph-seal" style="opacity:0.14;font-size:48px">集</text>
        <text class="empty-text">{{ t('plaza.empty') }}</text>
        <view v-if="isLoggedIn" class="cta-btn" @click="openComposer">{{ t('plaza.write') }}</view>
      </view>

      <view v-else class="posts">
        <view v-for="post in visiblePosts" :key="post.id" class="post-card u-rise">
          <!--
            Pinned-collapsed surface: when a pinned announcement is in
            its compact state, render a single-line summary that the
            user can tap to expand. Avoids the long-pinned-post-eats-
            the-fold problem (P2-1) while preserving the announcement's
            visibility. Tapping the chevron expands the card in place.
          -->
          <view
            v-if="post.is_pinned && !pinnedExpanded.has(post.id)"
            class="pinned-collapsed"
            @click="pinnedExpanded.add(post.id)"
          >
            <text class="pc-icon">📌</text>
            <view class="pc-body">
              <text class="pc-title">{{ post.profile?.nickname || t('plaza.pinned') }}</text>
              <text class="pc-meta">{{ formatTime(post.created_at) }} · {{ t('plaza.tapToExpand') }}</text>
            </view>
            <text class="pc-chev">›</text>
          </view>
          <view
            v-else
            :class="['post-tappable', { 'pinned-expanded': post.is_pinned && pinnedExpanded.has(post.id) }]"
            @click="goPostDetail(post)"
            @touchstart="postLongPress.onTouchstart(post)"
            @touchend="postLongPress.onTouchend"
            @touchcancel="postLongPress.onTouchcancel"
            @touchmove="postLongPress.onTouchmove"
          >
            <!--
              Collapse affordance for an EXPANDED pinned announcement.
              Sits above the card content (top-right) so a user who
              opened the announcement can put it back. @click.stop is
              load-bearing — the parent .post-tappable@click would
              otherwise navigate-to-detail, and the user would never
              see the collapse fire.
            -->
            <view
              v-if="post.is_pinned && pinnedExpanded.has(post.id)"
              class="pinned-collapse-btn"
              role="button"
              :aria-label="t('plaza.collapse')"
              @click.stop="pinnedExpanded.delete(post.id)"
            >
              <view class="pcb-chev"></view>
            </view>
            <view class="post-header">
              <image :src="post.profile?.avatar_url || defaultAvatarSrc" :alt="post.profile?.nickname || 'avatar'" class="pa-avatar" mode="aspectFill" @click.stop="goSeller(post.user_id)" />
              <view class="pa-info">
                <view class="pa-name-row">
                  <text class="pa-name" @click.stop="goSeller(post.user_id)">{{ post.profile?.nickname || t('app.user') }}</text>
                  <UBadge v-if="post.is_official" variant="official">{{ t('plaza.official') }}</UBadge>
                  <UBadge v-else-if="post.profile?.is_illini_verified" variant="illini">Illini</UBadge>
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
                :style="dimsToAspectStyle(effectiveDims(post), i)"
                loading="lazy"
                @load="onImgLoad($event, post, i)"
                @click.stop="previewImage(post.images, i)"
              />
            </view>
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
              <text class="aic-price">${{ pi.item.price }}</text>
              <text v-if="pi.item.status === 'sold'" class="aic-sold">{{ t('status.sold') }}</text>
            </view>
            <view class="aic-arrow">›</view>
          </view>

          <view class="post-actions">
            <view class="pa-btn" role="button" :aria-label="post.liked_by_me ? t('a11y.unlike') : t('a11y.like')" @click.stop="onToggleLike(post)">
              <image
                :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'"
                alt=""
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

          <!-- Inline comments expansion (D1 Strategy B: single-active accordion).
               @click.stop on root + every interactive child blocks the post-card
               body's goPostDetail navigation handler (post-tappable @click). -->
          <view v-if="commentingPost?.id === post.id" class="comments-inline" @click.stop>
            <view class="ci-count-label">
              <text>{{ t('plaza.commentCount', { count: comments.length }) }}</text>
            </view>

            <view v-if="loadingComments && comments.length === 0" class="ci-loading">
              <text>{{ t('home.loading') }}</text>
            </view>
            <view v-else-if="comments.length === 0" class="ci-empty">
              <text>{{ t('plaza.noComments') }}</text>
            </view>

            <template v-for="thread in commentThreads" :key="thread.parent.id">
              <view
                class="cs-item"
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
                  @click.stop="onCommentTap(thread.parent)"
                />
                <view class="cs-body" @click.stop="onCommentTap(thread.parent)">
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
                    @click.stop="onCommentTap(child)"
                  />
                  <view class="cs-body" @click.stop="onCommentTap(child)">
                    <view class="cs-top">
                      <text class="cs-name">{{ child.profile?.nickname || t('app.user') }}</text>
                      <text class="cs-time">{{ formatTime(child.created_at) }}</text>
                    </view>
                    <text v-if="child.reply_to_name" class="cs-reply-ref">@{{ child.reply_to_name }}</text>
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
                  @click.stop="toggleReplies(thread.parent.id)"
                >
                  <text class="cs-expand-text">
                    {{ expandedReplies.has(thread.parent.id)
                        ? t('plaza.hideReplies')
                        : t('plaza.viewMoreReplies', { count: thread.children.length - 3 }) }}
                  </text>
                </view>
              </template>
            </template>

            <view v-if="replyTo" class="ci-reply-bar">
              <text class="ci-reply-label">{{ t('plaza.replyingTo') }} @{{ replyTo.profile?.nickname || t('app.user') }}</text>
              <view class="ci-reply-x" role="button" :aria-label="t('a11y.close')" @click.stop="replyTo = null"><view class="ci-rx"></view></view>
            </view>

            <view class="ci-input-bar">
              <input
                v-model="commentText"
                class="ci-input"
                :placeholder="replyTo ? t('plaza.replyHint') : t('plaza.commentHint')"
                confirm-type="send"
                :focus="inputFocused"
                :cursor-spacing="0"
                :adjust-position="false"
                @focus="inputFocused = true"
                @blur="inputFocused = false"
                @confirm="onSubmitComment"
                @keyup.enter="onSubmitComment"
                maxlength="1000"
              />
              <view :class="['ci-send', { disabled: !commentText.trim() || commentSubmitting }]" role="button" :aria-label="t('a11y.sendMessage')" @click.stop="onSubmitComment">
                <text>{{ replyTo ? t('plaza.reply') : t('plaza.comment') }}</text>
              </view>
            </view>

            <view class="ci-collapse-link" role="button" :aria-label="t('plaza.collapseComments')" @click.stop="closeComments">
              <text class="ci-collapse-text">{{ t('plaza.collapseComments') }}</text>
            </view>
          </view>
        </view>
      </view>

      <view
        v-if="activeTab === 'following' ? (!followHasMore && followItems.length > 0) : (!hasMore && visiblePosts.length > 0)"
        class="end-tip"
      >
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
            <image :src="img" alt="Photo" class="ci-img" mode="aspectFill" />
            <view class="ci-remove" role="button" :aria-label="t('a11y.delete')" @click="removeComposerImage(i)">
              <view class="ci-x"></view>
            </view>
          </view>
        </view>
      </view>
      <view class="comp-bottom-stack" :style="{ transform: `translateY(-${kb.height}px)` }">
      <view v-if="composerAttachedItems.length > 0" class="comp-dock">
        <view
          v-for="it in composerAttachedItems"
          :key="it.id"
          class="comp-attached"
        >
          <image
            v-if="thumbUrl(it.images?.[0], 'list')"
            :src="thumbUrl(it.images?.[0], 'list')"
            :alt="localize(it.title_i18n, it.title)"
            class="ca-img"
            mode="aspectFill"
          />
          <view v-else class="ca-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">集</text></view>
          <view class="ca-body">
            <text class="ca-title">{{ localize(it.title_i18n, it.title) }}</text>
            <text class="ca-price">${{ it.price }}</text>
          </view>
          <view
            class="ca-remove"
            role="button"
            :aria-label="t('a11y.removeChip')"
            @click.stop="removeChip(it.id)"
          >
            <view class="ci-x"></view>
          </view>
        </view>
      </view>
      <view class="comp-footer">
        <view class="comp-tools">
          <view v-if="composerImages.length < 4" class="comp-add-img" role="button" :aria-label="t('a11y.pickImage')" @click="onComposerPickImage">
            <view class="cai-ico"></view>
          </view>
          <view
            class="comp-attach-btn"
            :class="{ disabled: chipCapReached }"
            role="button"
            :aria-disabled="chipCapReached ? 'true' : 'false'"
            @click="onAttachBtnClick"
          >
            <UIcon name="tag" size="xs" color="brand" />
            <text class="cab-label">{{ t('plaza.attachItem') }}</text>
          </view>
        </view>
        <text class="comp-count">{{ 2000 - composerText.length }} {{ t('plaza.charsLeft') }}</text>
      </view>
      </view>
    </view>

    <view v-if="showAttachSheet" class="sheet-mask sheet-mask-over-composer u-mask-in" @click="showAttachSheet = false"></view>
    <view :class="['attach-sheet', { open: showAttachSheet }]">
      <view class="as-header">
        <text class="as-title">{{ t('plaza.pickItem') }}</text>
        <view class="as-close" role="button" :aria-label="t('a11y.close')" @click="showAttachSheet = false"><view class="cs-x"></view></view>
      </view>
      <scroll-view class="as-list" scroll-y>
        <view v-if="availableActiveItems.length === 0" class="as-empty">
          <text>{{ t('plaza.noMyItems') }}</text>
        </view>
        <view
          v-for="it in availableActiveItems"
          :key="it.id"
          class="as-item"
          @click="onPickAttachedItem(it)"
        >
          <image
            v-if="thumbUrl(it.images?.[0], 'list')"
            :src="thumbUrl(it.images?.[0], 'list')"
            :alt="localize(it.title_i18n, it.title)"
            class="as-img"
            mode="aspectFill"
            lazy-load
          />
          <view v-else class="as-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">集</text></view>
          <view class="as-body">
            <text class="as-title-text">{{ localize(it.title_i18n, it.title) }}</text>
            <text class="as-price">${{ it.price }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <CustomTabBar v-if="!showComposer" current="plaza" />
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { onShareAppMessage, onShareTimeline, onUnload } from '@dcloudio/uni-app'

import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useTheme } from '../../composables/useTheme'
import { usePlaza, groupCommentsByParent } from '../../composables/usePlaza'
import { useFollow } from '../../composables/useFollow'
import { useModeration } from '../../composables/useModeration'
import { useItems } from '../../composables/useItems'
import { useHistory } from '../../composables/useHistory'
import { useTranslate } from '../../composables/useTranslate'
import { useLongPress } from '../../composables/useLongPress'
import { useKeyboardHeight } from '../../composables/useKeyboardHeight'
import type { Post, PostComment, Item } from '../../types'
import { formatTime, compressImage, friendlyErrorMessage, quickTranslate, thumbUrl, listingPriceLabel } from '../../utils'
import { DIALOG_DANGER } from '../../utils/dialogColors'
import { dimsToAspectStyle, readNaturalDims } from '../../utils/imgStyle'
import type { ImageDim } from '../../types'
import AppSidebar from '../../components/AppSidebar.vue'
import { BASE_URL } from '../../config/runtime'
import CustomTabBar from '../../components/CustomTabBar.vue'
import PlazaBannerCarousel from '../../components/PlazaBannerCarousel.vue'
import UBadge from '../../components/UBadge.vue'
import UIcon from '../../components/UIcon.vue'

const { t, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, isLoggedIn, requireAuth } = useAuth()
const { posts, loading, hasMore, fetchPosts, createPost, updatePostI18n, deletePost, toggleLike, toggleCommentLike, fetchComments, createComment, deleteComment, fetchMyActiveItems, clearPosts } = usePlaza()
const { fetchFollowingFeed, loadMyFollowing } = useFollow()
const { ensureLoaded: ensureBlockedLoaded, reportTarget } = useModeration()
const kb = useKeyboardHeight()

onShareAppMessage(() => ({
  title: '校园广场 · Illini Market',
  path: '/pages/plaza/index',
}))

onShareTimeline(() => ({
  title: '校园广场 · Illini Market',
}))

// Release the module-scoped feed on page unload so posts (with images +
// comments) don't outlive the page. Tab pages rarely unload, so this is a
// safety net rather than a hot path.
onUnload(() => {
  clearPosts()
})

const refreshing = ref(false)
const pageIdx = ref(0)

/*
 * Feed sub-tabs (v5 kit: 关注 / 热门 / 最新). 热门 and 最新 both show all
 * posts but差 in server sort — 热门 ranks by engagement, 最新 by recency —
 * so switching between them re-fetches. 关注 loads the current user's
 * followed sellers' active LISTINGS via useFollow.fetchFollowingFeed
 * (marketplace items, not posts). The prior 推荐/官方 split was replaced to
 * match the v5 design; CAACI 官方 posts still surface inline (pinned-first
 * + OFFICIAL badge) rather than via a dedicated tab.
 */
type FeedTabKey = 'following' | 'hot' | 'recent'
const activeTab = ref<FeedTabKey>('recent')
const feedTabs = computed<{ key: FeedTabKey; label: string }[]>(() => [
  { key: 'following', label: t('plaza.tab.following') },
  { key: 'hot', label: t('plaza.tab.hot') },
  { key: 'recent', label: t('plaza.tab.recent') },
])
const feedSort = computed<'recent' | 'hot'>(() => (activeTab.value === 'hot' ? 'hot' : 'recent'))
const visiblePosts = computed(() => posts.value)

/* 关注 tab — followed sellers' active listings (items, not posts). Lazy-
 * loaded the first time the user opens the tab, then paginated via the
 * scroll-view's bottom-reach handler. followLoaded gates the one-shot
 * initial fetch; followLoading guards against concurrent loads. */
const FOLLOW_PAGE_SIZE = 20
const followItems = ref<Item[]>([])
const followLoading = ref(false)
const followHasMore = ref(true)
const followPage = ref(0)
const followLoaded = ref(false)

async function loadFollowing(reset: boolean) {
  if (followLoading.value) return
  if (!currentUser.value) {
    followItems.value = []
    followLoaded.value = true
    return
  }
  if (reset) followPage.value = 0
  followLoading.value = true
  try {
    await loadMyFollowing()
    const rows = await fetchFollowingFeed(followPage.value)
    if (reset) followItems.value = rows
    else followItems.value.push(...rows)
    followHasMore.value = rows.length === FOLLOW_PAGE_SIZE
    followLoaded.value = true
  } finally {
    followLoading.value = false
  }
}

watch(activeTab, (k) => {
  if (k === 'following') {
    if (!followLoaded.value) loadFollowing(true)
  } else {
    // 热门 / 最新 differ only by server sort — re-fetch on switch.
    pageIdx.value = 0
    fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value })
  }
})

/*
 * Render-side safety net for post.image_dimensions.
 *
 * Same contract as the home feed (see pages/index/index.vue): DB wins,
 * but when image_dimensions is empty ([]) we measure on @load and patch
 * a local map keyed by post.id so subsequent re-renders reserve the
 * right slot. See _ai_notes/IMAGE_PIPELINE_*.md for why.
 */
const measuredDims = ref<Record<string, ImageDim[]>>({})

function effectiveDims(post: Post): ImageDim[] | null {
  const fromDb = post?.image_dimensions
  if (Array.isArray(fromDb) && fromDb.length > 0 && fromDb.some((d) => d && d.w > 0 && d.h > 0)) {
    return fromDb
  }
  return measuredDims.value[post.id] || null
}

function onImgLoad(e: any, post: Post, idx: number) {
  const fromDb = post?.image_dimensions
  if (Array.isArray(fromDb) && fromDb[idx] && fromDb[idx].w > 0 && fromDb[idx].h > 0) return
  const natural = readNaturalDims(e)
  if (!natural) return
  const prev = measuredDims.value[post.id] ? measuredDims.value[post.id].slice() : []
  prev[idx] = natural
  measuredDims.value = { ...measuredDims.value, [post.id]: prev }
}

const searchText = ref('')
let searchDebounce: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    pageIdx.value = 0
    fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value })
  }, 300)
}
function onSearchSubmit() {
  if (searchDebounce) clearTimeout(searchDebounce)
  pageIdx.value = 0
  fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value })
}
function clearSearch() {
  searchText.value = ''
  pageIdx.value = 0
  fetchPosts({ reset: true, sort: feedSort.value })
}

const showComposer = ref(false)
const composerText = ref('')
const composerImages = ref<string[]>([])
const composerFocused = ref(false)
const submitting = ref(false)

type AttachableItem = NonNullable<Post['post_items']>[number]['item']
const MAX_CHIPS = 3
const composerAttachedItems = ref<AttachableItem[]>([])
const chipCapReached = computed(() => composerAttachedItems.value.length >= MAX_CHIPS)
const showAttachSheet = ref(false)
const myActiveItems = ref<AttachableItem[]>([])
/* Picker hides items already attached to this composer session, so the
   user can't pick the same item twice (matches the (post_id, item_id)
   composite PK in mig 041's post_items — duplicate would 23505 server-side). */
const availableActiveItems = computed(() =>
  myActiveItems.value.filter(
    it => !composerAttachedItems.value.some(c => c.id === it.id),
  ),
)

async function onOpenAttachSheet() {
  if (!requireAuth()) return
  showAttachSheet.value = true
  if (myActiveItems.value.length === 0) {
    myActiveItems.value = await fetchMyActiveItems() as AttachableItem[]
  }
}

function onAttachBtnClick() {
  if (chipCapReached.value) return
  onOpenAttachSheet()
}

function onPickAttachedItem(it: AttachableItem) {
  // N14 layer 2 — defense vs orphan picker: if composer is already
  // closed (e.g. user tapped composer cancel while picker stayed open
  // and then tapped through to a row), drop the pick and close the sheet.
  // Without this, the chip would land on composerAttachedItems and
  // bleed into the next openComposer session as a phantom selection.
  if (!showComposer.value) {
    showAttachSheet.value = false
    return
  }
  if (chipCapReached.value) {
    showAttachSheet.value = false
    return
  }
  if (composerAttachedItems.value.some(c => c.id === it.id)) {
    showAttachSheet.value = false
    return
  }
  composerAttachedItems.value.push(it)
  showAttachSheet.value = false
}

function removeChip(itemId: string) {
  composerAttachedItems.value = composerAttachedItems.value.filter(c => c.id !== itemId)
}

function goToAttachedItem(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

function goToFollowItem(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

/* Post author avatar/name → seller page. Always lands on the default
   商品 tab regardless of entry point (2026-06 meeting decision); the
   ?tab=posts deep-link exists but is intentionally not used here. */
function goSeller(userId: string) {
  uni.navigateTo({ url: `/pages/seller/index?id=${userId}` })
}
const { uploadImagesWithDims } = useItems()
const { translateContentToAll } = useTranslate()
const { addPostToHistory } = useHistory()

function openComposer() {
  // N14 layer 3 — baseline reset before show. Defends against any
  // stale composer state surviving from a prior session via a path
  // that bypassed onComposerCancel (tab keep-alive, system back,
  // OAuth roundtrip in keep-alive scenarios). Re-set everything to
  // the empty default so what the user sees on open is always a
  // fresh composer. Focus is intentionally still scheduled inside
  // the existing 300ms setTimeout — focus must fire AFTER the modal
  // becomes visible, not before, so the soft keyboard mounts on the
  // visible textarea (mirroring the previous timing contract).
  composerText.value = ''
  composerImages.value = []
  composerAttachedItems.value = []
  showAttachSheet.value = false
  composerFocused.value = false
  showComposer.value = true
  setTimeout(() => { composerFocused.value = true }, 300)
}

const commentingPost = ref<Post | null>(null)
const comments = ref<PostComment[]>([])
const loadingComments = ref(false)
const commentText = ref('')
const replyTo = ref<PostComment | null>(null)
// Sheet 打开时 input 不应自动 focus（避免键盘挡评论列表）。
// inputFocused 由用户显式动作驱动：tap 输入框 / tap 评论 / tap "回复" / tap 长按菜单"回复"。
// 关闭 sheet / 切评论 reset 回 false，保证下次打开时键盘不会自动起。
const inputFocused = ref(false)

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

/* ---------- Per-card translation (plaza list)
   translations[post.id] holds the translated content; presence of a
   non-empty string means 'translated', absence means 'show original'.
   Toggle is per-card, so a user can translate one noisy post without
   redrawing the whole feed. Uses the same /api/translate + quickTranslate
   fallback pipeline as the detail page, keyed to the current app lang. */
const translations = reactive<Record<string, string>>({})
const translatingId = ref('')

/*
 * Set of pinned-post IDs the user has chosen to expand. Pinned posts
 * default to compact (single-line summary) so a long announcement
 * doesn't eat the fold. Reactive so adding an ID triggers a re-render
 * of the relevant card. Reset when posts are re-fetched is not
 * needed — IDs are stable, and a re-pinned-from-collapsed transition
 * is fine (user explicitly chose to expand it before).
 */
const pinnedExpanded = reactive(new Set<string>())
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
  await fetchPosts({ reset: true, sort: feedSort.value })
})

async function onRefresh() {
  if (refreshing.value) return
  // D8: collapse any inline-expanded comments before refreshing posts —
  // the expanded post may not survive the reset (deleted / RLS-hidden / out of new window).
  closeComments()
  refreshing.value = true
  pageIdx.value = 0
  const failsafe = setTimeout(() => { refreshing.value = false }, 10000)
  try {
    await fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value })
  } finally {
    clearTimeout(failsafe)
    refreshing.value = false
  }
}

async function loadMore() {
  if (activeTab.value === 'following') {
    if (!followLoading.value && followHasMore.value) {
      followPage.value += 1
      await loadFollowing(false)
    }
    return
  }
  if (loading.value || !hasMore.value) return
  pageIdx.value++
  await fetchPosts({ page: pageIdx.value, sort: feedSort.value, search: searchText.value })
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

async function onToggleCommentLike(comment: PostComment) {
  if (!requireAuth()) return
  try {
    await toggleCommentLike(comment)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('msg.actionFailed'), icon: 'none' })
  }
}

function onComposerCancel() {
  composerFocused.value = false
  showComposer.value = false
  composerText.value = ''
  composerImages.value = []
  composerAttachedItems.value = []
  // N14 layer 1 — close any orphan picker sheet so a sheet that was
  // mounted on top of the composer doesn't survive cancel and accept
  // a row tap that would silently mutate the next composer session.
  showAttachSheet.value = false
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
          const c = await compressImage(p, { entryPoint: 'plaza' })
          composerImages.value.push(c)
        } catch (err: any) {
          if (err?.heic === true) {
            uni.showToast({ title: t('heic.unsupported'), icon: 'none', duration: 3500 })
            continue
          }
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
    const expectedImages = composerImages.value.length
    console.log('[plaza-debug] onSubmitPost expectedImages:', expectedImages)
    if (expectedImages > 0) {
      let up: { urls: string[]; dims: Array<{ w: number; h: number }> }
      try {
        up = await uploadImagesWithDims(composerImages.value, { entryPoint: 'plaza' })
      } catch (upErr: any) {
        if (upErr?.heic === true) throw new Error(t('heic.unsupported'))
        throw upErr
      }
      imageUrls = up.urls
      imageDims = up.dims
      console.log('[plaza-debug] uploaded:', imageUrls.length, '/', expectedImages)
      if (imageUrls.length === 0) {
        throw new Error(t('plaza.uploadFailed'))
      }
      if (imageUrls.length < expectedImages) {
        uni.showToast({
          title: `${imageUrls.length}/${expectedImages} images uploaded`,
          icon: 'none',
          duration: 4000,
        })
      }
    }

    const trimmed = composerText.value.trim()
    const sourceLang = lang.value

    const result = await createPost(
      composerText.value,
      imageUrls,
      composerAttachedItems.value.map(c => c.id),
      {
        image_dimensions: imageDims,
        content_i18n: trimmed ? { [sourceLang]: trimmed } : null,
        source_lang: sourceLang,
      },
    )

    composerText.value = ''
    composerImages.value = []
    composerAttachedItems.value = []
    showComposer.value = false

    if (result.partial) {
      /* Post row landed but post_items insert failed (RLS reject /
         net blip / cap overflow). Soft-warn — the post is intact and
         visible; chips just aren't attached. Sentry breadcrumb fires
         from createPost itself. */
      uni.showToast({ title: t('plaza.partialPublish'), icon: 'none', duration: 4000 })
    } else {
      uni.showToast({ title: t('plaza.posted'), icon: 'success' })
    }

    // Fire-and-forget bilingual fill. Same strategy as the item publish
    // flow: don't block the toast, best-effort upsert the other locale.
    if (trimmed && result.id) {
      translateContentToAll(trimmed, sourceLang as any)
        .then((map) => {
          if (Object.keys(map).length > 1) updatePostI18n(result.id, map)
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
    itemColor: DIALOG_DANGER,
    success: (res) => {
      if (res.tapIndex !== 0) return
      uni.showModal({
        title: t('plaza.deleteConfirm'),
        confirmColor: DIALOG_DANGER,
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
  /*
   * An EXPANDED pinned post should not navigate on body tap — the user
   * just expanded it to read in place; surprise-navigating into the
   * detail page would be hostile. The dedicated chevron button (top-
   * right of the expanded card) is the only way to dismiss back to
   * compact. Non-pinned posts behave as before.
   */
  if (post.is_pinned && pinnedExpanded.has(post.id)) return
  addPostToHistory(post)
  uni.navigateTo({ url: `/pages/post/index?id=${post.id}` })
}

function onSharePost(post: Post) {
  /* Server-side OG meta renders at /share-post/:id so shared links unfurl
     into a rich card with the post title + excerpt + image in WeChat /
     Twitter / Slack / etc. See api/share-post.js. */
  let origin = BASE_URL
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
  // D1+D4 accordion: same-post tap toggles close; different-post tap auto-collapses
  // current then opens new (closeComments resets all state, including expandedReplies).
  if (commentingPost.value?.id === post.id) {
    closeComments()
    return
  }
  commentingPost.value = post
  inputFocused.value = false
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
  inputFocused.value = false
  expandedReplies.value = new Set()
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
    // 单层缩进语义：parent 永远指向顶层祖先。若 replyTo 是子评论，跳一级；
    // 否则就是它自己。groupCommentsByParent 渲染时也会做 walk-up 防御。
    const parentId = replyTo.value
      ? (replyTo.value.parent_comment_id ?? replyTo.value.id)
      : undefined
    const c = await createComment(commentingPost.value.id, text, parentId)
    // fetchComments hydrates reply_to_name from DB on next refresh; for the
    // optimistic push here we mirror the same logic by reading replyTo's nickname.
    c.reply_to_name = replyTo.value
      ? (replyTo.value.profile?.nickname ?? null)
      : null
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

// cs-avatar 也绑同 handler — 当前没用户主页页面，tap 头像 fallback 到回复，
// 避免 silent dead-zone。未来用户主页 ready 后改 cs-avatar @click 跳主页。
function onCommentTap(c: PostComment) {
  if (!currentUser.value) return
  replyTo.value = c
  inputFocused.value = true
}

/* 1.5s + haptic — long-press surfaces report/delete actions on plaza
   posts and comments. Same UX rationale as home/post pages: thumb
   resting during scroll used to trigger at 350ms. Tuned 3s → 2s in
   batch #2, then 2s → 1.5s in batch #3a — 2s still tested as draggy
   in user acceptance; 1.5s preserves the deliberate-intent gate while
   feeling responsive. Comment longpress moves in lockstep with post
   longpress so the feel of the plaza surface is consistent across
   whichever element a thumb lands on. */
const postLongPress = useLongPress<[any]>((post) => onPostLongPress(post), 1500)
const commentLongPress = useLongPress<[PostComment]>((c) => onCommentLongPress(c), 1500)

function onCommentLongPress(c: PostComment) {
  if (!currentUser.value) return
  const isMine = c.user_id === currentUser.value.id
  // Owner: 回复 / 删除（删除带二次确认 modal）
  // Non-owner: 回复 / 举报评论 / 举报用户 — 三选一拆开是因为举报评论内容
  // 和举报用户是不同的 moderation queue case (评论可能炒人 vs 用户多次违规)。
  // ReportTarget type 已含 'comment'（useModeration.ts:4），schema ready 不需要 migration。
  const items = isMine
    ? [t('plaza.reply'), t('plaza.delete')]
    : [t('plaza.reply'), t('plaza.reportComment'), t('plaza.reportUser')]
  uni.showActionSheet({
    itemList: items,
    success: (res) => {
      if (res.tapIndex === 0) {
        replyTo.value = c
        inputFocused.value = true
      } else if (isMine && res.tapIndex === 1) {
        uni.showModal({
          title: t('plaza.commentDeleteConfirm'),
          confirmColor: DIALOG_DANGER,
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
  padding-top: calc(11px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
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

/* P1 §1.6: soften page-title color in dark — see commentary in
 * profile/index.vue. Plaza's title uses --ink directly (vs the
 * --text-primary alias used in profile/publish) but both resolve to
 * #F0E8D6 cream in dark, with the same 14:1 over-contrast problem.
 * --ink-strong (0.92α) drops to ~12:1. Light unchanged. */
[data-theme="dark"] .ph-title { color: var(--ink-strong); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .ph-title { color: var(--ink-strong); }
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
  background: var(--surface-alt);
  border: 0.5px solid var(--border-hair);
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
    margin: auto; width: 8px; height: 1.5px; background: var(--ink-inverse);
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}

/*
 * Feed sub-tabs — ink-fill active chip row (active = --ink bg /
 * --ink-inverse text; inactive = --ink-quiet on transparent). Brand is
 * reserved for price/CTA/official, so selection state uses ink per the
 * nav-filter convention. Horizontally scrollable, 32px chips.
 */
.feed-tabs {
  width: 100%;
  white-space: nowrap;
  padding: var(--space-2) 0;
  /* Sits outside the scroll area now — paint the same canvas as the
     search bar above so the fixed header reads as one block. */
  background: var(--canvas);
  border-bottom: 0.5px solid var(--line-hair);
}
.ft-row {
  /* Three tabs, equal width, no h-scroll — fills the row like a native
     segmented control (活动 tab removed 2026-06 so everything fits). */
  display: flex;
  width: 100%;
  box-sizing: border-box;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
}
.ft-chip {
  flex: 1 1 auto;
  justify-content: center;
  height: 32px;
  padding: 0 var(--space-1);
  border-radius: var(--radius-pill);
  border: 0.5px solid var(--border);
  background: transparent;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--dur-1, 120ms) var(--ease-std, ease),
    color var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { opacity: 0.7; }
  &.active {
    background: var(--ink);
    border-color: var(--ink);
  }
}
.ft-label {
  color: var(--ink-quiet);
  line-height: 1;
  white-space: nowrap;
  .ft-chip.active & { color: var(--ink-inverse); }
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

/* 关注 tab — 2-col grid of followed sellers' active listings (item
   cards, visually distinct from the post-cards in 推荐/官方). Tokenized
   to ivory_academy v5 — surface card on warm border, terracotta price. */
.follow-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  padding: var(--space-2);
}
.follow-card {
  background: var(--surface);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { transform: scale(0.98); }
}
.fc-img {
  width: 100%;
  height: 160px;
  display: block;
  background: var(--bg-subtle);
}
.fc-body {
  padding: var(--space-2) var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fc-title {
  color: var(--ink);
  font-size: 13px;
  line-height: 1.45;
  letter-spacing: 0.02em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fc-price-row { display: flex; align-items: center; gap: 5px; }
.fc-price {
  color: var(--brand);
  font-size: 15px;
  font-weight: 700;
  display: block;
}
.fc-seller { display: flex; align-items: center; gap: 5px; }
.fc-avatar {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
}
.fc-nick {
  font-size: 11px; color: var(--ink-quiet);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.posts { padding: 8px 0 20px; }
.post-card {
  background: var(--bg-elev-1); padding: 14px 16px;
  border-bottom: 0.5px solid var(--line-hair);
}
.post-tappable {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  position: relative;          /* anchors .pinned-collapse-btn */
  &:active { opacity: 0.7; }
}

/* Expanded-pinned variant: body is read-only — no nav, no press feedback,
   so users don't get a "tap landed somewhere" cue when nothing should
   happen. Only the dedicated collapse chevron triggers an action. */
.post-tappable.pinned-expanded {
  cursor: default;
  &:active { opacity: 1; }
}

/* Collapse affordance, top-right of the expanded pinned card.
   38px tap target is comfortable for thumb-reach without overlapping
   the post-header avatar (which sits on the left). The chevron is
   built from CSS borders to match every other arrow icon in this
   file (no font-icon dependency). */
.pinned-collapse-btn {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--bg-subtle); opacity: 1; }
}
.pcb-chev {
  width: 9px; height: 9px;
  border-top: 1.8px solid var(--text-secondary);
  border-left: 1.8px solid var(--text-secondary);
  transform: rotate(45deg);
  /* Optical centering — the rotated square sits visually low without
     this nudge. 2px down + 0px right brings the chevron to center. */
  margin-top: 4px;
}

/* Pinned-collapsed compact surface — single-line summary that expands
   on tap. Sized to ~88rpx so it doesn't eat scroll real-estate the way
   a fully-rendered pinned post used to. */
.pinned-collapsed {
  display: flex; align-items: center; gap: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  padding: 4px 0;
  &:active { opacity: 0.7; }
}
.pc-icon { font-size: 20px; line-height: 1; flex-shrink: 0; }
.pc-body {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.pc-title {
  font-size: 14px; font-weight: 600;
  color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pc-meta {
  font-size: 12px; color: var(--text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pc-chev {
  font-size: 18px; color: var(--text-faint); flex-shrink: 0;
  font-weight: 300;
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

/* official + illini badges → components/UBadge.vue (variants official/illini). */
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

.composer-fullpage {
  position: fixed; inset: 0; z-index: 1100;
  background: var(--bg-elev-1);
  display: flex; flex-direction: column;
  max-width: 480px; margin: 0 auto;
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.comp-body {
  flex: 1; overflow-y: auto;
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
  background: rgba(31,29,27,0.6);
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
  &.disabled {
    opacity: 0.4;
    cursor: not-allowed;
    &:active { background: var(--bg-subtle); }
  }
}
.cab-label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }

.comp-dock {
  display: flex; flex-direction: column; gap: 8px;
  padding: 0 16px 8px;
}
.comp-attached {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg-subtle);
}
.ca-img { width: 48px; height: 48px; border-radius: 8px; flex-shrink: 0; }
.ca-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ca-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-price { font-size: 13px; color: var(--accent-action); font-weight: 600; }
.ca-remove {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--ink-soft); display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  &:active { opacity: 0.7; }
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
  transform: translateY(100%); transition: transform var(--dur-3) var(--ease-warm);
  display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  &.open { transform: translateY(0); }
}
.as-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--line-hair);
}
.as-title { font-size: 15px; font-weight: 600; }
/* N13 — Picker close button visibility in light mode.
   Was background: var(--bg-subtle) which sits ~same lightness as
   .as-header (sheet's own bg-elev-1 paper), so the round button
   silhouette dissolved into the header. Switching to var(--ink-soft)
   gives the round container a clear walnut/dark-warm fill that reads
   unambiguously as "tap target" against the cream sheet header.
   Size (28×28) and flex layout untouched — matches detail/index.vue's
   .rs-close pattern (Eric's reference). */
.as-close {
  width: 28px; height: 28px; border-radius: 50%; background: var(--ink-soft);
  display: flex; align-items: center; justify-content: center;
}
.as-list { flex: 1; padding: 8px 16px 16px; }
.as-empty { text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 13px; }
.as-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 0.5px solid var(--line-hair);
  cursor: pointer;
  &:active { background: var(--bg-subtle); }
}
.as-img { width: 56px; height: 56px; border-radius: 8px; flex-shrink: 0; }
.as-body { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.as-title-text { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.as-price { font-size: 13px; color: var(--accent-action); font-weight: 600; }

.cs-item {
  display: flex; gap: 10px; padding: 12px 16px;
  border-bottom: 0.5px solid var(--line-hair);
}
.cs-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.cs-body { flex: 1; min-width: 0; }
.cs-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.cs-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.cs-time { font-size: 11px; color: var(--text-faint); }
.cs-content { font-size: 14px; color: var(--text-primary); line-height: 1.45; margin-top: 2px; display: block; word-break: break-word; }
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

.cs-reply-ref {
  display: block; font-size: 11px; color: var(--accent-action); font-weight: 500;
  margin-top: 2px;
}

/* Inline comments expansion (P0-3b Strategy B). Renders inside the post-card
   v-for, conditional on commentingPost?.id === post.id. Negative horizontal
   margin extends the section to the post-card edges (post-card has padding:
   14px 16px). Border-top creates a soft separator from post-actions row. */
.comments-inline {
  background: var(--bg-elev-1);
  border-top: 0.5px solid var(--line-hair);
  margin: 8px -16px 0 -16px;
  padding-top: 4px;
}
.ci-count-label {
  padding: 8px 16px 4px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.ci-loading,
.ci-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-faint);
  font-size: 13px;
}

.ci-reply-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 16px;
  background: var(--bg-subtle);
  border-top: 0.5px solid var(--line-hair);
}
.ci-reply-label { font-size: 12px; color: var(--accent-action); font-weight: 500; flex: 1; }
.ci-reply-x {
  width: 20px; height: 20px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--brand-ghost); }
}
.ci-rx {
  width: 10px; height: 10px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 10px; height: 1.5px; background: var(--accent-action);
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}

.ci-input-bar {
  display: flex; gap: 8px; align-items: center;
  padding: 8px 16px;
  background: var(--bg-elev-1);
  border-top: 0.5px solid var(--line-hair);
}
.ci-input {
  flex: 1; height: 36px; background: var(--bg-subtle); border-radius: 18px;
  padding: 0 14px; font-size: 14px; color: var(--text-primary);
}
.ci-send {
  padding: 0 14px; height: 36px; border-radius: 18px;
  background: var(--accent-primary); color: #fff;
  display: flex; align-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  text { font-size: 13px; color: #fff; font-weight: 600; }
  &.disabled { opacity: 0.3; pointer-events: none; }
  &:active { opacity: 0.8; }
}

.ci-collapse-link {
  padding: 10px 16px;
  text-align: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  border-top: 0.5px solid var(--line-hair);
  &:active { opacity: 0.6; }
}
.ci-collapse-text {
  font-size: 12px;
  color: var(--campus-blue);
  font-weight: 500;
}

/* N13 — X stroke for the picker close button.
   Mirrored from pages/detail/index.vue (.cs-x at L1134-1142) so the
   <view class="cs-x"/> inside .as-close has a definition under plaza's
   scoped <style>. Without this, the X stays unstyled (0×0 inline) and
   only the round container is visible — which was half of the N13 bug
   (the other half being the container's own bg blending with header).

   ONE deliberate deviation from verbatim mirror: stroke color is
   var(--ink-inverse) here, NOT var(--text-secondary) like detail.
   Reason: detail's .rs-close uses bg=--bg-subtle (light) + stroke=
   --text-secondary (dark) — high contrast pair. Plaza's new .as-close
   uses bg=--ink-soft (#57524B in :root, rgba(240,232,214,0.72) in
   data-theme="dark") which collides exactly with --text-secondary
   (same hex/alias in both themes — verified against App.vue token map).
   --ink-inverse inverts cleanly: cream stroke on dark button (light
   mode) or dark stroke on cream button (dark mode), giving a visible
   X regardless of theme. Eric's "verbatim mirror" instruction in the
   N13 spec assumed token values that don't actually hold under the
   spec's own bg=--ink-soft change; this 1-property deviation preserves
   the N13 fix goal (X visibility) while keeping the laps-rotation
   structure verbatim. */
.cs-x {
  width: 12px; height: 12px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0; right: 0;
    height: 1.5px; background: var(--ink-inverse); border-radius: 1px;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}

/* N7-redux D3 — keyboard-aware dock wrapper.
   Lifts .comp-dock + .comp-footer above the soft keyboard via transform
   translateY. GPU-composited (not layout) → smooth animation regardless
   of main-thread work. Triggered by useKeyboardHeight composable;
   transform value bound inline on the .comp-bottom-stack element.
   Duration 0.25s matches typical iOS keyboard rise (~250ms).

   Background MUST be opaque — the wrapper transform-lifts above the
   textarea region while still occupying its flex slot at the bottom
   (transform doesn't relayout). Without an opaque bg, .comp-footer's
   border-top edge, .comp-count text, and inter-button gaps would
   show the textarea content through the lifted wrapper. Using
   var(--bg-elev-1) matches the .composer-fullpage parent bg so the
   lifted wrapper visually fuses with the rest of the composer chrome. */
.comp-bottom-stack {
  background: var(--bg-elev-1);
  transition: transform 0.25s ease-out;
  will-change: transform;
}

@media (min-width: 768px) {
  .page-header { display: none; }
  /* Drop the base 480px centering — the sidebar rail (.has-sidebar in
     App.vue) already reserves the left column via padding-left, so
     centering the whole .page fights the rail. */
  .page { padding-bottom: 0; height: auto; min-height: 100vh; overflow: visible; max-width: none; margin: 0; }
  /* Center the whole single column — search, tabs and feed share one
     640px reading width so the toolbar aligns with the posts. */
  .search-wrap, .feed-tabs, .feed { max-width: 640px; margin-left: auto; margin-right: auto; }
  .feed { padding-bottom: 0; }
}
</style>
