<template>
  <view class="page page-lock has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <AppSidebar current="plaza" />

    <!-- .page-header is display:none at >=768px, and display:none drops the
         node from the accessibility tree — so the heading has to live outside
         it or Mac/iPad get no heading at all. -->
    <text class="sr-only" role="heading" aria-level="1">{{ pageHeading }}</text>

    <!-- #ifdef H5 -->
    <CommunityHeader
      v-model:search="searchText"
      :view="view"
      :board="view === 'board' ? selectedCategory : null"
      :desktop="isDesktop"
      :is-logged-in="isLoggedIn"
      @home="showHome"
      @all="showAll"
      @board="showBoard"
      @compose="openComposer"
      @login="goToLogin"
      @search-input="onSearchInput"
      @search-submit="onSearchSubmit"
      @search-open="openSearch"
    />
    <!-- #endif -->
    <!-- The mini program keeps this header and the list below it: its main
         package has no room for the home yet (BACKLOG 14, row 23). -->
    <!-- #ifndef H5 -->
    <view class="page-header">
      <text class="ph-title">{{ t('plaza.title') }}</text>
      <text class="ph-region" data-test="region-label">{{ regionLabel(lang) }}</text>
      <view v-if="showRegionSwitcher()" class="ph-region-switcher" data-test="region-switcher">
        <text v-for="region in REGIONS" :key="region.slug" class="ph-region-option">{{ lang === 'zh' ? region.zh : region.en }}</text>
      </view>
      <view class="compose-btn" role="button" :aria-label="t('a11y.compose')" @click="openComposer" v-if="isLoggedIn">
        <view class="cb-pen"></view>
        <text class="cb-label">{{ t('plaza.write') }}</text>
      </view>
    </view>
    <!-- #endif -->

    <view v-if="view === 'all'" class="search-wrap">
      <view class="search-bar">
        <view class="sb-icon"></view>
        <input
          v-model="searchText"
          :placeholder="t('plaza.searchPlaceholder')"
          :aria-label="t('plaza.searchPlaceholder')"
          class="sb-input"
          confirm-type="search"
          :focus="searchFocused"
          @input="onSearchInput"
          @confirm="onSearchSubmit"
          @blur="searchFocused = false"
        />
        <view v-if="searchText" class="sb-clear" role="button" :aria-label="t('a11y.searchClear')" @click="clearSearch"></view>
      </view>
    </view>

    <!-- Feed tabs live OUTSIDE the scroll area (directly under search) so
         they stay put while the feed scrolls — 闲鱼/xhs pattern. -->
    <scroll-view v-if="view !== 'home'" class="feed-tabs" scroll-x :show-scrollbar="false">
      <view class="ft-row" role="tablist" :aria-label="t('plaza.title')">
        <view
          v-for="tab in feedTabs"
          :key="tab.key"
          :class="['ft-chip', { active: activeTab === tab.key }]"
          role="tab"
          :tabindex="activeTab === tab.key ? 0 : -1"
          :aria-selected="activeTab === tab.key ? 'true' : 'false'"
          aria-controls="plaza-feed-panel"
          @click="activeTab = tab.key"
          @keydown="onFeedTabKeydown($event, tab.key)"
        >
          <text class="t-tag ft-label">{{ tab.label }}</text>
        </view>
      </view>
    </scroll-view>

    <scroll-view v-if="view === 'all' && activeTab !== 'following'" class="board-filters" scroll-x :show-scrollbar="false">
      <view class="board-row" :aria-label="t('plaza.board')">
        <view v-for="category in [null, ...POST_CATEGORIES]" :key="category || 'all'"
          class="board-chip" :class="{ active: selectedCategory === category }" role="button" tabindex="0"
          :aria-pressed="selectedCategory === category ? 'true' : 'false'"
          @click="selectCategory(category)" @keydown.enter="selectCategory(category)" @keydown.space.prevent="selectCategory(category)">
          <text>{{ category ? t(`plaza.category.${category}`) : t('plaza.allBoards') }}</text>
        </view>
      </view>
    </scroll-view>

    <scroll-view
      v-if="view !== 'home'"
      id="plaza-feed-panel"
      class="feed"
      role="tabpanel"
      scroll-y
      refresher-enabled
      :refresher-triggered="refreshing"
      @refresherrefresh="onRefresh"
      @scrolltolower="loadMore"
    >
      <!-- SPEC 6.2: the banners stay with all discussions; the home and the board pages have none. -->
      <PlazaBannerCarousel v-if="view === 'all'" />

      <template v-if="activeTab === 'following'">
        <view v-if="followLoading && followPeople.length === 0" class="loading">
          <text>{{ t('home.loading') }}...</text>
        </view>

        <view v-if="followError" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
          <UEmptyArt name="following" />
          <text class="empty-text">{{ followError }}</text>
          <view class="cta-btn" role="button" @click="loadFollowing(followPeople.length === 0)">{{ t('home.retry') }}</view>
        </view>

        <view v-if="!followLoading && !followError && followPeople.length === 0" class="empty">
          <UEmptyArt name="following" />
          <text class="empty-text">{{ isLoggedIn ? t('follow.emptyPeople') : t('follow.signInHint') }}</text>
          <view v-if="!isLoggedIn" class="cta-btn" role="button" @click="goToLogin">{{ t('login.signIn') }}</view>
        </view>

        <view v-if="followPeople.length > 0" class="follow-people u-stagger">
          <view
            v-for="p in followPeople"
            :key="p.id"
            class="follow-person u-rise"
            role="button"
            :aria-label="p.nickname || t('app.user')"
            @click="goToFollowSeller(p.id)"
          >
            <UAvatar :src="p.avatar_url" :owner="p.id" :fallback="defaultAvatarSrc" :alt="p.nickname || 'avatar'" class="fp-avatar" lazy />
            <view class="fp-info">
              <view class="fp-name-row">
                <text class="fp-name">{{ p.nickname || t('app.user') }}</text>
                <UBadge v-if="p.is_illini_verified" variant="illini" label="Illini" />
              </view>
              <text v-if="p.status_text" class="fp-status">{{ p.status_emoji ? p.status_emoji + ' ' : '' }}{{ p.status_text }}</text>
              <text v-else-if="p.location" class="fp-status">{{ localizedLocation(p.location) }}</text>
            </view>
            <UIcon name="chevron-right" size="sm" color="text-faint" />
          </view>
        </view>
      </template>

      <view v-else-if="loading && posts.length === 0" class="post-skel-list">
        <view v-for="n in 3" :key="'ps' + n" class="post-skel">
          <view class="ps-head">
            <view class="ps-avatar u-sk"></view>
            <view class="ps-meta">
              <view class="ps-line u-sk" style="width: 38%"></view>
              <view class="ps-line u-sk" style="width: 22%; height: 9px"></view>
            </view>
          </view>
          <view class="ps-line u-sk" style="width: 94%"></view>
          <view class="ps-line u-sk" style="width: 68%"></view>
          <view class="ps-img u-sk"></view>
        </view>
      </view>

      <view v-else class="posts u-stagger" :key="activeTab">
        <template v-for="post in visiblePosts" :key="post.id">
        <!--
          A topic (a post with a title) lists as one row (SPEC 6.3.2). The whole
          row opens the topic; like, share, translate and report are on that
          page. An update has no title and keeps the card below.
        -->
        <view
          v-if="post.title"
          :class="['topic-row', 'u-rise', { 'has-thumb': post.images && post.images.length > 0 }]"
          role="button"
          :aria-label="topicRowLabel(post)"
          @click="goPostDetail(post)"
        >
          <view class="tr-text">
            <text class="tr-title" role="heading" aria-level="2">{{ post.title }}</text>
            <text v-if="post.content" class="tr-excerpt">{{ topicExcerpt(post) }}</text>
          </view>
          <view v-if="post.images && post.images.length > 0" class="tr-thumb" aria-hidden="true">
            <image class="tr-thumb-img" :src="thumbUrl(post.images[0], 'list')" mode="aspectFill" />
            <text v-if="post.images.length > 1" class="tr-thumb-more">+{{ post.images.length - 1 }}</text>
          </view>
          <text v-if="post.post_items && post.post_items.length > 0" class="tr-linked">{{ topicLinkedLine(post) }}</text>
          <view class="tr-meta">
            <template v-if="post.is_pinned">
              <text class="tr-meta-item">{{ t('plaza.pinned') }}</text>
              <text class="tr-meta-item">·</text>
            </template>
            <template v-if="post.category && !selectedCategory">
              <text class="tr-meta-item">{{ t(`plaza.category.${post.category}`) }}</text>
              <text class="tr-meta-item">·</text>
            </template>
            <text class="tr-meta-item tr-author">{{ post.profile?.nickname || t('app.user') }}</text>
            <text v-if="post.is_official" class="tr-tag">{{ t('plaza.official') }}</text>
            <text class="tr-meta-item">·</text>
            <text class="tr-meta-item">{{ formatTime(post.created_at) }}</text>
          </view>
          <text v-if="post.comment_count > 0" class="tr-replies tr-count">{{ post.comment_count }}</text>
          <text v-else-if="topicIsUnanswered(post)" class="tr-replies tr-tag tr-tag-ask">{{ t('plaza.unansweredTag') }}</text>
        </view>
        <view v-else class="post-card u-rise">
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
            role="button"
            :aria-label="t('plaza.tapToExpand')"
            @click="pinnedExpanded.add(post.id)"
          >
            <UIcon name="bookmark" size="sm" color="campus-blue" />
            <view class="pc-body">
              <text class="pc-title">{{ post.profile?.nickname || t('plaza.pinned') }}</text>
              <text class="pc-meta">{{ formatTime(post.created_at) }} · {{ t('plaza.tapToExpand') }}</text>
            </view>
            <UIcon name="chevron-right" size="sm" color="text-faint" />
          </view>
          <view
            v-else
            :class="['post-tappable', { 'pinned-expanded': post.is_pinned && pinnedExpanded.has(post.id) }]"
            :role="post.is_pinned && pinnedExpanded.has(post.id) ? 'group' : 'button'"
            :tabindex="post.is_pinned && pinnedExpanded.has(post.id) ? -1 : undefined"
            :aria-label="postCardLabel(post)"
            :aria-keyshortcuts="post.is_pinned && pinnedExpanded.has(post.id) ? undefined : 'Shift+F10'"
            @click="goPostDetail(post)"
            @keydown="onPostCardKeydown($event, post)"
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
              <UAvatar :src="post.profile?.avatar_url" :owner="post.user_id" :fallback="defaultAvatarSrc" :alt="post.profile?.nickname || 'avatar'" class="pa-avatar" role="button" lazy @click.stop="goSeller(post.user_id)" />
              <view class="pa-info">
                <view class="pa-name-row">
                  <text class="pa-name" role="button" @click.stop="goSeller(post.user_id)">{{ post.profile?.nickname || t('app.user') }}</text>
                  <UBadge v-if="post.is_official" variant="official" :label="t('plaza.official')" />
                  <UBadge v-else-if="post.profile?.is_illini_verified" variant="illini" label="Illini" />
                  <view v-if="post.is_pinned" class="badge-pinned"><text class="badge-pinned-label">{{ t('plaza.pinned') }}</text></view>
                </view>
                <text class="pa-time">{{ formatTime(post.created_at) }}</text>
              </view>
              <view v-if="post.user_id === currentUser?.id" class="post-more hit-target" role="button" :aria-label="t('a11y.more')" @click.stop="onDeletePost(post)">
                <view class="pm-dot"></view><view class="pm-dot"></view><view class="pm-dot"></view>
              </view>
            </view>

            <view class="post-content-wrap">
              <text class="post-content">{{ displayPostContent(post) }}</text>
              <view
                v-if="post.content && post.content.trim().length > 0"
                :class="['pc-translate', 'hit-target', { loading: translatingId === post.id }]"
                role="button"
                :aria-label="t('a11y.translate')"
                @click.stop="togglePostTranslate(post)"
              >
                <text v-if="translatingId !== post.id" class="pc-translate-label">{{ t(displayPostContent(post) !== post.content ? 'detail.showOriginal' : 'detail.showTranslation') }}</text>
                <text v-else class="pc-translate-label">···</text>
              </view>
            </view>

            <view
              v-if="post.images && post.images.length > 0"
              :class="['post-images', `pi-n${Math.min(post.images.length, 4)}`]"
            >
              <!--
                A single-image post reserves its exact aspect ratio from the
                DB-persisted post.image_dimensions (migration 014). Unknown
                slots fall back to 4/5 via dimsToAspectStyle's default; clamp
                [0.4, 2.5] stops freak panoramas from stretching the cell.
                Multi-image posts take the uniform grid slot instead — see
                postTileStyle() and the .pi-n2/3/4 rules.
              -->
              <img
                v-for="(img, i) in post.images"
                :key="i"
                :src="thumbUrl(img, 'card')"
                :alt="t('a11y.previewImage')"
                class="post-image"
                role="button"
                :style="postTileStyle(post, i)"
                loading="lazy"
                lazy-load
                :mode="post.images.length > 1 ? 'aspectFill' : 'aspectFit'"
                @load="onImgLoad($event, post, i)"
                @click.stop="previewImage(post.images, i)"
              />
            </view>
          </view>

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
            <view v-else class="aic-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">集</text></view>
            <view class="aic-body">
              <text class="aic-title">{{ localize(pi.item.title_i18n, pi.item.title) }}</text>
              <text class="aic-price">{{ listingPriceLabel(pi.item, t) }}</text>
              <text v-if="pi.item.status === 'sold'" class="aic-sold">{{ t('status.sold') }}</text>
            </view>
            <UIcon name="chevron-right" size="sm" color="text-faint" />
          </view>

          <view class="post-actions">
            <view class="pa-btn" role="button" :aria-label="post.liked_by_me ? t('a11y.unlike') : t('a11y.like')" :aria-pressed="post.liked_by_me ? 'true' : 'false'" @click.stop="onToggleLike(post)">
              <image
                :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'"
                alt=""
                class="heart-img"
              />
              <text :class="['pa-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
            </view>
            <view class="pa-btn" role="button" :aria-label="t('a11y.comment')" @click.stop="openComments(post)">
              <UIcon name="messages" size="sm" color="text-muted" />
              <text class="pa-num">{{ post.comment_count }}</text>
            </view>
            <view class="pa-btn" role="button" :aria-label="t('a11y.share')" @click.stop="onSharePost(post)">
              <UIcon name="share" size="sm" color="text-muted" />
            </view>
          </view>

        </view>
        </template>
      </view>

      <!--
        Sits after the feed, never in front of it: a failed second page must
        leave the posts the reader already has on screen and offer the retry
        underneath them. With nothing loaded yet this same block is the whole
        screen, which is what an initial failure should look like.
      -->
      <template v-if="activeTab !== 'following'">
        <view v-if="fetchError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
          <UIcon name="shield" size="lg" color="ink-soft" />
          <text class="empty-text">{{ fetchError }}</text>
          <view class="cta-btn" role="button" @click="posts.length ? loadMore(true) : onRefresh()">{{ t('home.retry') }}</view>
        </view>

        <view v-else-if="!loading && visiblePosts.length === 0" class="empty">
          <UEmptyArt name="posts" />
          <text class="empty-text">{{ t('plaza.empty') }}</text>
          <view v-if="isLoggedIn" class="cta-btn" role="button" @click="openComposer">{{ t('plaza.write') }}</view>
        </view>
      </template>

      <view
        v-if="activeTab === 'following' ? (!followHasMore && followPeople.length > 0) : (!hasMore && visiblePosts.length > 0)"
        class="end-tip"
      >
        <text>{{ t('home.endOf') }}</text>
      </view>
    </scroll-view>

    <!-- #ifdef H5 -->
    <scroll-view v-if="view === 'home'" class="home-scroll" scroll-y refresher-enabled
      :refresher-triggered="refreshing" @refresherrefresh="onRefresh">
      <CommunityHome
        :sections="homeSections"
        :ready="!!homeData"
        :failed="homeFailed"
        :desktop="isDesktop"
        :is-logged-in="isLoggedIn"
        @board="showBoard"
        @all="showAll"
        @compose="openComposer"
        @retry="loadHome"
        @login="goToLogin"
      />
    </scroll-view>
    <!-- SPEC 5.3 ⑩: below 1024px the way to start a topic floats above the tab bar. -->
    <view v-if="!isDesktop && !showComposer" class="community-fab" role="button" :aria-label="t('plaza.write')" @click="openComposer">
      <UIcon name="plus" size="md" color="ink-inverse" />
    </view>
    <!-- #endif -->

    <!-- Comment sheet (QA6 #7, r3). HOISTED to the page root (single instance,
         driven by commentingPost) so its position:fixed anchors to the VIEWPORT.
         It used to live inside the v-for .post-card.u-rise; a transformed/animated
         ancestor makes a fixed descendant anchor to IT, not the viewport (iOS
         Safari) — which oversized the sheet (X clipped above, input below). -->
    <view v-if="commentingPost" class="comment-mask u-mask-in" @click.stop="closeComments"></view>
    <view
      v-if="commentingPost"
      ref="commentSheetEl"
      class="comment-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plaza-comments-title"
      tabindex="-1"
      @click.stop
      @keydown="onCommentDialogKeydown"
      :style="[kbLift, viewportSheetStyle]"
    >
      <view class="cmt-header">
        <text id="plaza-comments-title" class="cmt-htitle">{{ t('plaza.commentCount', { count: comments.length }) }}</text>
        <view class="as-close" role="button" tabindex="0" :aria-label="t('a11y.close')" @click.stop="closeComments"><view class="cs-x"></view></view>
      </view>
      <scroll-view class="cmt-scroll" scroll-y>
      <view v-if="loadingComments && comments.length === 0" class="ci-loading">
        <text>{{ t('home.loading') }}</text>
      </view>
      <view v-else-if="commentsError" class="ci-empty ci-error" role="alert" aria-live="assertive">
        <text>{{ t('error.loadFailed') }}</text>
        <view class="ci-retry" role="button" tabindex="0" @click.stop="retryComments">{{ t('home.retry') }}</view>
      </view>
      <view v-else-if="comments.length === 0" class="ci-empty">
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
      <view v-if="!loadingComments && comments.length > 0" class="cmt-end"><text>{{ t('plaza.noMoreComments') }}</text></view>
      </scroll-view>

      <view v-if="replyTo" class="ci-reply-bar">
        <text class="ci-reply-label">{{ t('plaza.replyingTo') }} @{{ replyTo.profile?.nickname || t('app.user') }}</text>
        <view class="ci-reply-x" role="button" :aria-label="t('a11y.close')" @click.stop="replyTo = null"><view class="ci-rx"></view></view>
      </view>

      <view class="ci-input-bar">
        <textarea
          v-model="commentText"
          class="ci-input"
          :placeholder="replyTo ? t('plaza.replyHint') : t('plaza.commentHint')"
          :aria-label="replyTo ? t('plaza.replyHint') : t('plaza.commentHint')"
          confirm-type="send"
          :show-confirm-bar="false"
          auto-height
          :focus="inputFocused"
          :cursor-spacing="0"
          :adjust-position="false"
          @focus="inputFocused = true"
          @blur="inputFocused = false"
          @confirm="onSubmitComment"
          @keydown="onCommentKeydown"
          maxlength="1000"
        />
        <view
          :class="['ci-send', { disabled: !commentText.trim() || commentSubmitting }]"
          role="button"
          :aria-label="t('a11y.sendMessage')"
          :aria-disabled="!commentText.trim() || commentSubmitting ? 'true' : 'false'"
          @click.stop="onSubmitComment"
        >
          <text class="ci-send-label">{{ replyTo ? t('plaza.reply') : t('plaza.comment') }}</text>
        </view>
      </view>
    </view>

    <view v-if="showComposer" class="composer-backdrop"></view>
    <view
      v-if="showComposer"
      ref="composerDialogEl"
      class="composer-fullpage"
      :style="viewportComposerStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plaza-composer-title"
      tabindex="-1"
    >
      <view class="comp-header">
        <text class="comp-cancel" role="button" @click="onComposerCancel">{{ t('plaza.cancel') }}</text>
        <text id="plaza-composer-title" class="comp-title">{{ t('plaza.write') }}</text>
        <text
          :class="['comp-submit', { disabled: submitDisabled }]"
          role="button"
          :aria-disabled="submitDisabled ? 'true' : 'false'"
          @click="onSubmitPost"
        >
          {{ submitting ? t('login.wait') : t('plaza.submit') }}
        </text>
      </view>
      <view class="comp-body">
        <view class="composer-mode" role="group" :aria-label="t('plaza.write')">
          <view v-for="mode in (['topic', 'update'] as const)" :key="mode" class="board-chip"
            :class="{ active: composerMode === mode }" role="button" tabindex="0"
            :aria-pressed="composerMode === mode ? 'true' : 'false'"
            @click="composerMode = mode" @keydown.enter="composerMode = mode" @keydown.space.prevent="composerMode = mode">
            <text>{{ t(mode === 'topic' ? 'plaza.formatTopic' : 'plaza.formatUpdate') }}</text>
          </view>
        </view>
        <view v-if="composerMode === 'topic'" class="composer-topic">
          <text class="topic-board-label">{{ t('plaza.chooseBoard') }}</text>
          <view class="topic-board-options" role="group" :aria-label="t('plaza.chooseBoard')">
            <view v-for="category in POST_CATEGORIES" :key="category" class="board-chip"
              :class="{ active: composerCategory === category }" role="button" tabindex="0"
              :aria-pressed="composerCategory === category ? 'true' : 'false'"
              @click="composerCategory = category" @keydown.enter="composerCategory = category" @keydown.space.prevent="composerCategory = category">
              <text>{{ t(`plaza.category.${category}`) }}</text>
            </view>
          </view>
          <text v-if="composerErrors.board" class="field-error" role="alert">{{ t('plaza.errBoard') }}</text>
          <input v-model="composerTitle" class="topic-title-input" :maxlength="POST_TITLE_MAX" :focus="composerTitleFocused"
            :placeholder="composerCategory ? t(`plaza.titleHint.${composerCategory}`) : t('plaza.titleHintDefault')"
            :aria-label="t('plaza.topicTitle')" @blur="composerTitleFocused = false" />
          <text v-if="composerTitleLeft <= 20" class="title-left">{{ t('plaza.titleLeft', { n: composerTitleLeft }) }}</text>
          <text v-if="composerErrors.title" class="field-error" role="alert">{{ t('plaza.errTitle') }}</text>
        </view>
        <textarea
          v-model="composerText"
          :placeholder="composerBodyHint"
          :aria-label="composerMode === 'topic' ? t('plaza.formatTopic') : t('plaza.postHint')"
          class="comp-textarea"
          :adjust-position="false"
          :auto-height="true"
          :focus="composerFocused"
          maxlength="2000"
        />
        <text v-if="composerMode === 'topic' && composerErrors.body" class="field-error comp-body-error" role="alert">{{ t('plaza.errBody') }}</text>
        <view v-if="composerImages.length > 0" class="comp-images">
          <view v-for="(img, i) in composerImages" :key="i" class="ci-wrap">
            <image :src="img" alt="Photo" class="ci-img" mode="aspectFill" />
            <view class="ci-remove" role="button" :aria-label="t('a11y.delete')" @click="removeComposerImage(i)">
              <view class="ci-x"></view>
            </view>
          </view>
        </view>
      </view>
      <view class="comp-bottom-stack" :style="kbLift">
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
            <text class="ca-price">{{ listingPriceLabel(it, t) }}</text>
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
          <view v-if="composerImages.length < 4" class="comp-add-img" role="button" :aria-label="t('plaza.addPhotos')" @click="onComposerPickImage">
            <UIcon name="image" size="xs" color="text-secondary" />
            <text class="cab-label">{{ t('plaza.addPhotos') }}</text>
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
        <text class="comp-count">{{ 2000 - composerText.length }} {{ tc('plaza.charsLeft', 2000 - composerText.length) }}</text>
      </view>
      </view>
    </view>

    <view v-if="showAttachSheet" class="sheet-mask-over-composer u-mask-in" @click="showAttachSheet = false"></view>
    <view
      v-if="showAttachSheet"
      ref="attachDialogEl"
      class="attach-sheet open"
      :style="viewportSheetStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plaza-attach-title"
      tabindex="-1"
    >
      <view class="as-header">
        <text id="plaza-attach-title" class="as-title">{{ t('plaza.pickItem') }}</text>
        <view class="as-close" role="button" tabindex="0" :aria-label="t('a11y.close')" @click="showAttachSheet = false"><view class="cs-x"></view></view>
      </view>
      <scroll-view class="as-list" scroll-y>
        <view v-if="availableActiveItems.length === 0" class="as-empty">
          <text>{{ t('plaza.noMyItems') }}</text>
        </view>
        <view
          v-for="it in availableActiveItems"
          :key="it.id"
          class="as-item"
          role="button"
          :aria-label="localize(it.title_i18n, it.title)"
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
            <text class="as-price">{{ listingPriceLabel(it, t) }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <CustomTabBar v-if="!showComposer" current="plaza" />
  </view>
</template>

<script setup lang="ts">
import { useDomKeydown } from '../../composables/useDomKeydown'
import { resolveHtmlElement } from '../../utils/domElement'
import { photoPickerErrorKey } from '../../utils/photoPicker'
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { onLoad, onShow, onShareAppMessage, onShareTimeline, onUnload } from '@dcloudio/uni-app'

import { useI18n } from '../../composables/useI18n'
import { authoredLang } from '../../composables/i18n/format'
import { useAuth } from '../../composables/useAuth'
import { useTheme } from '../../composables/useTheme'
import { usePlaza, groupCommentsByParent } from '../../composables/usePlaza'
import { useFollow } from '../../composables/useFollow'
import type { FollowedProfile } from '../../composables/useFollow'
import { useModeration } from '../../composables/useModeration'
import { useItems, type UploadAccountToken, type UploadBatchResult } from '../../composables/useItems'
import { useHistory } from '../../composables/useHistory'
import { useTranslate } from '../../composables/useTranslate'
import { useLongPress } from '../../composables/useLongPress'
import { useKeyboardHeight } from '../../composables/useKeyboardHeight'
import { useVisualViewportBounds } from '../../composables/useVisualViewportInset'
import { localizeLocation } from '../../composables/useCampusSpots'
import { createOwnedLoading } from '../../composables/ownedLoading'
import type { Post, PostComment, Item } from '../../types'
import { POST_CATEGORIES, POST_TITLE_MAX, normalizePostTopic, type PostCategory } from '../../utils/communityPost'
import { REGIONS, regionLabel, showRegionSwitcher } from '../../utils/region'
import { formatTime, formatPrice, compressImage, friendlyErrorMessage, quickTranslate, thumbUrl, listingPriceLabel } from '../../utils'
import { DIALOG_DANGER, DIALOG_WARN } from '../../utils/dialogColors'
import { dimsToAspectStyle, readNaturalDims } from '../../utils/imgStyle'
import type { ImageDim } from '../../types'
import AppSidebar from '../../components/AppSidebar.vue'
import { BASE_URL } from '../../config/runtime'
import CustomTabBar from '../../components/CustomTabBar.vue'
import PlazaBannerCarousel from '../../components/PlazaBannerCarousel.vue'
// #ifdef H5
import CommunityHeader from '../../components/CommunityHeader.vue'
import CommunityHome from '../../components/CommunityHome.vue'
import { useCommunityHome } from '../../composables/useCommunityHome'
import { buildHomeSections, type HomePostData } from '../../utils/communityHome'
// #endif
import UAvatar from '../../components/UAvatar.vue'
import UBadge from '../../components/UBadge.vue'
import UEmptyArt from '../../components/UEmptyArt.vue'
import UIcon from '../../components/UIcon.vue'
import { captureException } from '../../utils/sentry'
import {
  mutationCommitState,
  mutationOutcomeError,
  shouldCompensateMutationFailure,
} from '../../api/mutationCommit'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../../composables/accountScope'

const { t, tc, lang, localize } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, isLoggedIn, requireAuth, awaitAuthReady } = useAuth()
const { posts, loading, hasMore, fetchError, fetchPosts, createPost, updatePostI18n, deletePost, toggleLike, toggleCommentLike, fetchComments, createComment, deleteComment, fetchMyActiveItems, clearPosts } = usePlaza()
const { fetchFollowingProfiles } = useFollow()
const { ensureLoaded: ensureBlockedLoaded, reportTarget } = useModeration()

function localizedLocation(raw: string | null | undefined) {
  return localizeLocation(raw, lang.value as 'en' | 'zh')
}
const kb = useKeyboardHeight()
/*
 * kb.height is a nested Ref in a plain object — Vue templates only unwrap
 * top-level refs, so `${kb.height}` inside an inline template literal
 * stringified the RefImpl to "[object Object]" and the lift style was
 * silently dropped (mp keyboard covered the comment box / composer tools).
 * post/index.vue:268 already used the computed form; mirror it.
 */
const kbLift = computed(() => (kb.height.value ? { transform: `translateY(-${kb.height.value}px)` } : undefined))
const { bottomInset, visibleHeight } = useVisualViewportBounds()
const viewportSheetStyle = computed(() => visibleHeight.value == null ? undefined : ({
  bottom: `${bottomInset.value}px`,
  '--sheet-visible-height': `${visibleHeight.value}px`,
}))
const viewportComposerStyle = computed(() => visibleHeight.value == null ? undefined : ({
  top: 'auto', bottom: `${bottomInset.value}px`, height: `${visibleHeight.value}px`,
  '--composer-visible-height': `${visibleHeight.value}px`,
  '--composer-bottom-inset': `${bottomInset.value}px`,
}))

onShareAppMessage(() => ({
  title: t('share.plaza'),
  path: '/pages/plaza/index',
}))

onShareTimeline(() => ({
  title: t('share.plaza'),
}))

// Release the module-scoped feed on page unload so posts (with images +
// comments) don't outlive the page. Tab pages rarely unload, so this is a
// safety net rather than a hot path.
onUnload(() => {
  clearPosts()
})

const refreshing = ref(false)
const pageIdx = ref(0)
let plazaAccountEpoch = 0
const reportLoading = createOwnedLoading()

/*
 * Feed sub-tabs (v5 kit: 关注 / 热门 / 最新). 热门 and 最新 both show all
 * posts but差 in server sort — 热门 ranks by engagement, 最新 by recency —
 * so switching between them re-fetches. 关注 lists the PEOPLE the current
 * user follows via useFollow.fetchFollowingProfiles (tap → seller page) —
 * not their listings. The prior 推荐/官方 split was replaced to
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
const selectedCategory = ref<PostCategory | null>(null)
const visiblePosts = computed(() => selectedCategory.value
  ? posts.value.filter(post => post.category === selectedCategory.value) : posts.value)
function selectCategory(category: PostCategory | null) {
  selectedCategory.value = category
  pageIdx.value = 0
  fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value, category: category ?? undefined })
}

/*
 * The views of this page (SPEC 4.4): the forum home, one board, or all
 * discussions, which is the flat list this page used to open on. On H5 each has
 * an address that opens it directly. The mini program shows the list only.
 */
type CommunityView = 'home' | 'board' | 'all'
const view = ref<CommunityView>('all')
const pageHeading = computed(() => {
  // #ifdef H5
  if (view.value === 'all') return t('plaza.allDiscussions')
  if (view.value === 'board' && selectedCategory.value) return t(`plaza.category.${selectedCategory.value}`)
  // #endif
  return t('plaza.title')
})

// #ifdef H5
view.value = 'home'
// The home lays out differently from 1024px (SPEC 5.2, 5.3), and holds more rows there.
const desktopMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(min-width: 1024px)') : null
const isDesktop = ref(!!desktopMedia?.matches)
const onDesktopChange = (event: MediaQueryListEvent) => { isDesktop.value = event.matches }
if (typeof desktopMedia?.addEventListener === 'function') {
  desktopMedia.addEventListener('change', onDesktopChange)
  onUnmounted(() => desktopMedia.removeEventListener('change', onDesktopChange))
}

const { homeData, homeFailed, loadHome, clearHome } = useCommunityHome()
const EMPTY_HOME: HomePostData = { candidates: [], weeklyCategories: [], totalDiscussionCount: 0 }
// No event source exists before P4.8, so the events block has nothing to show.
const homeSections = computed(() => buildHomeSections(
  homeData.value?.posts ?? EMPTY_HOME, homeData.value?.items ?? [], [], homeData.value?.now ?? 0,
  isDesktop.value ? 'desktop' : 'phone',
))

// An unknown board or view opens the home (SPEC 4.4).
onLoad((query) => {
  const board = POST_CATEGORIES.find(category => category === query?.board)
  if (board) {
    view.value = 'board'
    selectedCategory.value = board
  } else {
    view.value = query?.view === 'all' ? 'all' : 'home'
  }
})

// Keeps the address on the view being shown, so a reload or a shared link opens the same one.
function syncAddress() {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#/pages/plaza/index')) return
  const query = view.value === 'board' ? `?board=${selectedCategory.value}` : view.value === 'all' ? '?view=all' : ''
  const hash = `#/pages/plaza/index${query}`
  if (window.location.hash !== hash) window.history.replaceState(window.history.state, '', hash)
}

// A topic published from here belongs on the home, so the snapshot is read again once the home is back.
let homeStale = false
function refreshStaleHome() {
  if (view.value !== 'home' || (homeData.value && !homeStale)) return
  homeStale = false
  void loadHome()
}
onShow(() => {
  syncAddress()
  if (homeStale) refreshStaleHome()
})

function showHome() {
  view.value = 'home'
  selectedCategory.value = null
  searchText.value = ''
  syncAddress()
  refreshStaleHome()
}
function showBoard(category: PostCategory) {
  view.value = 'board'
  searchText.value = ''
  selectCategory(category)
  syncAddress()
}
function showAll() {
  if (view.value === 'all') return
  view.value = 'all'
  selectCategory(null)
  syncAddress()
}
// The phone top bar has a search icon, not a field: the field is in all discussions.
function openSearch() {
  showAll()
  searchFocused.value = false
  nextTick(() => { searchFocused.value = true })
}
// #endif

function onFeedTabKeydown(event: KeyboardEvent, current: FeedTabKey) {
  const order: FeedTabKey[] = ['following', 'hot', 'recent']
  let nextIndex = order.indexOf(current)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (nextIndex + 1) % order.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (nextIndex - 1 + order.length) % order.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = order.length - 1
  else return
  event.preventDefault()
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  activeTab.value = order[nextIndex]
  nextTick(() => tabList?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus())
}

/* 关注 tab — the PEOPLE you follow (not their listings). Lazy-loaded the
 * first time the user opens the tab, then paginated via the scroll-view's
 * bottom-reach handler. followLoaded gates the one-shot initial fetch;
 * followLoading guards against concurrent loads. */
const FOLLOW_PAGE_SIZE = 30
const followPeople = ref<FollowedProfile[]>([])
const followLoading = ref(false)
const followHasMore = ref(true)
const followPage = ref(0)
const followLoaded = ref(false)
const followError = ref('')

async function loadFollowing(reset: boolean) {
  if (followLoading.value) return
  await awaitAuthReady()
  const requestEpoch = plazaAccountEpoch
  if (!currentUser.value) {
    followPeople.value = []
    followError.value = ''
    followLoaded.value = true
    return
  }
  const accountToken = captureAccountRequest(currentUser.value.id)
  if (!isAccountRequestCurrent(accountToken)) return
  if (reset) followPage.value = 0
  const requestedPage = reset ? 0 : followPage.value + 1
  followLoading.value = true
  followError.value = ''
  try {
    const rows = await fetchFollowingProfiles(requestedPage, FOLLOW_PAGE_SIZE)
    if (requestEpoch !== plazaAccountEpoch || !isAccountRequestCurrent(accountToken)) return
    if (reset) followPeople.value = rows
    else {
      const seen = new Set(followPeople.value.map(profile => profile.id))
      followPeople.value.push(...rows.filter(profile => !seen.has(profile.id) && !!seen.add(profile.id)))
    }
    followPage.value = requestedPage
    followHasMore.value = rows.length === FOLLOW_PAGE_SIZE
    followLoaded.value = true
  } catch (error: any) {
    if (requestEpoch !== plazaAccountEpoch || !isAccountRequestCurrent(accountToken)) return
    if (reset) followPeople.value = []
    followError.value = friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('error.loadFailed')
    uni.showToast({ title: followError.value, icon: 'none', duration: 2500 })
  } finally {
    if (requestEpoch === plazaAccountEpoch && isAccountRequestCurrent(accountToken)) followLoading.value = false
  }
}

watch(activeTab, (k) => {
  if (k === 'following') {
    if (!followLoaded.value) loadFollowing(true)
  } else {
    // 热门 / 最新 differ only by server sort — re-fetch on switch.
    pageIdx.value = 0
    fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value, category: selectedCategory.value ?? undefined })
  }
})

// The page-local following result is account-scoped. If auth hydrates after
// the tab was opened (or the account changes without destroying this tab),
// invalidate the anonymous/previous-account snapshot and reload in place.
watch(currentUser, (u, prev) => {
  if (u?.id === prev?.id) return
  // A tab page can survive account switches. Never carry A's in-progress
  // composer or comment draft into B's session.
  if (showComposer.value) onComposerCancel()
  if (commentingPost.value || commentText.value) closeComments()
  followLoaded.value = false
  followPeople.value = []
  followError.value = ''
  followPage.value = 0
  followHasMore.value = true
  if (activeTab.value === 'following') void loadFollowing(true)
  else void reloadPlazaForCurrentAccount()
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

/*
 * A multi-image post renders into a fixed grid, and a grid row is as tall as
 * its tallest cell. Giving each tile its own aspect ratio therefore leaves a
 * dead band under every shorter tile in the row — the ragged look reported on
 * 2026-08-06. Multi-image posts drop the per-image ratio and take the uniform
 * square slot from CSS; single-image posts keep their true shape.
 */
function postTileStyle(post: Post, idx: number): Record<string, string> {
  if ((post?.images?.length || 0) > 1) return {}
  return dimsToAspectStyle(effectiveDims(post), idx)
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
const searchFocused = ref(false)
let searchDebounce: ReturnType<typeof setTimeout> | null = null
function runSearch() {
  // #ifdef H5
  // The header field is on every view; a search lists across boards, in all discussions.
  if (view.value !== 'all') {
    if (!searchText.value.trim()) return
    view.value = 'all'
    selectedCategory.value = null
    syncAddress()
  }
  // #endif
  pageIdx.value = 0
  fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value, category: selectedCategory.value ?? undefined })
}
function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(runSearch, 300)
}
function onSearchSubmit() {
  if (searchDebounce) clearTimeout(searchDebounce)
  runSearch()
}
function clearSearch() {
  searchText.value = ''
  pageIdx.value = 0
  fetchPosts({ reset: true, sort: feedSort.value, category: selectedCategory.value ?? undefined })
}

const showComposer = ref(false)
const composerDialogEl = ref<unknown>(null)
useDomKeydown(composerDialogEl, onComposerDialogKeydown)
const composerMode = ref<'update' | 'topic'>('topic')
const composerTitle = ref('')
const composerCategory = ref<PostCategory | null>(null)
const composerTitleFocused = ref(false)
// P2.4 (SPEC 6.5.3): required-field errors sit under their field; no toast.
const composerErrors = ref<{ board?: boolean; title?: boolean; body?: boolean }>({})
const composerTitleLeft = computed(() => POST_TITLE_MAX - Array.from(composerTitle.value).length)
const composerBodyHint = computed(() => composerMode.value !== 'topic'
  ? t('plaza.postHint')
  : composerCategory.value ? t(`plaza.bodyHint.${composerCategory.value}`) : t('plaza.bodyHintDefault'))
const submitDisabled = computed(() => submitting.value || (composerMode.value !== 'topic'
  && !composerText.value.trim() && composerImages.value.length === 0 && composerAttachedItems.value.length === 0))

function focusComposerField(field: 'board' | 'title' | 'body') {
  if (field === 'title') {
    composerTitleFocused.value = false
    nextTick(() => { composerTitleFocused.value = true })
  } else if (field === 'body') {
    composerFocused.value = false
    nextTick(() => { composerFocused.value = true })
  } else {
    // #ifdef H5
    ;(document.querySelector('.topic-board-options .board-chip') as HTMLElement | null)?.focus()
    // #endif
  }
}
const composerText = ref('')
watch(composerCategory, value => { if (value) composerErrors.value.board = false })
watch(composerTitle, value => { if (value.trim()) composerErrors.value.title = false })
watch(composerText, value => { if (value.trim()) composerErrors.value.body = false })
watch(composerMode, () => { composerErrors.value = {} })
const composerImages = ref<string[]>([])
const composerFocused = ref(false)
const submitting = ref(false)
let composerAccountToken: AccountRequestToken | null = null
let composerSessionId = 0

type AttachableItem = NonNullable<Post['post_items']>[number]['item']
const MAX_CHIPS = 3
const composerAttachedItems = ref<AttachableItem[]>([])
const chipCapReached = computed(() => composerAttachedItems.value.length >= MAX_CHIPS)
const showAttachSheet = ref(false)
const attachDialogEl = ref<unknown>(null)
useDomKeydown(attachDialogEl, onAttachDialogKeydown)
const myActiveItems = ref<AttachableItem[]>([])
/* Picker hides items already attached to this composer session, so the
   user can't pick the same item twice (matches the (post_id, item_id)
   composite PK in mig 041's post_items — duplicate would 23505 server-side). */
const availableActiveItems = computed(() =>
  myActiveItems.value.filter(
    it => !composerAttachedItems.value.some(c => c.id === it.id),
  ),
)

let composerDialogOpener: HTMLElement | null = null
let attachDialogOpener: HTMLElement | null = null
let commentDialogOpener: HTMLElement | null = null

function activeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function focusDialog(reference: unknown, preferredSelector?: string) {
  const dialog = resolveHtmlElement(reference)
  if (!dialog || typeof dialog.querySelector !== 'function') return
  const preferred = preferredSelector
    ? dialog.querySelector<HTMLElement>(preferredSelector)
    : null
  const fallback = dialog.querySelector<HTMLElement>(
    '[role="button"]:not([aria-disabled="true"]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  ;(preferred || fallback || dialog).focus()
}

function restoreDialogFocus(opener: HTMLElement | null) {
  if (!opener || typeof opener.focus !== 'function') return
  nextTick(() => opener.focus())
}

function handleDialogKeydown(event: KeyboardEvent, close: () => void) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget as HTMLElement | null
  if (!dialog || typeof dialog.querySelectorAll !== 'function') return
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    '[role="button"]:not([aria-disabled="true"]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(el => el.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const current = activeElement()
  const index = current ? focusable.indexOf(current) : -1
  if (event.shiftKey && (index <= 0)) {
    event.preventDefault()
    focusable[focusable.length - 1].focus()
  } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
    event.preventDefault()
    focusable[0].focus()
  }
}

function onCommentDialogKeydown(event: KeyboardEvent) {
  handleDialogKeydown(event, closeComments)
}

function onComposerDialogKeydown(event: KeyboardEvent) {
  handleDialogKeydown(event, onComposerCancel)
}

function onAttachDialogKeydown(event: KeyboardEvent) {
  handleDialogKeydown(event, () => { showAttachSheet.value = false })
}

watch(showComposer, (open) => {
  if (open) nextTick(() => focusDialog(composerDialogEl.value, 'textarea'))
  else restoreDialogFocus(composerDialogOpener)
})

watch(showAttachSheet, (open) => {
  if (open) nextTick(() => focusDialog(attachDialogEl.value))
  else if (showComposer.value) restoreDialogFocus(attachDialogOpener)
})

async function onOpenAttachSheet() {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  const pickerAccountToken = composerAccountToken
    || captureAccountRequest(currentUser.value.id)
  const pickerEpoch = plazaAccountEpoch
  const pickerSessionId = composerSessionId
  const pickerIsCurrent = () => (
    pickerEpoch === plazaAccountEpoch
    && pickerSessionId === composerSessionId
    && showComposer.value
    && isAccountRequestCurrent(pickerAccountToken)
  )
  if (!pickerIsCurrent()) return
  attachDialogOpener = activeElement()
  showAttachSheet.value = true
  if (myActiveItems.value.length === 0) {
    const rows = await fetchMyActiveItems() as AttachableItem[]
    if (!pickerIsCurrent()) return
    myActiveItems.value = rows
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

function goToFollowSeller(id: string) {
  uni.navigateTo({ url: `/pages/seller/index?id=${id}` })
}

function goToLogin() {
  requireAuth('/pages/plaza/index')
}

/* Post author avatar/name → seller page. Always lands on the default
   商品 tab regardless of entry point (2026-06 meeting decision); the
   ?tab=posts deep-link exists but is intentionally not used here. */
function goSeller(userId: string) {
  uni.navigateTo({ url: `/pages/seller/index?id=${userId}` })
}
const { uploadImagesWithDims, removeOwnedItemImages } = useItems()
const { translateContentToAll } = useTranslate()
const { addPostToHistory } = useHistory()

async function openComposer(board?: unknown) {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  composerDialogOpener = activeElement()
  composerSessionId += 1
  composerAccountToken = captureAccountRequest(currentUser.value.id)
  // N14 layer 3 — baseline reset before show. Defends against any
  // stale composer state surviving from a prior session via a path
  // that bypassed onComposerCancel (tab keep-alive, system back,
  // OAuth roundtrip in keep-alive scenarios). Re-set everything to
  // the empty default so what the user sees on open is always a
  // fresh composer. Focus is intentionally still scheduled inside
  // the existing 300ms setTimeout — focus must fire AFTER the modal
  // becomes visible, not before, so the soft keyboard mounts on the
  // visible textarea (mirroring the previous timing contract).
  composerMode.value = 'topic'
  composerTitle.value = ''
  // Opened from a board (a home card's filler, or the board filter is set): that
  // board is preselected. A click passes its event here, which names no board.
  composerCategory.value = POST_CATEGORIES.find(category => category === board) ?? selectedCategory.value
  composerErrors.value = {}
  composerText.value = ''
  composerImages.value = []
  composerAttachedItems.value = []
  showAttachSheet.value = false
  composerFocused.value = false
  showComposer.value = true
  setTimeout(() => { composerFocused.value = true }, 300)
}

const commentingPost = ref<Post | null>(null)
const commentSheetEl = ref<HTMLElement | null>(null)
const comments = ref<PostComment[]>([])
const loadingComments = ref(false)
const commentsError = ref(false)
const commentText = ref('')
const replyTo = ref<PostComment | null>(null)
const commentSubmitting = ref(false)
let commentSheetEpoch = 0
// Sheet 打开时 input 不应自动 focus（避免键盘挡评论列表）。
// inputFocused 由用户显式动作驱动：tap 输入框 / tap 评论 / tap "回复" / tap 长按菜单"回复"。
// 关闭 sheet / 切评论 reset 回 false，保证下次打开时键盘不会自动起。
const inputFocused = ref(false)

watch(commentingPost, (openPost) => {
  if (openPost) nextTick(() => focusDialog(commentSheetEl.value))
  else restoreDialogFocus(commentDialogOpener)
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

/* ---------- Per-card translation (plaza list)
   translations[post.id] holds the translated content; presence of a
   non-empty string means 'translated', absence means 'show original'.
   Toggle is per-card, so a user can translate one noisy post without
   redrawing the whole feed. Uses the same /api/translate + quickTranslate
   fallback pipeline as the detail page, keyed to the current app lang. */
const translations = reactive<Record<string, string>>({})
const originalPosts = reactive(new Set<string>())
let translationEpoch = 0
function displayPostContent(post: Post) {
  return originalPosts.has(post.id) ? post.content : translations[post.id] || localize(post.content_i18n, post.content)
}
watch(lang, () => {
  translationEpoch += 1
  originalPosts.clear()
  translatingId.value = ''
  for (const id of Object.keys(translations)) delete translations[id]
})
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

function resetPlazaAccountState() {
  translationEpoch += 1
  originalPosts.clear()
  plazaAccountEpoch += 1
  onComposerCancel()
  closeComments()
  myActiveItems.value = []
  searchText.value = ''
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = null
  followPeople.value = []
  followLoading.value = false
  followLoaded.value = false
  followError.value = ''
  followPage.value = 0
  followHasMore.value = true
  refreshing.value = false
  submitting.value = false
  commentSubmitting.value = false
  translatingId.value = ''
  for (const id of Object.keys(translations)) delete translations[id]
  reportLoading.cancel()
  clearPosts()
  // #ifdef H5
  clearHome()
  // #endif
}

const stopAccountTransitionListener = onAccountTransition(resetPlazaAccountState)
onUnmounted(() => {
  reportLoading.cancel()
  stopAccountTransitionListener()
})

async function reloadPlazaForCurrentAccount() {
  const requestEpoch = plazaAccountEpoch
  await awaitAuthReady()
  if (requestEpoch !== plazaAccountEpoch) return

  const userId = currentUser.value?.id
  const accountToken = userId ? captureAccountRequest(userId) : null
  if (accountToken && !isAccountRequestCurrent(accountToken)) return
  // #ifdef H5
  // The home read waits on the same block list itself.
  if (view.value === 'home') {
    await loadHome()
    return
  }
  // #endif
  if (accountToken) {
    const moderationGate = await ensureBlockedLoaded()
    if (
      requestEpoch !== plazaAccountEpoch
      || !isAccountRequestCurrent(accountToken)
    ) return
    if (!moderationGate.ok) {
      clearPosts()
      fetchError.value = friendlyErrorMessage(
        new Error('moderation_gate_unavailable'),
        lang.value as 'en' | 'zh',
      )
      return
    }
  }
  await fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value, category: selectedCategory.value ?? undefined })
}

async function togglePostTranslate(post: Post) {
  if (!post.content) return
  if (displayPostContent(post) !== post.content) {
    originalPosts.add(post.id)
    return
  }
  originalPosts.delete(post.id)
  if (displayPostContent(post) !== post.content) return
  const target = lang.value as 'en' | 'zh'
  const epoch = translationEpoch
  const accountEpoch = plazaAccountEpoch
  const cached = getCached(post.content, target)
  if (cached) { translations[post.id] = cached; return }
  await awaitAuthReady()
  if (epoch !== translationEpoch || accountEpoch !== plazaAccountEpoch || !requireAuth()) return
  translations[post.id] = quickTranslate(post.content, target)
  translatingId.value = post.id
  try {
    const live = await translateText(post.content, target)
    if (epoch === translationEpoch && accountEpoch === plazaAccountEpoch && lang.value === target && live) translations[post.id] = live
  } finally {
    if (epoch === translationEpoch && translatingId.value === post.id) translatingId.value = ''
  }
}

onMounted(() => { void reloadPlazaForCurrentAccount() })

async function onRefresh() {
  if (refreshing.value) return
  // D8: collapse any inline-expanded comments before refreshing posts —
  // the expanded post may not survive the reset (deleted / RLS-hidden / out of new window).
  closeComments()
  refreshing.value = true
  pageIdx.value = 0
  const failsafe = setTimeout(() => { refreshing.value = false }, 10000)
  try {
    // #ifdef H5
    if (view.value === 'home') {
      await loadHome()
      // The last snapshot stays on screen, so a refresh that failed has to say so.
      if (homeFailed.value && homeData.value) uni.showToast({ title: t('plaza.loadFailed'), icon: 'none', duration: 3000 })
      return
    }
    // #endif
    await fetchPosts({ reset: true, sort: feedSort.value, search: searchText.value, category: selectedCategory.value ?? undefined })
  } finally {
    clearTimeout(failsafe)
    refreshing.value = false
  }
}

async function loadMore(retry = false) {
  if (activeTab.value === 'following') {
    if (!followLoading.value && followHasMore.value && !followError.value) {
      await loadFollowing(false)
    }
    return
  }
  if (loading.value || !hasMore.value || (fetchError.value && retry !== true)) return
  const nextPage = pageIdx.value + 1
  const loaded = await fetchPosts({ page: nextPage, sort: feedSort.value, search: searchText.value, category: selectedCategory.value ?? undefined })
  if (loaded) pageIdx.value = nextPage
}

async function onToggleLike(post: Post) {
  await awaitAuthReady()
  if (!requireAuth()) return
  addPostToHistory(post)
  try {
    await toggleLike(post)
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
  }
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

function onComposerCancel() {
  composerSessionId += 1
  composerFocused.value = false
  showComposer.value = false
  composerMode.value = 'topic'
  composerTitle.value = ''
  composerCategory.value = null
  composerErrors.value = {}
  composerText.value = ''
  composerImages.value = []
  composerAttachedItems.value = []
  composerAccountToken = null
  // N14 layer 1 — close any orphan picker sheet so a sheet that was
  // mounted on top of the composer doesn't survive cancel and accept
  // a row tap that would silently mutate the next composer session.
  showAttachSheet.value = false
}

function onComposerPickImage() {
  const pickerSessionId = composerSessionId
  const pickerAccountToken = composerAccountToken
  const pickerIsCurrent = () => !!(
    showComposer.value
    && pickerAccountToken
    && composerAccountToken
    && pickerSessionId === composerSessionId
    && pickerAccountToken.userId === composerAccountToken.userId
    && pickerAccountToken.generation === composerAccountToken.generation
    && isAccountRequestCurrent(pickerAccountToken)
  )
  if (!pickerIsCurrent()) return

  uni.chooseImage({
    count: 4 - composerImages.value.length,
    sizeType: ['original'],
    sourceType: ['album', 'camera'],
    success: async (res: any) => {
      if (!pickerIsCurrent()) return
      const paths: string[] = Array.isArray(res.tempFilePaths)
        ? res.tempFilePaths
        : res.tempFilePaths ? [res.tempFilePaths] : []
      for (const p of paths) {
        if (!pickerIsCurrent() || composerImages.value.length >= 4) return
        try {
          const c = await compressImage(p, { entryPoint: 'plaza' })
          if (!pickerIsCurrent() || composerImages.value.length >= 4) return
          composerImages.value.push(c)
        } catch (err: any) {
          if (!pickerIsCurrent() || composerImages.value.length >= 4) return
          if (err?.heic === true) {
            uni.showToast({ title: t('heic.unsupported'), icon: 'none', duration: 3500 })
            continue
          }
          composerImages.value.push(p)
        }
      }
    },
    fail: (error) => {
      if (!pickerIsCurrent()) return
      const key = photoPickerErrorKey(error)
      if (key) uni.showToast({ title: t(key), icon: 'none', duration: 3500 })
    },
  })
}

function removeComposerImage(idx: number) {
  composerImages.value.splice(idx, 1)
}

/*
 * Solicitation soft gate. /api/moderate can read the copy as an ad for
 * off-platform services (代写, 代购, 办证 …); that is a model's opinion about
 * text the server was willing to accept, so it asks instead of refusing
 * (#290). Sharing contact details is allowed here and never lands a listing
 * in this dialog — a WeChat id is how the meetup gets arranged. A dialog that
 * cannot open resolves true for the same reason: nothing about this screen
 * may cost a member their listing.
 */
function confirmSuspectedAd(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title: t('moderation.adTitle'),
      content: t('moderation.adBody'),
      confirmText: t('moderation.adConfirm'),
      cancelText: t('moderation.adCancel'),
      confirmColor: DIALOG_WARN,
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(true),
    })
  })
}

async function onSubmitPost() {
  await awaitAuthReady()
  if (!requireAuth()) return
  if (composerMode.value === 'topic') {
    const errors = {
      board: !composerCategory.value,
      title: !composerTitle.value.trim(),
      body: !composerText.value.trim(),
    }
    composerErrors.value = errors
    const first = (['board', 'title', 'body'] as const).find(field => errors[field])
    if (first) {
      focusComposerField(first)
      return
    }
  } else if (
    !composerText.value.trim()
    && composerImages.value.length === 0
    && composerAttachedItems.value.length === 0
  ) {
    uni.showToast({ title: t('plaza.needContent'), icon: 'none' })
    return
  }
  if (submitting.value) return
  if (!composerAccountToken || !isAccountRequestCurrent(composerAccountToken)) {
    uni.showToast({ title: t('msg.actionFailed'), icon: 'none' })
    return
  }
  try {
    if (composerMode.value === 'topic') {
      if (!composerTitle.value.trim() || !composerCategory.value) throw new Error('post_topic_required')
      normalizePostTopic(composerTitle.value, composerCategory.value)
    }
  } catch (error) {
    uni.showToast({ title: friendlyErrorMessage(error), icon: 'none' })
    return
  }
  const submitTopic = composerMode.value === 'topic'
    ? normalizePostTopic(composerTitle.value, composerCategory.value) : { title: null, category: null }
  const submitAccountToken = composerAccountToken
  submitting.value = true
  let imageUrls: string[] = []
  let uploadAccountToken: UploadAccountToken | null = null
  let partialUpload: { done: number; total: number } | null = null
  try {
    let imageDims: Array<{ w: number; h: number }> = []
    const expectedImages = composerImages.value.length
    if (expectedImages > 0) {
      let up: UploadBatchResult
      try {
        up = await uploadImagesWithDims(composerImages.value, {
          entryPoint: 'plaza',
          accountToken: submitAccountToken,
        })
      } catch (upErr: any) {
        if (upErr?.heic === true) throw new Error(t('heic.unsupported'))
        throw upErr
      }
      imageUrls = up.urls
      imageDims = up.dims
      uploadAccountToken = up.accountToken
      if (
        up.accountToken.userId !== submitAccountToken.userId
        || up.accountToken.generation !== submitAccountToken.generation
        || !isAccountRequestCurrent(submitAccountToken)
      ) {
        throw mutationOutcomeError(new Error('Account changed during post upload'), 'not_committed')
      }
      if (imageUrls.length === 0) {
        throw new Error(t('plaza.uploadFailed'))
      }
      if (imageUrls.length < expectedImages) {
        // Carried to the terminal message — a warning fired here is replaced
        // by the "posted" toast seconds later. See pages/publish/index.vue.
        partialUpload = { done: imageUrls.length, total: expectedImages }
      }
    }

    const trimmed = composerText.value.trim()
    const sourceLang = authoredLang(trimmed, lang.value)

    const result = await createPost(
      composerText.value,
      imageUrls,
      composerAttachedItems.value.map(c => c.id),
      {
        ...submitTopic,
        image_dimensions: imageDims,
        content_i18n: trimmed ? { [sourceLang]: trimmed } : null,
        source_lang: sourceLang,
        accountToken: submitAccountToken,
        confirmSuspectedAd,
      },
    )

    composerMode.value = 'topic'
    composerTitle.value = ''
    composerCategory.value = null
    composerErrors.value = {}
    composerText.value = ''
    composerImages.value = []
    composerAttachedItems.value = []
    composerSessionId += 1
    composerAccountToken = null
    showComposer.value = false

    if (result.partial === 'items_failed') {
      /* Post row landed but post_items insert failed (RLS reject /
         net blip / cap overflow). The post is intact; the detail page offers
         the author a retry that only links the missing items (P2.7). A failed
         refetch after a successful link is not reported. */
      uni.showToast({ title: t(submitTopic.title ? 'plaza.partialPublish' : 'plaza.partialPublishUpdate'), icon: 'none', duration: 4000 })
    } else {
      if (partialUpload) {
        uni.showToast({ title: t('plaza.postedPartial', partialUpload), icon: 'none', duration: 4000 })
      } else {
        uni.showToast({ title: t('plaza.posted'), icon: 'success' })
      }
    }

    // #ifdef H5
    homeStale = true
    // #endif
    // The current board/search may exclude the new post. Show its committed
    // identity, including partial attachment success, so retry never means a
    // second post. The existing warning toast remains visible on navigation.
    uni.navigateTo({ url: `/pages/post/index?id=${result.id}${result.partial === 'items_failed' ? '&attach=pending' : ''}` })

    // Fire-and-forget bilingual fill. Same strategy as the item publish
    // flow: don't block the toast, best-effort upsert the other locale.
    if (trimmed && result.id) {
      translateContentToAll(trimmed, sourceLang as any)
        .then((map) => {
          if (Object.keys(map).length > 1) updatePostI18n(result.id, map, submitAccountToken)
        })
        .catch(() => console.warn('[plaza] bilingual fill skipped'))
    }
  } catch (err: any) {
    if (imageUrls.length > 0 && uploadAccountToken) {
      if (shouldCompensateMutationFailure(err)) {
        try {
          await removeOwnedItemImages(imageUrls, {
            ownerUserId: uploadAccountToken.userId,
            telemetrySource: 'plaza.create_compensation',
          })
        } catch (cleanupError) {
          captureException(cleanupError, {
            tags: { source: 'plaza.create_compensation', orphan_risk: 'true' },
            level: 'warning',
          })
        }
      } else if (mutationCommitState(err) === 'unknown') {
        // The post may already reference these URLs. Keep them and make the
        // orphan-vs-committed ambiguity observable rather than breaking media.
        captureException(err, {
          tags: { source: 'plaza.create_commit_unknown', orphan_risk: 'true' },
          extra: { objectCount: imageUrls.length },
          level: 'warning',
        })
      }
    }
    if (!isAccountRequestCurrent(submitAccountToken)) return
    // The member pressed Edit on the solicitation confirm. The composer is
    // still open with their text and photos in it.
    if (err?.message === 'ad_declined') return
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    if (isAccountRequestCurrent(submitAccountToken)) submitting.value = false
  }
}

function onDeletePost(post: Post) {
  if (!currentUser.value) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = plazaAccountEpoch
  const actionIsCurrent = () => (
    actionEpoch === plazaAccountEpoch
    && isAccountRequestCurrent(accountToken)
  )
  uni.showActionSheet({
    itemList: [t('plaza.delete')],
    itemColor: DIALOG_DANGER,
    success: (res) => {
      if (res.tapIndex !== 0 || !actionIsCurrent()) return
      uni.showModal({
        title: t('plaza.deleteConfirm'),
        confirmColor: DIALOG_DANGER,
        success: async (r) => {
          if (!r.confirm || !actionIsCurrent()) return
          try {
            await deletePost(post.id)
            if (!actionIsCurrent()) return
            uni.showToast({ title: t('profile.deleted'), icon: 'success' })
          } catch (err: any) {
            if (!actionIsCurrent()) return
            uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('profile.markFail'), icon: 'none' })
          }
        },
      })
    },
  })
}

function previewImage(urls: string[], idx: number) {
  uni.previewImage({ urls, current: urls[idx] })
}

function postCardLabel(post: Post) {
  // Keep the navigation stop brief; the full post remains readable in the
  // card and detail view. Long announcements must not become minute-long
  // button names (or disappear from bounded accessibility snapshots).
  const author = Array.from((post.profile?.nickname || t('app.user')).replace(/\s+/g, ' ').trim()).slice(0, 40).join('')
  const text = (displayPostContent(post) || '').replace(/\s+/g, ' ').trim()
  const characters = Array.from(text)
  const excerpt = characters.slice(0, 100).join('') + (characters.length > 100 ? '…' : '')
  const action = t('plaza.openPostBy', { name: author })
  return excerpt ? `${action}: ${excerpt}` : action
}

/* ---------- Topic rows (SPEC 6.3.2) ---------- */
const TOPIC_EXCERPT_CHARS = 160
const UNANSWERED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function topicExcerpt(post: Post) {
  // The row clamps this to two lines; the rest of a 2,000-character body would
  // only be weight in the list.
  const text = localize(post.content_i18n, post.content).replace(/\s+/g, ' ').trim()
  return Array.from(text).slice(0, TOPIC_EXCERPT_CHARS).join('')
}

// SPEC 5.5, until P3.4: no reply yet and posted within the last 30 days.
function topicIsUnanswered(post: Post) {
  return post.comment_count === 0
    && Date.now() - new Date(post.created_at).getTime() <= UNANSWERED_WINDOW_MS
}

// Names the first linked item only; the topic page shows all of them (SPEC 6.6).
function topicLinkedLine(post: Post) {
  const linked = post.post_items || []
  const first = linked[0]?.item
  if (!first) return ''
  if (first.status === 'deleted') return t('plaza.ref.rowRemoved')
  const status = first.status === 'sold' ? t('plaza.ref.sold')
    : first.status === 'reserved' ? t('plaza.ref.reserved')
    : t('plaza.ref.available')
  const line = t('plaza.ref.row', {
    name: localize(first.title_i18n, first.title),
    // The message carries the "$" itself, so it takes the bare amount.
    price: formatPrice(first.price, '$0').replace(/^\$/, ''),
    status,
  })
  return linked.length > 1
    ? `${line} · ${t('plaza.ref.more', { n: linked.length })}`
    : line
}

// The row is one button, so its name carries what the row shows, minus the excerpt.
function topicRowLabel(post: Post) {
  const author = post.profile?.nickname || t('app.user')
  const parts = post.is_pinned ? [t('plaza.pinned'), post.title || ''] : [post.title || '']
  if (post.category && !selectedCategory.value) parts.push(t(`plaza.category.${post.category}`))
  parts.push(post.is_official ? `${author} ${t('plaza.official')}` : author, formatTime(post.created_at))
  if (post.comment_count > 0) parts.push(t('plaza.commentCount', { count: post.comment_count }))
  else if (topicIsUnanswered(post)) parts.push(t('plaza.unansweredTag'))
  if (post.post_items?.length) parts.push(topicLinkedLine(post))
  return parts.join(' · ')
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
  const preview = (post.title || post.content).slice(0, 60).replace(/\n/g, ' ')
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
  await awaitAuthReady()
  commentSheetEpoch += 1
  commentText.value = ''
  replyTo.value = null
  commentSubmitting.value = false
  expandedReplies.value = new Set()
  commentDialogOpener = activeElement()
  commentingPost.value = post
  inputFocused.value = false
  addPostToHistory(post)
  comments.value = []
  commentsError.value = false
  await loadCommentSheet(post)
}

async function loadCommentSheet(post: Post) {
  const requestEpoch = plazaAccountEpoch
  const sheetEpoch = commentSheetEpoch
  const accountToken = currentUser.value
    ? captureAccountRequest(currentUser.value.id)
    : null
  loadingComments.value = true
  commentsError.value = false
  try {
    const rows = await fetchComments(post.id)
    if (
      requestEpoch !== plazaAccountEpoch
      || sheetEpoch !== commentSheetEpoch
      || commentingPost.value?.id !== post.id
      || (accountToken && !isAccountRequestCurrent(accountToken))
    ) return
    comments.value = rows
    commentsError.value = false
  } catch {
    if (
      requestEpoch === plazaAccountEpoch
      && sheetEpoch === commentSheetEpoch
      && commentingPost.value?.id === post.id
      && (!accountToken || isAccountRequestCurrent(accountToken))
    ) {
      comments.value = []
      commentsError.value = true
    }
  } finally {
    if (
      requestEpoch === plazaAccountEpoch
      && sheetEpoch === commentSheetEpoch
      && commentingPost.value?.id === post.id
      && (!accountToken || isAccountRequestCurrent(accountToken))
    ) loadingComments.value = false
  }
}

function retryComments() {
  const post = commentingPost.value
  if (!post || loadingComments.value) return
  void loadCommentSheet(post)
}

function closeComments() {
  commentSheetEpoch += 1
  commentSubmitting.value = false
  commentingPost.value = null
  comments.value = []
  loadingComments.value = false
  commentsError.value = false
  commentText.value = ''
  replyTo.value = null
  inputFocused.value = false
  expandedReplies.value = new Set()
}

function onCommentKeydown(e: KeyboardEvent) {
  if (!e) return
  // Same IME guard as ChatThread.onComposerKeydown: Enter that confirms a
  // pinyin candidate fires keydown with isComposing (legacy keyCode 229) —
  // sending there would post a half-composed comment.
  if (e.isComposing || (e as any).keyCode === 229) return
  if (e.key !== 'Enter') return
  if (e.shiftKey || e.ctrlKey || e.metaKey) return
  if (typeof e.preventDefault === 'function') e.preventDefault()
  onSubmitComment()
}

async function onSubmitComment() {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  if (!commentText.value.trim() || !commentingPost.value) return
  if (commentSubmitting.value) return
  commentSubmitting.value = true

  const me = currentUser.value
  const commentAccountToken = captureAccountRequest(me.id)
  const postId = commentingPost.value.id
  const sheetEpoch = commentSheetEpoch
  const reply = replyTo.value
  const rawText = commentText.value
  let text = rawText
  if (reply) {
    const name = reply.profile?.nickname || t('app.user')
    text = `@${name} ${rawText}`
  }
  // 单层缩进语义：parent 永远指向顶层祖先。若 replyTo 是子评论，跳一级；
  // 否则就是它自己。groupCommentsByParent 渲染时也会做 walk-up 防御。
  const parentId = reply
    ? (reply.parent_comment_id ?? reply.id)
    : undefined
  const replyName = reply ? (reply.profile?.nickname ?? null) : null

  // QA7-r2 #2: optimistic — show the comment instantly. createComment awaits
  // local + AI (OpenAI) moderation + the insert (~1s), which felt as laggy as
  // chat did before its optimistic-send fix. Push a temp row now, reconcile to
  // the real row on success, or remove it + restore the draft on failure. No
  // realtime echo for comments (the list is fetched on open + pushed here), so
  // unlike chat there's no echo to dedupe.
  const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  comments.value.push({
    id: tempId,
    post_id: postId,
    user_id: me?.id ?? '',
    content: text,
    parent_comment_id: parentId ?? null,
    like_count: 0,
    created_at: new Date().toISOString(),
    profile: me ?? undefined,
    reply_to_name: replyName,
    liked_by_me: false,
  })
  commentText.value = ''
  replyTo.value = null

  try {
    const c = await createComment(postId, text, parentId)
    if (!isAccountRequestCurrent(commentAccountToken)) return
    if (sheetEpoch !== commentSheetEpoch) return
    // fetchComments hydrates reply_to_name from DB on next refresh; mirror it
    // here from the replyTo we captured before clearing.
    c.reply_to_name = replyName
    const i = comments.value.findIndex(x => x.id === tempId)
    if (i !== -1) comments.value.splice(i, 1, c)
    else comments.value.push(c)
    uni.showToast({ title: t('plaza.commented'), icon: 'success' })
  } catch (err: any) {
    if (!isAccountRequestCurrent(commentAccountToken)) return
    if (sheetEpoch !== commentSheetEpoch) return
    const i = comments.value.findIndex(x => x.id === tempId)
    if (i !== -1) comments.value.splice(i, 1)
    // Restore only an untouched composer. A newer draft/reply belongs to the
    // user and must never be replaced by a failed earlier submission.
    if (!commentText.value && !replyTo.value) {
      commentText.value = rawText
      replyTo.value = reply
    }
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    if (isAccountRequestCurrent(commentAccountToken) && sheetEpoch === commentSheetEpoch) commentSubmitting.value = false
  }
}

// Reply is an explicit action instead of overloading the avatar/body click.
// This keeps comment reading and keyboard action semantics unambiguous.
async function onCommentTap(c: PostComment) {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
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

function onPostCardKeydown(event: KeyboardEvent, post: Post) {
  if (event.currentTarget !== event.target) return
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  event.stopPropagation()
  void onPostLongPress(post)
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
  const actionEpoch = plazaAccountEpoch
  const actionPostId = commentingPost.value?.id || ''
  const actionIsCurrent = () => (
    actionEpoch === plazaAccountEpoch
    && isAccountRequestCurrent(accountToken)
    && commentingPost.value?.id === actionPostId
  )
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
      if (!actionIsCurrent()) return
      if (res.tapIndex === 0) {
        replyTo.value = c
        inputFocused.value = true
      } else if (isMine && res.tapIndex === 1) {
        uni.showModal({
          title: t('plaza.commentDeleteConfirm'),
          confirmColor: DIALOG_DANGER,
          success: async (r) => {
            if (!r.confirm || !actionIsCurrent()) return
            try {
              await deleteComment(c.id, actionPostId)
              if (!actionIsCurrent()) return
              comments.value = comments.value.filter(x => x.id !== c.id)
            } catch (err: any) {
              if (!actionIsCurrent()) return
              uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('msg.actionFailed'), icon: 'none' })
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

async function onPostLongPress(post: any) {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  if (post.user_id === currentUser.value.id) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = plazaAccountEpoch
  uni.showActionSheet({
    itemList: [t('report.reportPost'), t('report.reportUser')],
    success: (res) => {
      if (actionEpoch !== plazaAccountEpoch || !isAccountRequestCurrent(accountToken)) return
      if (res.tapIndex === 0) promptReport('post', post.id)
      else if (res.tapIndex === 1) promptReport('user', post.user_id)
    },
  })
}

function promptReport(targetType: 'post' | 'user' | 'item' | 'comment', targetId: string) {
  if (!currentUser.value) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = plazaAccountEpoch
  const actionIsCurrent = () => actionEpoch === plazaAccountEpoch && isAccountRequestCurrent(accountToken)
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
  padding-top: calc(11px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  /* #ifdef MP-WEIXIN */
  /* keep the compose button out from under the native capsule */
  padding-right: var(--mp-navbar-right-pad, 0px);
  /* #endif */
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
/* #ifdef H5 */
[data-theme="dark"] .ph-title { color: var(--ink-strong); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .ph-title { color: var(--ink-strong); }
}
/* #endif */
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
  padding-bottom: calc(70px + env(safe-area-inset-bottom, 0px));
}

.loading, .empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 16px; gap: 12px; color: var(--text-subtle); font-size: 14px;
}
.empty-text { font-size: 14px; color: var(--text-muted); }
.cta-btn {
  margin-top: 8px; padding: 10px 28px;
  background: var(--accent-primary); color: var(--ink-inverse); border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.85; }
}

/* 关注 tab — 2-col grid of followed sellers' active listings (item
   cards, visually distinct from the post-cards in 推荐/官方). Tokenized
   to ivory_academy v5 — surface card on warm border, terracotta price. */
.follow-people { padding: 4px 0; }
.follow-person {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; cursor: pointer;
  border-bottom: 0.5px solid var(--line-hair);
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--bg-subtle); }
}
.fp-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
}
.fp-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.fp-name-row { display: flex; align-items: center; gap: 6px; }
.fp-name {
  font-size: 15px; font-weight: 600; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fp-status {
  font-size: 12px; color: var(--ink-quiet);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.posts { padding: 8px 0 20px; }
.post-skel {
  background: var(--bg-elev-1); padding: 14px 16px;
  border-bottom: 0.5px solid var(--line-hair);
  display: flex; flex-direction: column; gap: 10px;
}
.ps-head { display: flex; align-items: center; gap: 10px; }
.ps-avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; }
.ps-meta { flex: 1; display: flex; flex-direction: column; gap: 7px; }
.ps-line { height: 11px; }
.ps-img { height: 168px; border-radius: 12px; margin-top: 2px; }

/*
 * Topic row (SPEC 6.3.2): a forum row, not a card. On phones the title and
 * excerpt sit beside the first image, and the linked item and the meta line run
 * full width below it, so reply counts line up at the right edge of every row.
 * From 1024px (H5 block below) the excerpt and the meta line share one line.
 * The whole row is the only tap target.
 */
.topic-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--line-hair);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--surface-alt); }
}
.tr-text {
  grid-column: 1 / -1;
  min-width: 0;
  display: flex; flex-direction: column; gap: var(--space-1);
}
.has-thumb .tr-text { grid-column: 1; align-self: start; }
.tr-title, .tr-excerpt {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  overflow: hidden; overflow-wrap: anywhere;
}
.tr-title { font-size: var(--t-h3); line-height: var(--lh-h3); font-weight: 600; color: var(--ink); }
.tr-excerpt { font-size: 14px; line-height: var(--lh-caption); color: var(--ink-soft); }
.tr-thumb {
  grid-column: 2; grid-row: 1; align-self: start;
  position: relative; width: 72px; height: 72px;
  border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-alt);
}
.tr-thumb-img { display: block; width: 100%; height: 100%; }
.tr-linked {
  grid-column: 1 / -1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tr-linked, .tr-meta-item { font-size: var(--t-caption); line-height: var(--lh-caption); color: var(--ink-quiet); }
.tr-meta {
  grid-column: 1;
  min-width: 0; min-height: var(--space-5);
  display: flex; align-items: center; gap: var(--space-1);
}
/* On the item itself: uni-h5's own text rule would beat an inherited nowrap. */
.tr-meta-item { flex: none; white-space: nowrap; }
/* A long nickname gives way first, so the time stays readable. */
.tr-author { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.tr-tag {
  flex: none; padding: 0 var(--space-2); border-radius: var(--radius-xs);
  font-size: var(--t-meta); line-height: var(--space-5); font-weight: 500; white-space: nowrap;
  color: var(--ink); background: var(--surface-alt); box-shadow: inset 0 0 0 1px var(--line-bold);
}
.tr-tag-ask { color: var(--warning-text); background: var(--warning-soft); box-shadow: none; }
.tr-replies { grid-column: 2; justify-self: end; }
.tr-count {
  font-size: var(--t-body); line-height: var(--space-5); font-weight: 500;
  color: var(--ink-soft); font-variant-numeric: tabular-nums;
}
.tr-thumb-more {
  position: absolute; right: var(--space-1); bottom: var(--space-1);
  padding: 0 var(--space-1); border-radius: var(--radius-xs);
  font-size: var(--t-meta); line-height: var(--lh-meta); font-weight: 500;
  color: var(--ink-soft); background: var(--surface); font-variant-numeric: tabular-nums;
}

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
.post-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.pa-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
}
.pa-info { flex: 1; min-width: 0; }
.pa-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pa-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.pa-time { font-size: 11px; color: var(--text-subtle); margin-top: 2px; display: block; }
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
  background: var(--warning-soft); color: var(--warning-text);
  padding: 1px 6px; border-radius: 4px;
  .badge-pinned-label { font-size: 10px; font-weight: 600; color: var(--warning-text); letter-spacing: 0.02em; }
}

.post-content-wrap { display: flex; flex-direction: column; align-items: flex-start; }
.post-content {
  font-size: 15px; color: var(--text-primary); line-height: 1.5;
  white-space: pre-wrap; word-break: break-word; display: block;
}
.pc-translate {
  min-width: 80px; min-height: 44px; border-radius: 12px;
  background: var(--bg-subtle); padding: 0 12px; margin-top: 8px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  .pc-translate-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
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
 * Uniform tile for every multi-image grid. `cover` is correct HERE and only
 * here: the tile is one cell of a fixed grid, so `contain` cannot avoid
 * cropping — it just moves the loss from the photo to a dead letterbox band,
 * and the band is what made rows look broken. Tapping opens the full-size
 * preview, so nothing is unreachable. The single-image branch (.pi-n1) still
 * uses `contain` with the real aspect ratio.
 */
.post-images.pi-n2 .post-image,
.post-images.pi-n3 .post-image,
.post-images.pi-n4 .post-image {
  aspect-ratio: 1 / 1;
  object-fit: cover;
}
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

.end-tip { text-align: center; padding: 24px; font-size: 12px; color: var(--text-subtle); }

.composer-fullpage {
  position: fixed; inset: 0; z-index: 1100;
  background: var(--bg-elev-1);
  display: flex; flex-direction: column;
  max-width: 480px; margin: 0 auto;
  padding-top: env(safe-area-inset-top, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
  box-sizing: border-box;
  animation: composer-enter 160ms ease-out;
}
@keyframes composer-enter {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.comp-body {
  flex: 1; min-height: 0; overflow-y: auto;
}
.comp-header {
  flex-shrink: 0;
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
  /* Override uni's default `uni-textarea { word-break: break-all }`. */
  word-break: normal; overflow-wrap: break-word;
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
.comp-tools { display: flex; gap: 8px; flex-wrap: wrap; }
.comp-footer { gap: 8px; flex-wrap: wrap; }
.comp-count { margin-left: auto; }
.composer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.38); z-index: 1099; }
.comp-add-img {
  min-height: 36px; padding: 0 10px; gap: 6px; border-radius: 8px;
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
.comp-count { font-size: 12px; color: var(--text-subtle); }

.comp-attach-btn {
  min-height: 36px; box-sizing: border-box;
  display: flex; align-items: center; gap: 6px;
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

/*
 * Aligns with the post body, not the avatar. The old `0 14px 0 54px` indented
 * this card past the avatar column, but the text and the image grid above it
 * are NOT indented — they start at the card's own 16px padding — so the item
 * card sat alone, pushed 54px in on the left and 14px short on the right.
 * Zero side margin puts it in the same column as everything above it, which
 * is what the post-detail copy at pages/post/index.vue already does.
 */
.attached-item-card {
  margin: 10px 0 0 0;
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

/* Attach-item picker opens ON TOP of the compose-fullpage (z-index 1100).
   Its mask + sheet must sit above 1100 so users see it without closing
   the composer first. Bumped to 1200 range.

   The mask used to carry `.sheet-mask` as well, but that class is declared only
   inside detail/ and saved-searches/ <style scoped>, so here it resolved to
   nothing: the element was position:static (which makes a z-index inert),
   transparent, and 390x0. Measured with the picker open — elementFromPoint at
   the top of the screen returned the composer's textarea, and tapping outside
   the sheet did not close it, because the mask's @click never got the tap. The
   sheet is aria-modal="true", so assistive tech was told the page behind it was
   inert while it was fully reachable. The borrowed class name is gone and the
   properties live here, the way every other page owns its own mask. */
.sheet-mask-over-composer {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 1200;
}
.attach-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1201;
  max-height: 70vh; background: var(--bg-elev-1); border-radius: 20px 20px 0 0;
  max-height: min(70vh, max(0px, calc(var(--sheet-visible-height, 100vh) - 16px)));
  transform: translateY(100%); transition: transform var(--dur-3) var(--ease-warm);
  display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  &.open { transform: none; }
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
.cs-time { font-size: 11px; color: var(--text-subtle); }
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

/* A bounded scroll list between the pinned header and reply controls.
   H5 uses VisualViewport bounds; mini programs retain their native lift. */
.comment-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 1100;
}
.comment-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1101;
  max-width: 560px; margin: 0 auto;
  /* DEFINITE height (not just max-height): the uni <scroll-view> below carries
     height:100% (uni's own rule), which only resolves against a parent with a
     definite height. With max-height alone the list couldn't bound itself, so
     it grew to full content height and the reply composer overlapped the last
     comment (and ate its taps). The visible-height bound also handles a
     keyboard which only resizes the visual viewport. Mirrors the reconsent
     page, whose scroll-view scrolls correctly under a definite-height ancestor.
     overflow:hidden clips to the rounded top + backstops the flex bound. */
  height: 75vh; height: 75dvh; box-sizing: border-box; background: var(--bg-elev-1);
  height: min(75dvh, max(0px, calc(var(--sheet-visible-height, 100dvh) - 16px)));
  border-radius: 20px 20px 0 0;
  display: flex; flex-direction: column;
  transition: transform 0.25s ease-out; will-change: transform;
  padding-bottom: env(safe-area-inset-bottom);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}
.cmt-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--line-hair);
  flex-shrink: 0;
}
.cmt-htitle { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.cmt-scroll { flex: 1; min-height: 0; }
.cmt-end { text-align: center; color: var(--text-subtle); font-size: 12px; padding: 16px 0 18px; }
.ci-loading,
.ci-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-subtle);
  font-size: 13px;
}
.ci-error { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ci-retry {
  min-height: 44px; padding: 0 18px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent-action); color: var(--ink-inverse); font-weight: 650;
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
  /* flex-end: send button stays anchored to the bottom row while the
     textarea grows (WeChat-style). */
  display: flex; gap: 8px; align-items: flex-end;
  padding: 8px 16px;
  background: var(--bg-elev-1);
  border-top: 0.5px solid var(--line-hair);
}
.ci-input {
  flex: 1; min-height: 36px;
  /* Grow up to 4 lines (20px × 4 + 16px padding) then scroll internally.
     word-break override: uni ships `uni-textarea { word-break: break-all }`
     which splits English words mid-word; inner textarea inherits. */
  max-height: 96px; overflow-y: auto;
  background: var(--bg-subtle); border-radius: 18px; box-sizing: border-box;
  padding: 8px 14px; line-height: 20px; font-size: 14px; color: var(--text-primary);
  word-break: normal; overflow-wrap: break-word;
}
.ci-send {
  padding: 0 14px; height: 36px; border-radius: 18px;
  background: var(--accent-primary); color: var(--ink-inverse);
  display: flex; align-items: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  .ci-send-label { font-size: 13px; color: var(--ink-inverse); font-weight: 600; }
  &.disabled { opacity: 0.3; pointer-events: none; }
  &:active { opacity: 0.8; }
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

/* H5 keeps this dock inside the resized composer; mini programs lift it
   using their native keyboard event. Keep its flex slot and fill opaque. */
.comp-bottom-stack {
  flex-shrink: 0;
  background: var(--bg-elev-1);
  transition: transform 0.25s ease-out;
  will-change: transform;
}

/* #ifdef H5 */
/* uni's auto-height wrapper otherwise exposes only a 24px editing target
   inside a large empty panel. Keep a real clickable writing area while still
   allowing long drafts to grow and scroll with their attached images. */
.comp-textarea { min-height: 232px; }
.comp-textarea :deep(.uni-textarea-wrapper) { min-height: 200px; }
@media (min-width: 768px) {
  .page-header { display: none; }
  /* Drop the base 480px centering — the sidebar rail (.has-sidebar in
     App.vue) already reserves the left column via padding-left, so
     centering the whole .page fights the rail. */
  /* Keep the page viewport-locked on desktop so only the .feed scroll-view
     scrolls — chrome (toolbar + tabs) stays pinned, matching the home feed.
     (#8: this block used to opt out with height:auto/overflow:visible, which
     let the whole document scroll.) */
  .page { padding-bottom: 0; height: 100dvh; overflow: hidden; max-width: none; margin: 0; }
  /* Center the whole single column — search, tabs and feed share one
     640px reading width so the toolbar aligns with the posts. */
  .search-wrap, .feed-tabs, .board-filters, .feed { max-width: 640px; margin-left: auto; margin-right: auto; }
  .feed { padding-bottom: 0; }
  /* SPEC 6.3.2: on desktop the list sits in one surface container. */
  .posts {
    margin: var(--space-2) 0 var(--space-5); padding: 0;
    border: 1px solid var(--line-soft); border-radius: var(--radius-sm);
    background: var(--surface); overflow: hidden;
  }
  .topic-row:last-child, .post-card:last-child { border-bottom: 0; }
}
@media (min-width: 1024px) {
  /* SPEC 6.3.2 desktop: a one-line title; the excerpt, the meta line (240px)
     and the reply count share the second line; the first image is centred at
     the right. display: contents lets the title and excerpt join this grid. */
  /* The meta column is 240px so rows line up; a longer line (pinned, official)
     widens its own row's column, up to 60%, before the author is cut. */
  .topic-row { grid-template-columns: minmax(0, 1fr) fit-content(60%) auto; align-content: center; row-gap: 0; }
  .tr-meta { min-width: 240px; }
  .tr-text { display: contents; }
  .tr-title, .tr-excerpt { -webkit-line-clamp: 1; }
  .tr-title { grid-column: 1 / -1; grid-row: 1; }
  .tr-excerpt { grid-column: 1; grid-row: 2; }
  .tr-meta { grid-column: 2; grid-row: 2; }
  .tr-replies { grid-column: 3; grid-row: 2; }
  .tr-linked { grid-column: 1 / -1; grid-row: 3; }
  .topic-row.has-thumb {
    position: relative;
    min-height: calc(72px + 2 * var(--space-3));
    padding-right: calc(var(--space-4) + 72px + var(--space-3));
  }
  .has-thumb .tr-thumb {
    position: absolute; grid-column: auto; grid-row: auto;
    top: 50%; right: var(--space-4); transform: translateY(-50%);
  }
}
/* The row is full-bleed, so draw the focus ring inside it. */
.topic-row:focus-visible { outline-offset: -2px; }
/* #endif */
/* #ifdef H5 */
@media (min-width: 768px) {
  .composer-fullpage {
    top: auto !important; left: 24px; right: 24px;
    bottom: calc(var(--composer-bottom-inset, 0px) + max(24px, (var(--composer-visible-height, 100dvh) - 680px) / 2)) !important;
    width: calc(100% - 48px); max-width: 800px;
    height: min(680px, calc(var(--composer-visible-height, 100dvh) - 48px)) !important;
    margin: 0 auto; border-radius: 20px; overflow: hidden;
    box-shadow: 0 24px 80px rgba(0,0,0,.25);
  }
  .comp-header { padding: 18px 24px; }
  .comp-textarea { padding: 24px; min-height: 248px; }
  .comp-images { padding-left: 24px; padding-right: 24px; }
  .comp-footer { padding: 14px 24px; }
}
/* #endif */
.board-filters { flex-shrink: 0; width: 100%; height: 52px; }
.board-row { display: flex; gap: 8px; padding: 8px 16px; width: max-content; }
.board-chip { flex-shrink: 0; padding: 8px 12px; border-radius: 16px; background: var(--bg-subtle); color: var(--text-muted); font-size: 13px; cursor: pointer; }
.board-chip.active { color: var(--accent-action); background: var(--bg-elev-1); box-shadow: inset 0 0 0 1px var(--accent-action); }
.board-chip:focus-visible { outline: 2px solid var(--accent-action); outline-offset: 2px; }
.composer-mode { display: flex; gap: 8px; padding: 12px 16px 4px; }
.composer-topic { padding: 12px 16px 0; }
.ph-region { margin-left: 8px; font-size: 13px; color: var(--ink-soft); }
.ph-region-switcher { display: flex; gap: 8px; margin-left: 8px; }
.ph-region-option { font-size: 13px; color: var(--ink-soft); }
.topic-title-input { width: 100%; height: 44px; font-size: 18px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--line-hair); }
.topic-board-label { display: block; color: var(--text-muted); font-size: 12px; margin: 12px 0 8px; }
.topic-board-options { display: flex; gap: 8px; flex-wrap: wrap; }
.composer-topic .topic-title-input { margin-top: 12px; }
.field-error { display: block; margin-top: 6px; font-size: 13px; color: var(--danger); }
.comp-body-error { padding: 0 16px; }
.title-left { display: block; margin-top: 6px; font-size: 12px; color: var(--text-secondary); }

/* #ifdef H5 */
.home-scroll { flex: 1; min-height: 0; }
/* 52px round, 16px above the 62px tab bar (SPEC 5.3 ⑩). */
.community-fab {
  position: fixed; right: var(--space-4); z-index: 30;
  bottom: calc(62px + var(--space-4) + env(safe-area-inset-bottom, 0px));
  width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--brand); box-shadow: var(--shadow-pop); cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { background: var(--brand-deep); }
}
@media (min-width: 768px) {
  /* No tab bar from here up. */
  .community-fab { right: var(--space-6); bottom: var(--space-6); }
}
@media (min-width: 1024px) {
  /* SPEC 4.3: the community page has its own 56px header and no left rail;
     that header holds the search field. */
  .page.has-sidebar { padding-left: 0; }
  .page :deep(.app-sidebar) { display: none; }
  .search-wrap { display: none; }
}
/* #endif */
</style>
