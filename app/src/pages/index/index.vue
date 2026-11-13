<template>
  <view class="page page-lock has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <text class="sr-only" role="heading" aria-level="1">{{ t('nav.home') }}</text>
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <AppSidebar current="index" />

    <view class="mobile-header u-glass u-glass--hair-b">
      <!--
        v5 brand chrome (kit ui_kits/marketplace Chrome). The serif word-
        mark gets a terracotta 集-mark + mono ILLINI MARKET eyebrow, and
        the quick theme + 中/EN toggles return to the top-right (Eric's v5
        design re-adds them after the prior Settings-only stint). Compact
        pills, so the header stays calm.
      -->
      <view class="mh-row">
        <view class="mh-brand">
          <image class="mh-logo" :src="logoSrc" mode="aspectFit" :alt="t('app.name')" />
          <view class="mh-wordmark-stack">
            <text class="mh-wordmark">{{ t('app.name') }}</text>
            <text class="mh-eyebrow">{{ brandEyebrow }}</text>
          </view>
        </view>
        <view class="mh-actions">
          <!-- #ifdef H5 -->
          <!-- Home-page quick theme toggle is H5-only (Eric's call). mp still
               has the auto+manual appearance picker in Settings; it just
               doesn't get this header shortcut. -->
          <view
            class="mh-theme u-press"
            role="button"
            :aria-label="isDark ? t('a11y.themeLight') : t('a11y.themeDark')"
            @click="toggleTheme"
          >
            <UIcon :name="isDark ? 'moon' : 'sun'" size="xs" color="ink-soft" />
            <text class="mh-theme-label">{{ themeLabel }}</text>
          </view>
          <!-- #endif -->
          <view class="mh-lang u-press" role="button" :aria-label="t('a11y.langToggle')" @click="toggleLang">
            <text :class="['mh-lang-label', { on: lang === 'zh' }]">中</text>
            <text class="mh-lang-label sep">|</text>
            <text :class="['mh-lang-label', { on: lang === 'en' }]">EN</text>
          </view>
        </view>
      </view>
      <view class="mh-search">
        <!--
          Search affordance — tapping anywhere on the 'input' navigates
          to the dedicated search page (per refinement-pass: recent
          searches live there, not as a floating dropdown here). Renders
          the typed query (if any) as a static label so the user sees
          what they last searched; the live edit happens on the search
          page with a focused input.
        -->
        <view class="search-field search-proxy" @click="goToSearch" role="button" :aria-label="t('a11y.search')">
          <UIcon name="search" size="xs" color="ink-faint" />
          <text v-if="searchText" class="sf-text">{{ searchText }}</text>
          <text v-else class="sf-placeholder">{{ t('home.search') }}</text>
          <view v-if="searchText" class="sf-clear hit-target" role="button" :aria-label="t('a11y.searchClear')" @click.stop="onClearSearch"><UIcon name="close" size="xs" color="currentColor" aria-hidden="true" /></view>
        </view>
        <view class="filter-btn" role="button" :aria-label="t('a11y.filter')" @click.stop="openFilterSheet">
          <UIcon name="filter" size="xs" color="text-secondary" />
          <text class="fb-label">{{ t('home.filter') }}</text>
          <view v-if="activeFilterCount > 0" class="fb-badge">{{ activeFilterCount }}</view>
        </view>
      </view>

    </view>

    <!-- Desktop search + filter. The .mobile-header that holds these on phones
         is display:none ≥768px, so on Mac/iPad there was no way to search or
         filter the marketplace. Mirrors .mh-search; desktop-only via CSS. -->
    <view class="home-desktop-tools">
      <view class="search-field search-proxy" @click="goToSearch" role="button" :aria-label="t('a11y.search')">
        <UIcon name="search" size="xs" color="ink-faint" />
        <text v-if="searchText" class="sf-text">{{ searchText }}</text>
        <text v-else class="sf-placeholder">{{ t('home.search') }}</text>
        <view v-if="searchText" class="sf-clear hit-target" role="button" :aria-label="t('a11y.searchClear')" @click.stop="onClearSearch"><UIcon name="close" size="xs" color="currentColor" aria-hidden="true" /></view>
      </view>
      <view class="filter-btn" role="button" :aria-label="t('a11y.filter')" @click.stop="openFilterSheet">
        <UIcon name="filter" size="xs" color="text-secondary" />
        <text class="fb-label">{{ t('home.filter') }}</text>
        <view v-if="activeFilterCount > 0" class="fb-badge">{{ activeFilterCount }}</view>
      </view>
    </view>

    <!-- 在售 / 求购 — sell listings vs wanted (ISO) posts (migration 054). -->
    <view class="marketplace-actions">
    <view class="feed-mode" role="tablist" :aria-label="t('home.tabOnSale') + ' / ' + t('home.tabWanted')">
      <view
        :class="['fm-seg', 'u-press', { on: listingType === 'sell' }]"
        role="tab"
        :tabindex="listingType === 'sell' ? 0 : -1"
        :aria-selected="listingType === 'sell' ? 'true' : 'false'"
        @click="setListingType('sell')"
        @keydown="onFeedModeKeydown($event, 'sell')"
      >
        <text class="fm-seg-label">{{ t('home.tabOnSale') }}</text>
      </view>
      <view
        :class="['fm-seg', 'u-press', { on: listingType === 'wanted' }]"
        role="tab"
        :tabindex="listingType === 'wanted' ? 0 : -1"
        :aria-selected="listingType === 'wanted' ? 'true' : 'false'"
        @click="setListingType('wanted')"
        @keydown="onFeedModeKeydown($event, 'wanted')"
      >
        <text class="fm-seg-label">{{ t('home.tabWanted') }}</text>
      </view>
    </view>
    <view class="feed-publish u-press" role="button" :aria-label="t(listingType === 'wanted' ? 'home.publishWanted' : 'home.publishSell')" @click="goPublish">
      <UIcon name="plus" size="xs" color="ink-inverse" />
      <text>{{ t(listingType === 'wanted' ? 'home.publishWanted' : 'home.publishSell') }}</text>
    </view>
    </view>

    <!--
      Category rail — horizontal pill scroll per marketplace/ kit's
      HomeScreen + refinement pass. The previous 4×3 grid + tall hero
      ate too much vertical space; this compact rail matches Xianyu /
      Taobao feel and keeps the fold tight.
    -->
    <scroll-view class="cat-bar" scroll-x :show-scrollbar="false">
      <view class="cat-bar-inner">
        <view
          v-for="cat in categories"
          :key="'c'+cat.value"
          :class="['pill', 'u-press', { active: selectedCategory === cat.value }]"
          role="button"
          :aria-label="cat.label"
          :aria-pressed="selectedCategory === cat.value ? 'true' : 'false'"
          @click="selectCategory(cat.value)"
        >
          <text class="pill-label">{{ cat.label }}</text>
        </view>
        <!--
          Trailing transparent spacer — gives the last pill room to
          breathe past the right safe-area / scrollbar edge so it
          never gets visually clipped. Without this the rightmost pill
          sits flush against the viewport edge and looks chopped on
          devices with rounded corners or a notch on the right.
        -->
        <view class="cat-tab-spacer" aria-hidden="true"></view>
      </view>
    </scroll-view>

    <view
      v-if="showSemesterBanner"
      class="semester-banner u-press"
      role="button"
      :aria-label="semesterTitle(lang as 'en' | 'zh')"
      @click="onSemesterBannerTap"
    >
      <image class="seb-arc" src="/static/logo-mark.svg" alt="" aria-hidden="true" mode="aspectFit" />
      <view class="seb-body">
        <text class="seb-stamp t-eyebrow">{{ t('app.name') }}</text>
        <text class="seb-title">{{ semesterTitle(lang as 'en' | 'zh') }}</text>
        <text class="seb-sub">{{ semesterSubtitle(lang as 'en' | 'zh') }}</text>
      </view>
      <UIcon class="seb-arrow" name="chevron-right" size="sm" color="currentColor" aria-hidden="true" />
    </view>

    <!-- Active filter summary bar (shows when filters are applied, even if sheet closed) -->
    <view v-if="activeFilterCount > 0 && !showFilter" class="active-filter-bar">
      <scroll-view scroll-x class="afb-scroll">
        <view v-if="filterPriceMin || filterPriceMax" class="afb-chip" role="button" :aria-label="priceRangeLabel" @click="openFilterSheet">
          <text class="afb-chip-label">{{ priceRangeLabel }}</text>
        </view>
        <view v-if="filterCondition" class="afb-chip" role="button" :aria-label="t('condition.' + filterCondition)" @click="openFilterSheet">
          <text class="afb-chip-label">{{ t('condition.' + filterCondition) }}</text>
        </view>
        <view v-if="filterDetailDate" class="afb-chip" role="button" :aria-label="t('listingDetails.filterDate')" @click="openFilterSheet"><text class="afb-chip-label">{{ filterDetailDate }}</text></view>
        <view v-if="filterPriceUnit" class="afb-chip" role="button" :aria-label="t('listingDetails.priceUnit')" @click="openFilterSheet"><text class="afb-chip-label">{{ t('listingDetails.unit.' + filterPriceUnit) }}</text></view>
        <view v-if="filterLocation" class="afb-chip" role="button" :aria-label="filterLocation" @click="openFilterSheet">
          <text class="afb-chip-label">{{ filterLocation }}</text>
        </view>
        <view v-if="!searchText.trim() && sortBy !== 'latest'" class="afb-chip" role="button" :aria-label="t('sort.' + sortBy.replace('price_asc', 'priceAsc').replace('price_desc', 'priceDesc'))" @click="openFilterSheet">
          <text class="afb-chip-label">{{ t('sort.' + sortBy.replace('price_asc', 'priceAsc').replace('price_desc', 'priceDesc')) }}</text>
        </view>
      </scroll-view>
      <view class="afb-clear" role="button" :aria-label="t('home.clearFilters')" @click="onClearAllFilters">
        <text class="afb-clear-label">{{ t('home.clearFilters') }}</text>
      </view>
    </view>

    <!-- Filter Bottom Sheet -->
    <view v-if="showFilter" class="filter-mask u-mask-in" @click="cancelFilterEdit"></view>
    <view
      v-if="showFilter"
      ref="filterDialogEl"
      class="filter-sheet"
      :style="filterViewportStyle"
      role="dialog"
      aria-modal="true"
      :aria-label="t('filter.title')"
    >
      <view class="fs-header">
        <view class="fs-close" role="button" tabindex="0" :aria-label="t('a11y.filterClose')" @click="cancelFilterEdit">
          <view class="fs-x"></view>
        </view>
        <text class="fs-title">{{ t('filter.title') }}</text>
        <text class="fs-reset" role="button" :aria-label="t('a11y.filterReset')" @click="resetFilters">{{ t('filter.reset') }}</text>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.price') }}</text>
        <view class="fs-price-row">
          <view :class="['fs-price-input', { invalid: !!priceFilterError }]">
            <text class="fs-dollar">$</text>
            <input
              class="fs-price-field"
              v-model="filterPriceMin"
              type="digit"
              :placeholder="t('filter.priceMin')"
              :aria-label="t('filter.priceMin')"
              :aria-invalid="priceFilterError ? 'true' : 'false'"
              :aria-describedby="priceFilterError ? 'home-price-filter-error' : undefined"
            />
          </view>
          <text class="fs-dash">—</text>
          <view :class="['fs-price-input', { invalid: !!priceFilterError }]">
            <text class="fs-dollar">$</text>
            <input
              class="fs-price-field"
              v-model="filterPriceMax"
              type="digit"
              :placeholder="t('filter.priceMax')"
              :aria-label="t('filter.priceMax')"
              :aria-invalid="priceFilterError ? 'true' : 'false'"
              :aria-describedby="priceFilterError ? 'home-price-filter-error' : undefined"
            />
          </view>
        </view>
        <text v-if="priceFilterError" id="home-price-filter-error" class="fs-error" role="alert">{{ t(priceFilterError) }}</text>
      </view>

      <view v-if="listingType !== 'wanted' && !hasCategoryDetails(selectedCategory || undefined)" class="fs-section">
        <text class="fs-label">{{ t('filter.condition') }}</text>
        <view class="fs-pills">
          <view
            v-for="(label, key) in conditionOpts"
            :key="key"
            :class="['fpill', { active: filterCondition === key }]"
            role="button"
            :aria-label="label"
            :aria-pressed="filterCondition === key ? 'true' : 'false'"
            @click="filterCondition = filterCondition === key ? '' : (key as ItemCondition)"
          >
            <text class="fpill-label">{{ label }}</text>
          </view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.location') }}</text>
        <view class="fs-pills">
          <view
            v-for="loc in locationOpts"
            :key="loc"
            :class="['fpill', { active: filterLocation === loc }]"
            role="button"
            :aria-label="loc"
            :aria-pressed="filterLocation === loc ? 'true' : 'false'"
            @click="filterLocation = filterLocation === loc ? '' : loc; nearbySource = filterLocation ? t('discovery.selectedArea') : ''"
          >
            <text class="fpill-label">{{ loc }}</text>
          </view>
        </view>
      </view>

      <view v-if="hasCategoryDetails(selectedCategory || undefined)" class="fs-section">
        <text class="fs-label">{{ t('listingDetails.filterDate') }}</text>
        <picker :aria-label="t('listingDetails.filterDate')" mode="date" :value="filterDetailDate" start="2000-01-01" end="2099-12-31" @change="filterDetailDate = $event.detail.value">
          <view class="fpill" role="button" :aria-label="t('listingDetails.filterDate')">{{ filterDetailDate || t('listingDetails.chooseDate') }}</view>
        </picker>
        <text class="search-sort-hint">{{ t('listingDetails.filterDateHint') }}</text>
        <view v-if="selectedCategory === 'housing'" class="fs-pills">
          <view v-for="unit in ['', 'month', 'week', 'total']" :key="unit" :class="['fpill', { active: filterPriceUnit === unit }]" role="button" :aria-pressed="filterPriceUnit === unit ? 'true' : 'false'" :aria-label="unit ? t('listingDetails.unit.' + unit) : t('listingDetails.allUnits')" @click="filterPriceUnit = unit">{{ unit ? t('listingDetails.unit.' + unit) : t('listingDetails.allUnits') }}</view>
        </view>
      </view>

      <view class="fs-section">
        <text class="fs-label">{{ t('filter.sort') }}</text>
        <view v-if="searchText.trim()" class="search-sort-note">
          <text class="fpill active">{{ t('filter.relevance') }}</text>
          <text class="search-sort-hint">{{ t('filter.relevanceHint') }}</text>
        </view>
        <view v-else class="fs-pills">
          <view
            v-for="s in sortOpts"
            :key="s.value"
            :class="['fpill', { active: sortBy === s.value }]"
            role="button"
            :aria-label="s.label"
            :aria-pressed="sortBy === s.value ? 'true' : 'false'"
            @click="sortBy = s.value"
          >
            <text class="fpill-label">{{ s.label }}</text>
          </view>
        </view>
      </view>

      <view class="fs-footer">
        <button v-if="hiddenIds.size" class="discovery-restore" :disabled="discoveryChanging" @click="onRestoreHidden">{{ t('discovery.restoreAll', { count: hiddenIds.size }) }}</button>
        <view
          :class="['fs-apply', { disabled: !!priceFilterError }]"
          role="button"
          :aria-disabled="priceFilterError ? 'true' : 'false'"
          @click="applyFilters"
        >
          <text>{{ t('filter.apply') }}</text>
        </view>
      </view>
    </view>

    <!-- Waterfall Feed -->
    <scroll-view
      class="feed"
      scroll-y
      :scroll-top="scrollTopVal"
      @scrolltolower="loadMore"
      @scroll="onScroll"
      refresher-enabled
      :refresher-triggered="isRefreshing"
      @refresherrefresh="onRefresh"
    >
      <!-- Skeleton Loading -->
      <view v-if="!searchText" class="discovery-controls" :aria-label="t('discovery.browse')">
        <button class="discovery-mode" :class="{ chosen: sortBy === 'latest' }" :aria-pressed="sortBy === 'latest'" @click="setBrowseMode('latest')">{{ t('sort.latest') }}</button>
        <button class="discovery-mode" :class="{ chosen: sortBy === 'recommended' }" :aria-pressed="sortBy === 'recommended'" @click="setBrowseMode('recommended')">{{ t('sort.recommended') }}</button>
        <button class="discovery-mode" :class="{ chosen: !!filterLocation }" :disabled="detectingNearby" @click="chooseNearby"><UIcon name="location-pin" size="xs" color="currentColor" />{{ detectingNearby ? t('publish.detectingLocation') : t('discovery.nearby') }}</button>
        <button class="discovery-about discovery-mode" :aria-label="t('discovery.howTitle')" @click="explainDiscovery"><UIcon name="info" size="xs" color="currentColor" /></button>
      </view>
      <text v-if="nearbySource && filterLocation" class="discovery-note">{{ nearbySource }} · {{ filterLocation }}</text>
      <view v-if="lastHiddenId" class="discovery-undo" role="status" aria-live="polite">
        <text>{{ t('discovery.hidden') }}</text>
        <button class="discovery-undo-action" :disabled="discoveryChanging" @click="undoHidden">{{ t('discovery.undo') }}</button>
      </view>
      <view v-if="initialLoading" class="waterfall">
        <view v-for="ci in columnCount" :key="'sk'+ci" class="wf-col">
          <view v-for="n in 3" :key="'sk'+ci+'-'+n" class="card skeleton-card">
            <view class="sk-img" :style="{ height: (130 + n * 40) + 'px' }"></view>
            <view class="sk-body">
              <view class="sk-line"></view>
              <view class="sk-line w60"></view>
              <view class="sk-row">
                <view class="sk-circle"></view>
                <view class="sk-line w40"></view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- Real Content -->
      <view v-else>
        <AddToHomeHint v-if="filteredItems.length > 0 && !fetchError" />
        <!-- The only feedback that a search or a category tap changed the
             feed. Without a live region the list silently reshuffles. -->
        <view v-if="!loading && !fetchError && (searchText || selectedCategory)" class="result-count" role="status" aria-live="polite" aria-atomic="true">
          <text>{{ filteredItems.length }} {{ tc('home.results', filteredItems.length) }}</text>
        </view>
        <view class="waterfall" :key="listingType">
          <view v-for="(col, ci) in columns" :key="ci" class="wf-col u-stagger">
          <view
            v-for="item in col"
            :key="item.id"
            class="card u-press u-rise"
            role="button"
            tabindex="0"
            :aria-label="localizeItemTitle(item)"
            @click="goToDetail(item.id)"
            @keydown.self="onItemCardKeydown($event, item.id)"
            @touchstart="cardLongPress.onTouchstart(item)"
            @touchend="cardLongPress.onTouchend"
            @touchcancel="cardLongPress.onTouchcancel"
            @touchmove="cardLongPress.onTouchmove"
          >
            <view class="card-img-box">
              <img
                v-if="thumbUrl(item.images?.[0], 'card')"
                :src="thumbUrl(item.images?.[0], 'card')"
                :class="['card-img', { 'card-img-sold': item.status === 'sold' }]"
                :style="dimsToAspectStyle(effectiveDims(item), 0)"
                :alt="localizeItemTitle(item)"
                loading="lazy"
                lazy-load
                mode="aspectFit"
                @load="onImgLoad($event, item, 0)"
              />
              <!--
                Photoless items get a branded, on-palette placeholder
                instead of the cold gray "No Image" SVG (which read as a
                broken/unfinished image and was the single biggest
                vibe-coded tell on the feed). Faded 集 seal on a warm
                gradient. A compact 3:2 slot keeps text-first sell/wanted
                listings dense instead of spending a full portrait tile on
                decorative empty media.
              -->
              <view
                v-else
                class="u-thumb-ph"
                :style="dimsToAspectStyle(null, 0, '3/2')"
                aria-hidden="true"
              >
                <text class="u-thumb-ph-seal">玉</text>
              </view>
              <view v-if="item.status === 'sold'" class="sold-overlay">
                <text class="sold-overlay-label">{{ t('status.sold') }}</text>
              </view>
              <view v-else-if="item.status === 'reserved'" class="card-cond-badge"><UBadge variant="reserved" :label="t('status.reserved')" /></view>
              <view v-else-if="!hasCategoryDetails(item.category) && item.condition === 'defective'" class="card-cond-badge"><UBadge variant="defect" :label="t('condition.defective')" /></view>
              <view v-else-if="!hasCategoryDetails(item.category) && item.condition === 'new'" class="card-cond-badge"><UBadge variant="new" :label="t('condition.new')" /></view>
              <view v-else-if="!hasCategoryDetails(item.category) && item.condition === 'like_new'" class="card-cond-badge"><UBadge variant="mint" :label="t('condition.like_new')" /></view>
              <view v-if="item.listing_type === 'wanted' && item.status !== 'sold'" class="card-cond-badge"><UBadge variant="wanted" :label="t('item.wanted')" /></view>
              <view v-if="item.images && item.images.length > 1" class="img-count-badge">
                <text class="img-count-label">{{ item.images.length }}</text>
              </view>
              <view v-if="pickupBadge(item)" class="badge-safe-corner" :class="{ 'badge-safe-corner--shared': !pickupBadge(item)!.spot }" :aria-label="pickupBadge(item)!.label">
                <UIcon v-if="pickupBadge(item)!.spot" class="bsc-check" name="check" size="xs" color="currentColor" aria-hidden="true" />
                <text class="bsc-label">{{ pickupBadge(item)!.label }}</text>
              </view>
            </view>
            <view class="card-info">
              <view class="card-heading">
              <text class="card-title">{{ localizeItemTitle(item) }}</text>
              <button class="card-more" :aria-label="t('discovery.itemOptions', { title: localizeItemTitle(item) })" @click.stop="onCardLongPress(item)" @touchstart.stop @touchend.stop><UIcon name="more-horizontal" size="sm" color="text-muted" /></button>
              </view>
              <text v-if="item.discovery_reason" class="discovery-reason">{{ t('discovery.reason.' + item.discovery_reason) }}</text>
              <view class="card-price-row">
                <text v-if="item.listing_type === 'wanted'" class="card-price card-price-wanted">{{ listingPriceLabel(item, t) }}</text>
                <template v-else>
                  <text :class="['card-price', { 'card-price-free': item.price === 0 }]">{{ listingPriceLabel(item, t) }}</text>
                  <text v-if="item.negotiable" class="obo-tag">{{ t('publish.obo') }}</text>
                </template>
              </view>
              <ListingDetailsSummary :item="item" compact />
              <view v-if="item.location" class="card-pickup">
                <UIcon name="location-pin" size="xs" color="text-subtle" aria-hidden="true" />
                <text class="card-pickup-label">{{ localizeLocation(item.location, lang as 'en' | 'zh') }}</text>
              </view>
              <view class="card-bottom">
                <view :class="['card-seller', { 'card-seller--verified': item.profile?.is_illini_verified }]">
                  <UAvatar
                    :src="item.profile?.avatar_url"
                    :owner="item.user_id"
                    :fallback="defaultAvatarSrc"
                    :alt="item.profile?.nickname || 'avatar'"
                    class="seller-pic"
                    lazy
                  />
                  <text class="seller-nick">{{ item.profile?.nickname || t('app.user') }}</text>
                  <UBadge v-if="item.profile?.is_illini_verified" variant="illini" class="card-illini" :title="t('profile.illiniVerified')" :aria-label="t('profile.illiniVerified')" :label="t('profile.verifiedShort')" />
                </view>
                <view class="card-fav">
                  <text class="card-time">{{ formatTime(item.created_at) }}</text>
                  <text v-if="isOldItem(item.created_at)" class="old-tag">{{ t('home.oldListing') }}</text>
                  <text v-if="(item.profile?.rating_count || 0) > 0" class="seller-rating">{{ Number(item.profile?.avg_rating || 0).toFixed(1) }}/5</text>
                  <button class="card-save"
                    :aria-label="isFavorited(item.id) ? t('a11y.unfavorite') : t('a11y.favorite')"
                    :aria-pressed="isFavorited(item.id)"
                    @click.stop="onQuickFav(item)" @touchstart.stop @touchend.stop
                  ><image
                    :src="isFavorited(item.id) ? '/static/heart-filled.svg' : '/static/heart.svg'"
                    alt=""
                    :class="['heart-img', { 'u-anim-heart-pop': isFavorited(item.id) }]"
                    aria-hidden="true"
                  /></button>
                  <text v-if="(item.favorite_count || 0) > 0" class="fav-num">{{ item.favorite_count }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
        </view>
      </view>

      <!-- Loading more -->
      <view v-if="loading && !initialLoading" class="tip">
        <view class="dots"><text class="dot">·</text><text class="dot dot-2">·</text><text class="dot dot-3">·</text></view>
        <text>{{ t('home.loading') }}</text>
      </view>
      <!-- End of list -->
      <view v-if="!hasMore && filteredItems.length > 0" class="tip">
        <text class="divider"></text>
        <text>{{ t('home.endOf') }} · {{ filteredItems.length }} {{ tc('home.results', filteredItems.length) }}</text>
        <text class="divider"></text>
      </view>
      <!-- Empty -->
      <button v-if="sortBy === 'recommended' && !hasMore && !loading" class="discovery-all" @click="setBrowseMode('latest')">{{ t('discovery.allLatest') }}</button>
      <button v-if="!loading && !filteredItems.length && hiddenIds.size" class="discovery-all" :disabled="discoveryChanging" @click="onRestoreHidden">{{ t('discovery.restoreAll', { count: hiddenIds.size }) }}</button>
      <!-- Empty -->
      <view v-if="fetchError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
        <UIcon name="shield" size="lg" color="ink-soft" />
        <text class="empty-sub">{{ fetchError }}</text>
        <view class="empty-btn" role="button" :aria-label="t('home.retry')" @click="retryFeed">{{ t('home.retry') }}</view>
      </view>

      <view v-else-if="!loading && !initialLoading && filteredItems.length === 0" class="empty">
        <UEmptyArt :name="searchText ? 'search' : 'bag'" />
        <text class="empty-title">{{ activeFilterCount > 0 || selectedCategory ? t('home.filteredEmpty') : searchText ? t('home.noResults') : (listingType === 'wanted' ? t('home.emptyWantedTitle') : t('home.emptyTitle')) }}</text>
        <text class="empty-sub">{{ activeFilterCount > 0 || selectedCategory ? t('home.filteredEmptyHint') : searchText ? t('home.tryOther') : (listingType === 'wanted' ? t('home.emptyWantedSub') : t('home.emptySub')) }}</text>
        <view v-if="activeFilterCount > 0 || selectedCategory" class="empty-btn" role="button" :aria-label="t('home.clearFilters')" @click="selectedCategory = null; onClearAllFilters()">{{ t('home.clearFilters') }}</view>
        <view v-else-if="searchText" class="empty-btn" role="button" :aria-label="t('home.clearSearch')" @click="searchText = ''; onSearch()">{{ t('home.clearSearch') }}</view>
        <view v-else class="empty-btn" role="button" :aria-label="t('home.postItem')" @click="goPublish">{{ t('home.postItem') }}</view>
      </view>
    </scroll-view>

    <!-- Back to top -->
    <view v-if="showBackTop" class="back-top" role="button" :aria-label="t('a11y.backToTop')" @click="scrollToTop">
      <view class="bt-arrow"></view>
    </view>

    <CustomTabBar current="index" />
    <PermissionDeniedModal :visible="nearbyPermissionVisible" @close="nearbyPermissionVisible = false" />
  </view>
</template>

<script setup lang="ts">
import ListingDetailsSummary from '../../components/ListingDetailsSummary.vue'
import { hasCategoryDetails, validListingDate } from '../../utils/listingDetails'
import { matchesListingLocation } from '../../utils/listingLocation'
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { onShow, onHide, onShareAppMessage, onShareTimeline, onUnload } from '@dcloudio/uni-app'
import { useItems } from '../../composables/useItems'
import { useVisualViewportBounds } from '../../composables/useVisualViewportInset'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useTheme } from '../../composables/useTheme'
import { useFavorites } from '../../composables/useFavorites'
import { useDiscovery } from '../../composables/useDiscovery'
import { useHistory } from '../../composables/useHistory'
import { useLocation } from '../../composables/useLocation'
import { useDomKeydown } from '../../composables/useDomKeydown'
import { interestCategories, nearbyArea } from '../../utils/discovery'
import PermissionDeniedModal from '../../components/PermissionDeniedModal.vue'
import { useModeration } from '../../composables/useModeration'
import { useSemester } from '../../composables/useSemester'
import { useLongPress } from '../../composables/useLongPress'
import { createOwnedLoading } from '../../composables/ownedLoading'
import { pickupTier, localizeLocation } from '../../composables/useCampusSpots'
import type { ItemCategory, ItemCondition, Item } from '../../types'

import { debounce, formatTime, formatPrice, listingPriceLabel, friendlyErrorMessage, haptic, thumbUrl, BROWSE_CATEGORIES } from '../../utils'
import { dimsToAspectStyle, readNaturalDims } from '../../utils/imgStyle'
// #ifndef H5
import { BASE_URL } from '../../config/runtime'
// #endif
import type { ImageDim } from '../../types'
import AppSidebar from '../../components/AppSidebar.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import UBadge from '../../components/UBadge.vue'
import UAvatar from '../../components/UAvatar.vue'
import UIcon from '../../components/UIcon.vue'
import UEmptyArt from '../../components/UEmptyArt.vue'
import AddToHomeHint from '../../components/AddToHomeHint.vue'
import {
  captureAccountIdentityGeneration,
  captureAccountRequest,
  getActiveAccountId,
  isAccountRequestCurrent,
  onAccountTransition,
} from '../../composables/accountScope'
import {
  readAccountPrivateStorage,
  removeAccountPrivateStorage,
  writeAccountPrivateStorage,
} from '../../api/accountLocalPrivacy'
import { consumeHomeNavigationIntent, stagePublishNavigationIntent } from '../../api/navigationIntent'

const { bottomInset: filterBottomInset, visibleHeight: filterVisibleHeight } = useVisualViewportBounds()
const filterViewportStyle = computed(() => ({
  bottom: `${filterBottomInset.value}px`,
  '--filter-visible-height': filterVisibleHeight.value == null ? '100vh' : `${filterVisibleHeight.value}px`,
}))
const { t, tc, lang, localize, toggleLang } = useI18n()
const { isDark, setPref } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)

// v5 brand chrome — logo flips with theme, eyebrow shows the opposite-language
// tagline, theme pill labels the active mode. toggleTheme resolves an explicit
// light/dark pref off the currently-rendered state (covers the auto+OS-dark case).
const logoSrc = computed(() =>
  isDark.value ? '/static/logo-mark-dark.svg' : '/static/logo-mark.svg'
)
const brandEyebrow = computed(() => (lang.value === 'zh' ? 'ILLINI MARKET' : 'UIUC · CAACI'))
const themeLabel = computed(() =>
  isDark.value ? (lang.value === 'zh' ? '暗' : 'Dark') : (lang.value === 'zh' ? '亮' : 'Light'),
)
function toggleTheme() {
  setPref(isDark.value ? 'light' : 'dark')
}
const { phase: semesterPhase, config: semesterConfig, title: semesterTitle, subtitle: semesterSubtitle } = useSemester()

const semesterDismissed = ref<boolean>(false)
try { semesterDismissed.value = !!uni.getStorageSync(`semester_dismissed_${semesterPhase.value}`) } catch {}

const showSemesterBanner = computed(() =>
  !semesterDismissed.value
  && semesterPhase.value !== 'fall_session'
  && semesterPhase.value !== 'spring_session'
  && semesterPhase.value !== 'summer'
  && !selectedCategory.value,
)

function onSemesterBannerTap() {
  const cat = semesterConfig.value.category as ItemCategory | undefined
  if (cat) selectCategory(cat)
}

/*
 * Thin delegate to localize().
 *
 * An earlier version branched to quickTranslate() for items whose
 * title_i18n was missing. That shortcut SKIPPED the auto-translate
 * scheduler inside localize(), so legacy rows stayed in their source
 * language forever no matter how long the user waited. Going straight
 * through localize() means a missing map still fires the background
 * fetch and the card flips to the translated title once it returns.
 */
function localizeItemTitle(it: { title: string; title_i18n?: Record<string, string> | null }): string {
  if (!it?.title) return ''
  return localize(it.title_i18n, it.title)
}

function pickupBadge(it: Item): { spot: boolean; label: string } | null {
  const tier = pickupTier(it.location, it.location_verified)
  if (!tier) return null
  return { spot: tier === 'spot', label: t(tier === 'spot' ? 'pickup.safeSpot' : 'pickup.verifiedPickup') }
}

const { items, loading, hasMore, fetchError, fetchItems, clearItems } = useItems()
const { currentUser, requireAuth, awaitAuthReady } = useAuth()
const { isFavorited, toggleFavorite, loadMyFavorites, favoriteIds } = useFavorites()
const { history: viewedItems } = useHistory()
const { hiddenIds, changing: discoveryChanging, loadHiddenItems, setHidden, restoreAllHidden } = useDiscovery()
const { detectLocation, detecting: detectingNearby } = useLocation()
const lastHiddenId = ref('')
const nearbySource = ref('')
const nearbyPermissionVisible = ref(false)
const { ensureLoaded: ensureBlockedLoaded, reportTarget } = useModeration()

const initialLoading = ref(true)
let homeAccountEpoch = 0
const reportLoading = createOwnedLoading()

/*
 * Render-side safety net for image dims.
 *
 * Migration 014 persists image_dimensions so cards can reserve the
 * correct aspect-ratio slot on first paint. When the DB value is
 * empty/invalid (pre-migration rows OR a publish write that never
 * landed — see _ai_notes/IMAGE_PIPELINE_*.md), we fall back to
 * naturalWidth/Height measured once the image decodes. DB always
 * wins; this is the "DB didn't have data" rescue path only.
 */
const measuredDims = ref<Record<string, ImageDim[]>>({})

function effectiveDims(item: Item): ImageDim[] | null {
  const fromDb = item?.image_dimensions
  if (Array.isArray(fromDb) && fromDb.length > 0 && fromDb.some((d) => d && d.w > 0 && d.h > 0)) {
    return fromDb
  }
  return measuredDims.value[item.id] || null
}

function onImgLoad(e: any, item: Item, idx: number) {
  const fromDb = item?.image_dimensions
  if (Array.isArray(fromDb) && fromDb[idx] && fromDb[idx].w > 0 && fromDb[idx].h > 0) return
  const natural = readNaturalDims(e)
  if (!natural) return
  const prev = measuredDims.value[item.id] ? measuredDims.value[item.id].slice() : []
  prev[idx] = natural
  measuredDims.value = { ...measuredDims.value, [item.id]: prev }
}

const searchText = ref('')
const selectedCategory = ref<ItemCategory | null>(null)
const currentPage = ref(0)
const isRefreshing = ref(false)
const columnCount = ref(2)
const showBackTop = ref(false)
const scrollTopVal = ref(0)
const lastScrollTop = ref(0)
let scrollResetTimer: ReturnType<typeof setTimeout> | undefined
let scrollRestoreTimer: ReturnType<typeof setTimeout> | undefined
let scrollRestoreResetTimer: ReturnType<typeof setTimeout> | undefined
let homeShowEpoch = 0
let homeVisible = false

const showFilter = ref(false)
const filterDialogEl = ref<unknown>(null)
useDomKeydown(filterDialogEl, onFilterDialogKeydown)
const filterPriceMin = ref('')
const filterPriceMax = ref('')
const filterCondition = ref<ItemCondition | ''>('')
const filterLocation = ref('')
const filterDetailDate = ref('')
const filterPriceUnit = ref('')
const sortBy = ref('latest')
const listingType = ref<'sell' | 'wanted'>('sell')

const MAX_FILTER_PRICE = 1_000_000
type FilterSnapshot = {
  detailDate: string
  priceUnit: string
  priceMin: string
  priceMax: string
  condition: ItemCondition | ''
  location: string
  nearbySource: string
  sort: string
}
let filterSnapshot: FilterSnapshot | null = null
let filterReturnFocus: HTMLElement | null = null

/*
 * The filter sheet is an edit draft. Closing it through the mask / X restores
 * the last applied values; otherwise a half-typed or invalid range leaked into
 * the summary chip even though the user never tapped Apply.
 */
function openFilterSheet() {
  if (!showFilter.value) {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      filterReturnFocus = document.activeElement
    }
    filterSnapshot = {
      detailDate: filterDetailDate.value,
      priceUnit: filterPriceUnit.value,
      priceMin: filterPriceMin.value,
      priceMax: filterPriceMax.value,
      condition: filterCondition.value,
      location: filterLocation.value,
      nearbySource: nearbySource.value,
      sort: sortBy.value,
    }
  }
  showFilter.value = true
  nextTick(() => {
    if (typeof document === 'undefined') return
    document.querySelector<HTMLElement>('.filter-sheet .fs-close')?.focus()
  })
}

function restoreFilterTriggerFocus() {
  const target = filterReturnFocus
  filterReturnFocus = null
  nextTick(() => target?.focus())
}

function cancelFilterEdit() {
  if (filterSnapshot) {
    filterDetailDate.value = filterSnapshot.detailDate
    filterPriceUnit.value = filterSnapshot.priceUnit
    filterPriceMin.value = filterSnapshot.priceMin
    filterPriceMax.value = filterSnapshot.priceMax
    filterCondition.value = filterSnapshot.condition
    filterLocation.value = filterSnapshot.location
    nearbySource.value = filterSnapshot.nearbySource
    sortBy.value = filterSnapshot.sort
  }
  filterSnapshot = null
  showFilter.value = false
  restoreFilterTriggerFocus()
}

function onFilterDialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelFilterEdit()
    return
  }
  if (event.key !== 'Tab' || typeof document === 'undefined') return
  const dialog = event.currentTarget as HTMLElement | null
  if (!dialog) return
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'input, [role="button"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])',
  )).filter(element => !element.hasAttribute('disabled'))
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function validFilterPrice(raw: string): boolean {
  if (!raw) return true
  // Allow a trailing decimal point while the user is mid-entry; Apply
  // canonicalizes it to the numeric value ("10." → "10").
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return false
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= MAX_FILTER_PRICE
}

const priceFilterError = computed(() => {
  const minRaw = filterPriceMin.value.trim()
  const maxRaw = filterPriceMax.value.trim()
  if (!validFilterPrice(minRaw) || !validFilterPrice(maxRaw)) return 'filter.priceInvalid'
  if (minRaw && maxRaw && Number(minRaw) > Number(maxRaw)) return 'filter.priceRangeInvalid'
  return ''
})

const priceRangeLabel = computed(() => {
  const min = filterPriceMin.value ? formatPrice(Number(filterPriceMin.value), '$0') : '$0'
  const max = filterPriceMax.value ? formatPrice(Number(filterPriceMax.value), '$0') : '∞'
  return `${min}–${max}`
})

const categoryKeys: (ItemCategory | null)[] = [null, ...BROWSE_CATEGORIES]
const categories = computed(() => categoryKeys.map(k => ({
  value: k,
  label: t(k ? 'cat.' + k : 'cat.all'),
})))

const conditionKeys: ItemCondition[] = ['new', 'like_new', 'good', 'fair', 'defective']
const conditionOpts = computed(() => {
  const m: Record<string, string> = {}
  conditionKeys.forEach(k => { m[k] = t('condition.' + k) })
  return m
})

const locationOpts = ['Champaign', 'Urbana', 'UIUC']

const sortKeys = ['latest', 'recommended', 'price_asc', 'price_desc', 'popular']
const sortOpts = computed(() => sortKeys.map(k => ({ value: k, label: t('sort.' + k.replace('price_asc', 'priceAsc').replace('price_desc', 'priceDesc')) })))

const activeFilterCount = computed(() => {
  let c = 0
  if (filterPriceMin.value) c++
  if (filterPriceMax.value) c++
  if (filterCondition.value) c++
  if (filterLocation.value) c++
  if (filterDetailDate.value) c++
  if (filterPriceUnit.value) c++
  if (!searchText.value.trim() && sortBy.value !== 'latest') c++
  return c
})

const displayItems = computed(() => items.value)

function getFilterParams() {
  return {
    detailDate: hasCategoryDetails(selectedCategory.value || undefined) ? filterDetailDate.value || undefined : undefined,
    priceUnit: selectedCategory.value === 'housing' ? filterPriceUnit.value || undefined : undefined,
    category: selectedCategory.value,
    search: searchText.value,
    priceMin: filterPriceMin.value ? Number(filterPriceMin.value) : undefined,
    priceMax: filterPriceMax.value ? Number(filterPriceMax.value) : undefined,
    condition: filterCondition.value || undefined,
    sort: searchText.value.trim() ? undefined : sortBy.value,
    interestCategories: interestCategories(viewedItems.value, favoriteIds.value, hiddenIds.value),
    listingType: listingType.value,
    location: filterLocation.value || undefined,
  }
}

function setListingType(t: 'sell' | 'wanted') {
  if (listingType.value === t) return
  listingType.value = t
  if (t === 'wanted') filterCondition.value = ''
  currentPage.value = 0
  scrollToTop()
  fetchItems({ ...getFilterParams(), reset: true })
}

function setBrowseMode(mode: 'latest' | 'recommended') {
  sortBy.value = mode
  currentPage.value = 0
  scrollToTop()
  void fetchItems({ ...getFilterParams(), reset: true })
}

function explainDiscovery() {
  uni.showModal({ title: t('discovery.howTitle'), content: t('discovery.howBody'), showCancel: false, confirmText: t('publish.permissionModalDismiss') })
}

function chooseNearby() {
  if (detectingNearby.value) return
  const epoch = homeAccountEpoch
  const areas = ['UIUC', 'Champaign', 'Urbana']
  uni.showActionSheet({
    itemList: [t('publish.useCurrentLocation'), ...areas, t('discovery.anywhere')],
    success: async ({ tapIndex }) => {
      if (epoch !== homeAccountEpoch) return
      let area = '', source = ''
      if (tapIndex === 0) {
        const result = await detectLocation()
        if (epoch !== homeAccountEpoch || !homeVisible) return
        if (!result.ok) {
          if (result.reason === 'cancelled') return
          if (result.reason === 'permission_denied') nearbyPermissionVisible.value = true
          else uni.showToast({ title: t(result.reason === 'timeout' ? 'publish.gpsTimeout' : 'publish.gpsUnavailable'), icon: 'none' })
          return
        }
        area = nearbyArea(result.location) || ''
        if (!area) { uni.showToast({ title: t('discovery.outsideArea'), icon: 'none' }); return }
        source = t('discovery.detectedArea')
      } else if (tapIndex <= 3) {
        area = areas[tapIndex - 1]
        source = t('discovery.selectedArea')
      }
      filterLocation.value = area
      nearbySource.value = source
      currentPage.value = 0
      void fetchItems({ ...getFilterParams(), reset: true })
    },
  })
}

async function hideItem(item: Item) {
  if (!requireAuth() || !currentUser.value || discoveryChanging.value) return
  const epoch = homeAccountEpoch
  try {
    if (await setHidden(item.id, true)) { lastHiddenId.value = item.id; haptic('light') }
  } catch {
    if (epoch === homeAccountEpoch) uni.showToast({ title: t('discovery.changeFailed'), icon: 'none' })
  }
}

async function undoHidden() {
  if (!lastHiddenId.value) return
  const epoch = homeAccountEpoch
  try {
    if (await setHidden(lastHiddenId.value, false)) {
      lastHiddenId.value = ''
      currentPage.value = 0
      void fetchItems({ ...getFilterParams(), reset: true })
    }
  } catch {
    if (epoch === homeAccountEpoch) uni.showToast({ title: t('discovery.changeFailed'), icon: 'none' })
  }
}

function onRestoreHidden() {
  const epoch = homeAccountEpoch
  uni.showModal({
    title: t('discovery.restoreTitle'), content: t('discovery.restoreBody'),
    confirmText: t('discovery.restore'), cancelText: t('filter.cancel'),
    success: async ({ confirm }) => {
      if (!confirm || epoch !== homeAccountEpoch) return
      try {
        if (!(await restoreAllHidden())) return
        lastHiddenId.value = ''
        cancelFilterEdit()
        currentPage.value = 0
        void fetchItems({ ...getFilterParams(), reset: true })
      } catch {
        if (epoch === homeAccountEpoch) uni.showToast({ title: t('discovery.changeFailed'), icon: 'none' })
      }
    },
  })
}

function onFeedModeKeydown(event: KeyboardEvent, current: 'sell' | 'wanted') {
  const modes: Array<'sell' | 'wanted'> = ['sell', 'wanted']
  const index = modes.indexOf(current)
  let nextIndex = index
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % modes.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + modes.length) % modes.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = modes.length - 1
  else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    setListingType(current)
    return
  } else return

  event.preventDefault()
  setListingType(modes[nextIndex])
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  nextTick(() => tabList?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus())
}

const filteredItems = computed(() => {
  let result = displayItems.value.filter(item => !hiddenIds.value.has(item.id))

  // Safety net for the 在售/求购 tab — the search RPC doesn't filter by
  // listing_type, so narrow client-side too (the non-search path already
  // filters server-side via getFilterParams).
  result = result.filter(item => (item.listing_type || 'sell') === listingType.value)

  // Location is filtered server-side on both the regular query and search RPC.
  // Keep this client pass as a defensive fallback for older backend versions.
  if (filterLocation.value) {
    result = result.filter(item => matchesListingLocation(item.location, filterLocation.value))
  }

  return result
})

const columns = computed(() => {
  const cols: Item[][] = Array.from({ length: columnCount.value }, () => [])
  filteredItems.value.forEach((item: Item, i: number) => {
    cols[i % columnCount.value].push(item)
  })
  return cols
})

const handleWindowResize = (res: { size: { windowWidth: number } }) => {
  // At 768–959px the 240px sidebar leaves only 528–719px of content. Three
  // waterfall columns make titles, seller metadata, and badges collide, so
  // keep two columns until each of three cards can retain a useful width.
  columnCount.value = res.size.windowWidth >= 1180 ? 4 : res.size.windowWidth >= 960 ? 3 : 2
}
let windowResizeRegistered = false

function clearScrollTimers() {
  if (scrollResetTimer !== undefined) clearTimeout(scrollResetTimer)
  if (scrollRestoreTimer !== undefined) clearTimeout(scrollRestoreTimer)
  if (scrollRestoreResetTimer !== undefined) clearTimeout(scrollRestoreResetTimer)
  scrollResetTimer = undefined
  scrollRestoreTimer = undefined
  scrollRestoreResetTimer = undefined
}

function applyFilters() {
  if (filterDetailDate.value && !validListingDate(filterDetailDate.value)) {
    uni.showToast({ title: t('listingDetails.invalidDates'), icon: 'none' }); return
  }
  if (priceFilterError.value) {
    uni.showToast({ title: t(priceFilterError.value), icon: 'none' })
    return
  }
  // Store canonical values so chips and requests never carry leading zeros or
  // incidental decimal formatting (e.g. "00100.00" → "100").
  if (filterPriceMin.value) filterPriceMin.value = String(Number(filterPriceMin.value))
  if (filterPriceMax.value) filterPriceMax.value = String(Number(filterPriceMax.value))
  filterSnapshot = null
  showFilter.value = false
  restoreFilterTriggerFocus()
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), reset: true })
}

function resetFilters() {
  nearbySource.value = ''
  filterPriceMin.value = ''
  filterPriceMax.value = ''
  filterDetailDate.value = ''
  filterPriceUnit.value = ''
  filterCondition.value = ''
  filterLocation.value = ''
  sortBy.value = 'latest'
}

function onClearAllFilters() {
  resetFilters()
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), reset: true })
}

function resetHomeAccountState() {
  lastHiddenId.value = ''
  nearbyPermissionVisible.value = false
  homeAccountEpoch += 1
  clearItems()
  initialLoading.value = true
  measuredDims.value = {}
  searchText.value = ''
  selectedCategory.value = null
  currentPage.value = 0
  isRefreshing.value = false
  showFilter.value = false
  filterSnapshot = null
  resetFilters()
  listingType.value = 'sell'
  reportLoading.cancel()
}

const stopAccountTransitionListener = onAccountTransition(() => {
  resetHomeAccountState()
  // useAuth updates currentUser immediately after the transition callback on
  // sign-out, and later after profile hydration on sign-in. Enter the next
  // microtask so reloadHomeForCurrentAccount observes the new authority.
  void Promise.resolve().then(() => reloadHomeForCurrentAccount())
})
onUnmounted(() => {
  reportLoading.cancel()
  stopAccountTransitionListener()
})

async function reloadHomeForCurrentAccount() {
  const requestEpoch = homeAccountEpoch
  await awaitAuthReady()
  if (requestEpoch !== homeAccountEpoch) return

  const userId = currentUser.value?.id
  const accountToken = userId ? captureAccountRequest(userId) : null
  if (accountToken && !isAccountRequestCurrent(accountToken)) return

  if (accountToken) {
    const favReady = loadMyFavorites(accountToken.userId)
    const moderationGate = await ensureBlockedLoaded()
    if (requestEpoch !== homeAccountEpoch || !isAccountRequestCurrent(accountToken)) return
    if (!moderationGate.ok) {
      clearItems()
      fetchError.value = friendlyErrorMessage(
        new Error('moderation_gate_unavailable'),
        lang.value as 'en' | 'zh',
      )
      await favReady.catch(() => undefined)
      if (requestEpoch === homeAccountEpoch && isAccountRequestCurrent(accountToken)) initialLoading.value = false
      return
    }
    await Promise.all([
      fetchItems({ ...getFilterParams(), reset: true }),
      favReady,
    ])
    if (requestEpoch !== homeAccountEpoch || !isAccountRequestCurrent(accountToken)) return
  } else {
    await fetchItems({ ...getFilterParams(), reset: true })
    if (requestEpoch !== homeAccountEpoch) return
  }
  initialLoading.value = false
}

onMounted(async () => {
  try {
    const info = uni.getSystemInfoSync()
    columnCount.value = info.windowWidth >= 1180 ? 4 : info.windowWidth >= 960 ? 3 : 2
  } catch {}

  try {
    const onResize = (uni as any).onWindowResize
    if (typeof onResize === 'function') {
      onResize(handleWindowResize)
      windowResizeRegistered = true
    }
  } catch {}

  await reloadHomeForCurrentAccount()
})

// Release the module-scoped feed on page unload (safety net — the home tab
// rarely unloads during normal use, but this stops the items[] array from
// outliving the page when it does).
onUnload(() => {
  homeVisible = false
  homeShowEpoch += 1
  clearScrollTimers()
  if (windowResizeRegistered) {
    const offResize = (uni as any).offWindowResize
    if (typeof offResize === 'function') offResize(handleWindowResize)
    windowResizeRegistered = false
  }
  clearItems()
})

function selectCategory(category: ItemCategory | null) {
  if (category !== selectedCategory.value) { filterDetailDate.value = ''; filterPriceUnit.value = '' }
  selectedCategory.value = category
  if (hasCategoryDetails(category || undefined)) filterCondition.value = ''
  currentPage.value = 0
  fetchItems({ ...getFilterParams(), category, reset: true })
}

/*
 * Search history + focus state previously lived here as a floating
 * dropdown. Moved to /pages/search/index.vue per the refinement pass
 * so the home page isn't crowded by the recent-search pills.
 *
 * Home's search field is now a PROXY — tapping it navigateTo()'s
 * the search page, which handles recent + browse-by-category +
 * live input. The search page hands the latest typed runtime intent back to
 * onShow below. Search history remains account-private durable data; the
 * one-shot navigation intent does not.
 */
function goToSearch() {
  uni.navigateTo({ url: '/pages/search/index' })
}

function consumePendingSearch() {
  try {
    // Cleanup only for stale keys written by older app versions.
    removeAccountPrivateStorage('pending_search')
    removeAccountPrivateStorage('pending_category')
    const intent = consumeHomeNavigationIntent({
      userId: getActiveAccountId(),
      identityGeneration: captureAccountIdentityGeneration(),
    })
    if (intent?.kind === 'query') {
      // Searching refines the visible feed. Preserve its category just as we
      // preserve price/location, so date and rent-unit chips remain effective.
      searchText.value = intent.query
      onSearch()
      return
    }
    if (intent?.kind === 'category') {
      searchText.value = ''
      selectCategory(intent.category as ItemCategory)
    }
  } catch {}
}

/*
 * Lightweight history save used when home re-fires the search via
 * the debounced fetch (e.g. after the user comes back from search
 * page and we want the filtered feed to also persist the query).
 * The full recent-search surface is maintained on the search page.
 */
const SEARCH_HISTORY_MAX = 8
function saveSearch(text: string) {
  if (!text.trim()) return
  try {
    const stored = readAccountPrivateStorage<unknown>('searchHistory', '[]')
    if (!stored.allowed) return
    const raw = stored.value
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    const list: string[] = Array.isArray(parsed)
      ? parsed.filter(value => typeof value === 'string')
      : []
    const next = [text, ...list.filter((s) => s !== text)].slice(0, SEARCH_HISTORY_MAX)
    writeAccountPrivateStorage('searchHistory', JSON.stringify(next))
  } catch {}
}

const debouncedFetch = debounce(() => {
  currentPage.value = 0
  if (searchText.value.trim()) saveSearch(searchText.value.trim())
  fetchItems({ ...getFilterParams(), reset: true })
}, 300)

async function onQuickFav(item: Item) {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = homeAccountEpoch
  haptic('light')
  const result = await toggleFavorite(accountToken.userId, item.id)
  if (!result.ok || actionEpoch !== homeAccountEpoch || !isAccountRequestCurrent(accountToken)) return
  item.favorite_count = (item.favorite_count || 0) + (result.favorited ? 1 : -1)
}

function onItemCardKeydown(event: KeyboardEvent, itemId: string) {
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
  event.preventDefault()
  event.stopPropagation()
  goToDetail(itemId)
}


/* 1.5s + haptic for the home feed report flow — a thumb resting on a
   card during scroll used to fire the report action sheet at 350ms,
   which scared users away from scrolling. Tuned 3s → 2s in batch #2,
   then 2s → 1.5s in batch #3a — 2s still tested as draggy in user
   acceptance, 1.5s preserves the deliberate-intent gate while feeling
   responsive enough that holding doesn't feel like waiting. */
const cardLongPress = useLongPress<[Item]>((item) => onCardLongPress(item), 1500)

async function onCardLongPress(item: Item) {
  await awaitAuthReady()
  const actionEpoch = homeAccountEpoch
  const accountToken = currentUser.value
    ? captureAccountRequest(currentUser.value.id)
    : null
  const actionIsCurrent = () => (
    actionEpoch === homeAccountEpoch
    && (!accountToken || isAccountRequestCurrent(accountToken))
  )
  const favLabel = isFavorited(item.id) ? t('home.unsave') : t('detail.save')
  const isMine = currentUser.value?.id && item.user_id === currentUser.value.id
  const actions: string[] = [favLabel, t('home.shareItem')]
  if (!isMine) actions.push(t('discovery.notInterested'), t('report.reportItem'))
  uni.showActionSheet({
    itemList: actions,
    success: async (res) => {
      if (!actionIsCurrent()) return
      if (res.tapIndex === 0) {
        await onQuickFav(item)
      } else if (res.tapIndex === 1) {
        // #ifdef H5
        const url = `${window.location.origin}/share/${item.id}${lang.value === 'zh' ? '?lang=zh' : ''}`
        if (navigator.share) {
          navigator.share({ title: `${localize(item.title_i18n, item.title)} · ${t('app.name')}`, text: `${listingPriceLabel(item, t)} · ${localize(item.title_i18n, item.title)}`, url })
            .catch((err: any) => {
              if (err?.name !== 'AbortError') console.warn('[share] failed')
            })
        } else {
          uni.setClipboardData({ data: url })
          uni.showToast({ title: t('detail.linkCopied'), icon: 'success' })
        }
        // #endif
        // #ifndef H5
        uni.setClipboardData({
          data: `${BASE_URL}/share/${item.id}`,
          success: () => uni.showToast({ title: t('detail.linkCopied'), icon: 'success' }),
        })
        // #endif
      } else if (res.tapIndex === 2 && !isMine) {
        await hideItem(item)
      } else if (res.tapIndex === 3 && !isMine) {
        promptReportItem(item.id)
      }
    },
  })
}

async function promptReportItem(itemId: string) {
  await awaitAuthReady()
  if (!requireAuth() || !currentUser.value) return
  const accountToken = captureAccountRequest(currentUser.value.id)
  const actionEpoch = homeAccountEpoch
  const actionIsCurrent = () => actionEpoch === homeAccountEpoch && isAccountRequestCurrent(accountToken)
  const reasons = [
    t('report.reasonSpam'),
    t('report.reasonProhibited'),
    t('report.reasonMisleading'),
    t('report.reasonOther'),
  ]
  uni.showActionSheet({
    itemList: reasons,
    success: async (res) => {
      if (!actionIsCurrent()) return
      const reason = reasons[res.tapIndex]
      const loadingOwner = reportLoading.show(t('report.submitting') || t('login.wait'))
      try {
        await reportTarget('item', itemId, reason)
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

function isOldItem(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > 30 * 86400000
}

function onSearch() {
  debouncedFetch()
}

function onClearSearch() {
  searchText.value = ''
  haptic('light')
  onSearch()
}

function onScroll(e: any) {
  showBackTop.value = e.detail.scrollTop > 600
  lastScrollTop.value = e.detail.scrollTop
}

function scrollToTop() {
  clearScrollTimers()
  scrollTopVal.value = 1
  scrollResetTimer = setTimeout(() => {
    scrollResetTimer = undefined
    scrollTopVal.value = 0
  }, 50)
}

onShow(async () => {
  homeVisible = true
  const showEpoch = ++homeShowEpoch
  clearScrollTimers()
  // Wait for the authoritative account generation before consuming the
  // owner-bound runtime intent. Search history remains separately protected by
  // account-private storage.
  await awaitAuthReady()
  if (!homeVisible || showEpoch !== homeShowEpoch) return
  consumePendingSearch()
  // Refresh explicit feedback from other devices, retaining the existing feed
  // and scroll position. Failed sync does not reset a known hidden set.
  void loadHiddenItems(true).catch(() => {})
  if (lastScrollTop.value > 0) {
    const saved = lastScrollTop.value
    scrollRestoreTimer = setTimeout(() => {
      scrollRestoreTimer = undefined
      scrollTopVal.value = saved
      scrollRestoreResetTimer = setTimeout(() => {
        scrollRestoreResetTimer = undefined
        scrollTopVal.value = 0
      }, 100)
    }, 50)
  }
})

onHide(() => {
  homeVisible = false
  homeShowEpoch += 1
  clearScrollTimers()
})

onShareAppMessage(() => ({
  title: t('share.marketplace'),
  path: '/pages/index/index',
}))

onShareTimeline(() => ({
  title: t('share.marketplace'),
}))

async function loadMore(retry = false) {
  if (loading.value || !hasMore.value || (fetchError.value && retry !== true)) return
  const nextPage = currentPage.value + 1
  const loaded = await fetchItems({ ...getFilterParams(), page: nextPage })
  if (loaded) currentPage.value = nextPage
}

function retryFeed() {
  if (items.value.length) void loadMore(true)
  else void onRefresh()
}

async function onRefresh() {
  if (isRefreshing.value) return
  const refreshEpoch = homeAccountEpoch
  isRefreshing.value = true
  currentPage.value = 0
  const failsafe = setTimeout(() => {
    if (refreshEpoch === homeAccountEpoch) isRefreshing.value = false
  }, 10000)
  try {
    await fetchItems({ ...getFilterParams(), reset: true })
  } finally {
    clearTimeout(failsafe)
    if (refreshEpoch === homeAccountEpoch) isRefreshing.value = false
  }
}

function goToDetail(id: string) {
  uni.navigateTo({ url: `/pages/detail/index?id=${id}` })
}

async function goPublish() {
  const intent = { listingType: listingType.value, category: selectedCategory.value || '' } as const
  await awaitAuthReady()
  const target = `/pages/publish/index?listingType=${intent.listingType}${intent.category ? `&category=${intent.category}` : ''}`
  if (!requireAuth(target)) return
  stagePublishNavigationIntent(intent, {
    userId: getActiveAccountId(), identityGeneration: captureAccountIdentityGeneration(),
  })
  uni.switchTab({ url: '/pages/publish/index' })
}
</script>

<style lang="scss" scoped>
.discovery-controls { display: flex; align-items: center; gap: 6px; padding: 8px 12px 4px; }
.discovery-controls .discovery-mode, .discovery-undo .discovery-undo-action, .discovery-all, .discovery-restore, .card-more {
  margin: 0; border: 0; background: transparent; color: var(--text-secondary); font: inherit;
  padding: 0 10px; min-height: 44px; line-height: 1.3; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  cursor: pointer; border-radius: var(--radius-pill);
  &::after { border: 0; }
  &:active { background: var(--bg-inset); }
}
.discovery-controls .discovery-mode { font-size: 13px; white-space: nowrap; }
.discovery-controls .discovery-mode.chosen { color: var(--text-primary); font-weight: 700; background: var(--surface); }
.discovery-controls .discovery-about { margin-left: auto; width: 44px; padding: 0; }
.discovery-note { display: block; font-size: 12px; color: var(--text-muted); padding: 0 20px 8px; }
.discovery-undo { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 12px; padding: 4px 12px; background: var(--surface); border: 1px solid var(--border-hair); border-radius: var(--radius-md); color: var(--text-primary); font-size: 13px; }
.discovery-undo .discovery-undo-action, .discovery-all, .discovery-restore { color: var(--accent-primary); font-size: 13px; }
.discovery-all { display: flex; margin: 8px auto; }
.discovery-restore { display: flex; width: 100%; margin-bottom: 8px; }
.card-heading { display: flex; align-items: flex-start; gap: 2px; }
.card-heading .card-title { flex: 1; min-width: 0; }
.card-more { flex: 0 0 36px; min-height: 36px; padding: 0; margin: -6px -8px 0 0; }
.discovery-reason { display: block; font-size: 10px; line-height: 1.5; color: var(--text-muted); margin: 2px 0 5px; }
@media (pointer: coarse) { .card-more { flex-basis: 44px; min-height: 44px; } }

.card-pickup { display: flex; align-items: center; gap: 4px; min-width: 0; margin: 7px 0; }
.card-pickup-label { font-size: 12px; line-height: 1.5; color: var(--text-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search-sort-note { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.search-sort-hint { font-size: 12px; line-height: 1.6; color: var(--text-subtle); }
/* ============================================
   CAACI Marketplace Homepage
   XHS UI + Xianyu features
   ============================================ */

.page {
  height: 100vh;
  height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--bg-subtle);
  overflow: hidden;
}

/*
 * Mobile header — v5 chrome panel. Now a warm-white (--surface) sheet
 * that, together with the category rail below it, reads as one floating
 * paper block above the cream feed (kit ui_kits/marketplace .im-chrome).
 */
.mobile-header {
  flex-shrink: 0;
  /* fill + bottom hairline now come from .u-glass + .u-glass--hair-b */
  padding: 0 16px 11px;
  /* QA6 r5: +10px below the status-bar inset so the brand lockup isn't jammed
     right under the notch / Dynamic Island (Eric: "太靠顶部"). */
  padding-top: calc(var(--mp-status-bar) + 10px);
  /* #ifdef MP-WEIXIN */
  /* The capsule pill sits at statusBar+4 with a 32px height; the brand row
     must CENTER on that line or the 中|EN pill and the capsule read as two
     misaligned pills (Eric device round 2). +4 replaces the H5 +10. */
  padding-top: calc(var(--mp-status-bar) + 4px);
  /* #endif */
  z-index: 50;
}
.mh-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: var(--mp-navbar-height, 44px);
  /* QA6 #13: the 104px capsule-button reserve is mp-weixin ONLY. On H5 there's
     no capsule, so this padding was dead space on the right that shoved the
     Dk / 中·EN toggles left (Eric: "应该靠右边"). Keep for mp, drop on H5 so
     space-between anchors the toggles flush right. */
  /* #ifdef MP-WEIXIN */
  padding-right: var(--mp-navbar-right-pad, 0px);
  /* capsule-height row so its vertical center matches the capsule's */
  min-height: 32px;
  /* #endif */
  margin-bottom: 10px;
}
/* Brand lockup — 集-mark + serif wordmark + mono eyebrow. */
.mh-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mh-logo {
  width: 34px; height: 34px; border-radius: 9px;
  flex-shrink: 0; box-shadow: var(--shadow-soft);
}
.mh-wordmark-stack { display: flex; flex-direction: column; gap: 2px; line-height: 1; min-width: 0; }
.mh-wordmark {
  font-family: var(--font-serif);
  font-size: 19px; font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.012em;
  line-height: 1.1;
  /* QA6 #13: keep "Illini Market" on ONE line. Without this the flex squeeze
     (min-width:0 stack) wrapped it to two lines, which read as cramped — and
     the toggles never looked cleanly anchored right. One line + space-between
     row = brand left, Dk / 中·EN toggles flush right with breathing room. */
  white-space: nowrap;
}
.mh-eyebrow {
  font-family: var(--font-mono);
  font-size: 9px; font-weight: 500;
  letter-spacing: 0.22em; text-transform: uppercase;
  /* muted, not terracotta — the eyebrow is a quiet sub-label, not a
     second accent competing with the seal + active category pill */
  color: var(--text-subtle);
  line-height: 1;
}
/* Quick theme + 中/EN toggles. Pills on the inset surface so they read as
   controls without competing with the brand. */
.mh-actions { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
.mh-theme {
  height: 32px; padding: 0 11px;
  border-radius: var(--radius-pill);
  background: var(--surface-alt); border: 0.5px solid var(--border);
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer;
}
.mh-theme-label { font-size: 11px; font-weight: 600; color: var(--ink); line-height: 1; letter-spacing: 0.04em; }
.mh-lang {
  height: 32px; padding: 0 12px;
  border-radius: var(--radius-pill);
  background: var(--surface-alt); border: 0.5px solid var(--border);
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  .mh-lang-label { font-size: 12px; font-weight: 500; color: var(--ink-quiet); line-height: 1; }
  .on { color: var(--ink); font-weight: 600; }
  .sep { opacity: 0.35; font-size: 10px; }
}
.mh-search {
  display: flex; align-items: center; gap: 9px;
}
/* #ifdef H5 */
/* On compact phones the English wordmark and both quick controls must share
   one row without painting over each other. Keep the theme's accessible
   name when its visual label gives way to a larger touch target. */
@media (max-width: 374px) {
  .mh-row { gap: 8px; }
  .mh-brand { gap: 8px; }
  .mh-wordmark-stack { overflow: hidden; }
  .mh-wordmark { font-size: 17px; overflow: hidden; text-overflow: ellipsis; }
  .mh-eyebrow { font-size: 8px; letter-spacing: 0.12em; white-space: nowrap; }
  .mh-actions { gap: 6px; }
  .mh-theme { width: 44px; height: 44px; padding: 0; justify-content: center; }
  .mh-theme-label { display: none; }
  .mh-lang { height: 44px; padding: 0 10px; }
}
/* #endif */
/* Desktop search + filter toolbar — hidden on phones (the mobile-header
   covers those), revealed at ≥768px where the mobile-header is display:none. */
.home-desktop-tools { display: none; }
/*
 * Search field — refinement pattern: white surface, UIUC-blue hairline
 * border, navy text. The previous parchment-bg input blended into the
 * header and read as a placeholder slot; white-on-parchment reads as
 * an active input field.
 */
.search-field {
  /* Inset cream fill, not white — on the white header a white field
     vanished and read as empty space. The 1-step-deeper surface makes
     it read as a tappable search slot. */
  flex: 1; display: flex; align-items: center;
  background: var(--surface-alt);
  border: 0.5px solid var(--border-hair);
  border-radius: var(--radius-md);
  padding: 10px 13px;
  gap: 8px;
}
.sf-clear {
  width: 18px; height: 18px; border-radius: 50%; background: var(--ink-faint);
  color: #fff; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.filter-btn {
  /* Labeled pill — the bare decreasing-lines glyph read as decoration,
     not as a tappable filter entry (2026-06 meeting feedback). */
  position: relative; height: 40px; padding: 0 13px; gap: 6px;
  border-radius: var(--radius-md);
  background: var(--surface-alt);
  border: 0.5px solid var(--border-hair);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; cursor: pointer;
  &:active { background: var(--bg-inset); }
}
.fb-label { font-size: 12px; font-weight: 500; color: var(--text-secondary); line-height: 1; }
.fb-badge {
  position: absolute; top: 1px; right: 1px;
  width: 15px; height: 15px; border-radius: 50%;
  background: var(--accent-action); color: var(--ink-inverse); font-size: 9px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}

/*
 * Category rail — the horizontal pill scroll from the marketplace/
 * kit's HomeScreen.jsx. The prior 4×3 circle grid + tall hero ate
 * more than 400px of vertical space; this compact rail keeps the
 * fold to ~50px and lets products breathe above the fold. Matches
 * how Xianyu / Taobao / Xiaohongshu handle category navigation on
 * feed pages.
 */
/* 在售 / 求购 segmented control — compact pill pair on the surface header. */
.marketplace-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; background: var(--surface); padding-right: 16px; }
.feed-publish { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 0 14px; border-radius: var(--radius-pill); background: var(--brand); color: var(--ink-inverse); font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.feed-mode {
  flex-shrink: 0;
  display: flex; gap: 6px;
  /* QA6 #5 — the On sale / Wanted toggle sat too close to the search bar.
     A little more top breathing room (desktop bumps further, below). */
  padding: 10px 16px 8px;
  background: var(--surface);
}
.fm-seg {
  display: inline-flex; align-items: center; justify-content: center;
  height: 30px; padding: 0 16px;
  border-radius: var(--radius-pill);
  background: var(--surface-alt);
  cursor: pointer;
  .fm-seg-label { font-size: 12.5px; font-weight: 600; color: var(--ink-quiet); letter-spacing: 0.02em; }
  &.on {
    background: var(--brand-soft);
    .fm-seg-label { color: var(--brand-on-soft); }
  }
}
.cat-bar {
  flex-shrink: 0;
  padding: 8px 16px 10px;
  background: var(--surface);
  border-bottom: 0.5px solid var(--border-hair);
  white-space: nowrap;
}
.cat-bar-inner {
  display: inline-flex;
  gap: 6px;
  padding-right: 16px;
}
.cat-tab-spacer {
  display: inline-block;
  width: 80rpx;
  flex-shrink: 0;
  pointer-events: none;
}
/* Editorial text-tag rail (kit .im-cat-pill): quiet type, no chrome; the
   active one becomes an ink stamp. Print, not plastic. */
.pill {
  display: inline-flex; align-items: center; justify-content: center;
  height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  font-size: 12.5px;
  color: var(--ink-quiet);
  background: transparent;
  border: 0;
  transition: transform 0.15s, color 0.15s; cursor: pointer; font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  box-sizing: border-box;
  flex-shrink: 0;
  /* Color must live on the <text> child, not just the view — the global
     mp-weixin `text {}` floor in App.vue beats inherited color, which made
     the active pill label invisible (ink-on-ink). */
  .pill-label { color: var(--ink-quiet); }
  &.active {
    background: var(--ink);
    color: var(--ink-inverse);
    font-weight: 600;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
    .pill-label { color: var(--ink-inverse); }
  }
  &:active { transform: scale(0.93); }
}

// Larger touch targets without making the phone header taller. Localized
// labels also leave more categories visible in the horizontal rail.
@media (max-width: 767px), (pointer: coarse) {
  .marketplace-actions { padding-top: 10px; padding-bottom: 8px; gap: 8px; }
  .feed-mode { padding-top: 0; padding-bottom: 0; padding-right: 0; gap: 4px; }
  .fm-seg { height: 44px; }
  .feed-publish { min-height: 44px; padding: 0 12px; }
  .cat-bar { padding-top: 4px; padding-bottom: 8px; }
  .pill { height: 44px; }
}
@media (max-width: 390px) {
  .fm-seg { padding: 0 12px; }
  .feed-publish { font-size: 12px; gap: 4px; padding: 0 10px; }
}

/* ========== Filter Bottom Sheet ========== */
/* z-index must be higher than .tabbar (999) — otherwise the tabbar
   floats above the sheet and covers the "Apply" button. Mask sits
   just below the sheet but still above the tabbar so it dims it too. */
.filter-mask {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 1000;
  background: rgba(0,0,0,0.35);
}
.filter-sheet {
  position: fixed;
  bottom: 0; left: 0; right: 0; z-index: 1001;
  background: var(--surface);
  box-shadow: var(--shadow-pop);
  border-radius: 18px 18px 0 0;
  padding: 0 20px 20px;
  max-height: 70vh;
  /* A visual-only keyboard resize does not change vh/dvh. Keep the entire
     scroll area inside the visible viewport, including when Safari pans it. */
  max-height: min(70vh, max(0px, calc(var(--filter-visible-height, 100vh) - 16px)));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.fs-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 0 14px;
  position: sticky; top: 0; background: var(--surface); z-index: 1;
  gap: 12px;
}
.fs-close {
  width: 44px; height: 44px; border-radius: 50%; background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  &:active { background: var(--bg-inset); }
}
.fs-x {
  width: 12px; height: 12px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 12px; height: 1.5px; background: var(--text-secondary); border-radius: 1px;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
}
.fs-title { flex: 1; font-size: 17px; font-weight: 700; color: var(--ink); text-align: center; letter-spacing: -0.01em; }
.fs-reset { font-size: 14px; color: var(--accent-action); cursor: pointer; flex-shrink: 0; min-height: 44px; display: flex; align-items: center; }

/*
 * Semester / move-out banner — kit ink-editorial card (index_v1.html
 * .card.feature + components-banners.html "ghosted I"). Ink fill, a
 * mono brand stamp in campus-orange, serif title in ink-inverse, and
 * a ghosted serif "I" arc bleeding off the right edge as the brand
 * accent. Replaces the prior off-system blue→orange gradient.
 */
/* Semester / move-out banner — terracotta gradient (kit .im-semester-banner).
   One of only two gradients allowed in the system; cream text, a ghosted
   serif "I" watermark, and inset paper-edge highlights for depth. */
.semester-banner {
  position: relative;
  overflow: hidden;
  display: flex; align-items: center; gap: var(--space-3);
  margin: var(--space-3) var(--space-3) var(--space-1);
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  background: linear-gradient(120deg, #B8432B 0%, #A03A24 100%);
  color: #FBF8F2;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.14) inset,
    0 -1.5px 0 rgba(0, 0, 0, 0.12) inset,
    0 6px 16px -8px rgba(160, 58, 36, 0.45);
  cursor: pointer;
}
/* Existing brand asset, cream-ghosted on terracotta. */
.seb-arc {
  position: absolute; right: -12px; top: -24px;
  width: 112px; height: 112px;
  opacity: 0.1;
  pointer-events: none;
}
.seb-body {
  position: relative;
  flex: 1; display: flex; flex-direction: column; gap: 3px;
  min-width: 0;
}
/* Mono eyebrow stamp — cream override of the global .t-eyebrow (which
   defaults to --ink-quiet, unreadable on terracotta). */
.seb-stamp {
  color: rgba(255, 255, 255, 0.92);
  margin-bottom: 2px;
}
.seb-title {
  font-family: var(--font-serif);
  font-size: 15px; font-weight: 600;
  color: #FBF8F2;
  letter-spacing: -0.005em;
  line-height: 1.2;
}
.seb-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.4;
}
.seb-arrow {
  position: relative;
  color: rgba(255, 255, 255, 0.85);
  flex-shrink: 0;
}

.active-filter-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px 8px;
  background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
}
.afb-scroll { flex: 1; white-space: nowrap; overflow: hidden; }
.afb-chip {
  display: inline-flex; align-items: center;
  padding: 5px 11px; margin-right: 6px; border-radius: 14px;
  background: rgba(199,74,47,0.08); cursor: pointer;
  .afb-chip-label { font-size: 12px; color: var(--accent-action); font-weight: 500; }
  &:active { background: rgba(199,74,47,0.16); }
}
.afb-clear {
  padding: 5px 10px; border-radius: 14px;
  background: var(--bg-subtle); cursor: pointer; flex-shrink: 0;
  .afb-clear-label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
  &:active { background: var(--bg-inset); }
}
.fs-section { margin-bottom: 18px; }
.fs-label { font-size: 13px; color: var(--ink-quiet); margin-bottom: 10px; display: block; }
.fs-price-row { display: flex; align-items: center; gap: 10px; }
.fs-price-input {
  flex: 1; display: flex; align-items: center;
  background: var(--bg-subtle); border-radius: 10px; padding: 10px 12px; gap: 4px;
  border: 1px solid transparent;
  .fs-price-field { flex: 1; font-size: 15px; color: var(--ink); background: transparent; font-family: var(--font-serif); letter-spacing: -0.01em; }
  &.invalid { border-color: var(--danger); }
}
.fs-dollar { font-size: 15px; color: var(--ink-quiet); font-weight: 600; }
.fs-dash { color: var(--ink-faint); font-size: 16px; }
.fs-error {
  display: block; margin-top: 8px;
  color: var(--danger); font-size: 12px; line-height: 1.4;
}
.fs-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.fpill {
  padding: 7px 15px; border-radius: 8px;
  font-size: 13px; color: var(--text-secondary); background: var(--bg-subtle);
  cursor: pointer; transition: all 0.15s; font-weight: 500;
  /* Color must live on the <text> child, not just the view — the global
     `text {}` floor in App.vue beats inherited color, which made the
     active chip label invisible (ink-on-ink) in both themes. Same fix
     the category `.pill` already carries. */
  .fpill-label { color: var(--text-secondary); }
  &.active { background: var(--ink); color: var(--ink-inverse); .fpill-label { color: var(--ink-inverse); } }
}
/* Even though the sheet wins z-index (1001 > 999 on tabbar), the apply
   button visually coincided with the tabbar row, creating a jarring
   double-control illusion. Physical clearance (= tabbar height) fixes it
   on mobile. Desktop has no tabbar so the base padding is enough. */
.fs-footer { padding-top: 10px; padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px)); }
@media (max-width: 767px) {
  .fs-footer { padding-bottom: calc(18px + 56px + env(safe-area-inset-bottom, 0px)); }
}
.fs-apply {
  width: 100%; padding: 14px; border-radius: var(--radius-pill);
  background: var(--accent-primary); color: var(--ink-inverse); font-size: 15px; font-weight: 600;
  text-align: center; cursor: pointer;
  box-shadow: var(--shadow-cta);
  &:active { opacity: 0.85; }
  &.disabled { opacity: 0.48; box-shadow: none; }
}

/* ========== Feed ========== */
.feed { flex: 1; min-height: 0; padding-bottom: calc(70px + env(safe-area-inset-bottom, 0px)); }

/* ========== Waterfall ========== */
.waterfall { display: flex; padding: 10px 10px 54px; gap: 10px; }
/* min-width:0 — flex items floor at min-width:auto (= content size), and on
   mp the <image> wrapper's content width kept both columns at full viewport
   width, pushing column 2 off-screen. H5's engine sized the raw <img>
   differently so it never showed there. */
.wf-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }

/* ========== Card ==========
   New visual language: slightly larger radius + soft elevation shadow
   matches the campus-market mock. The shadow color uses warm neutrals
   (brown-tinted alpha) instead of cool grey so it blends into the
   cream page background without a muddy halo. */
.card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  border: 0.5px solid var(--border);
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform 0.1s, box-shadow 0.15s;
  /* one-shot fade+rise entrance via global .u-rise (App.vue) */
  &:active { transform: scale(0.98); }
}
/* Xiaohongshu waterfall: each <img> carries an inline aspect-ratio
   driven by items.image_dimensions (migration 014), so the box
   reserves slot-accurate space on first paint — no CLS while the
   real image decodes. Missing dims fall back to 4/5 via
   dimsToAspectStyle. object-fit: contain is the safety net for
   freak clamped ratios. */
.card-img-box {
  position: relative; width: 100%;
  background: var(--surface-alt);
  overflow: hidden;
  min-height: 120px;
}
.card-img {
  width: 100%;
  display: block;
  object-fit: contain;
  transition: filter 0.2s;
  &.card-img-sold { filter: grayscale(1) brightness(0.85); }
}
/* Photoless tile + card entrance now come from the global v6 primitives
   (.u-thumb-ph / .u-thumb-ph-seal / .u-rise in App.vue) so every surface
   stays identical. */
.sold-overlay {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  padding: 6px 14px; border-radius: 6px;
  background: rgba(0,0,0,0.6);
  .sold-overlay-label { color: #fff; font-size: 13px; font-weight: 700; letter-spacing: 1px; }
}
.img-count-badge {
  position: absolute; top: 7px; right: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 2px 7px; border-radius: 10px;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  /* line-height 1 + flex centering — inherited body line-height made the
     digit sit visibly below the pill's optical center. */
  .img-count-label { color: #fff; font-size: 10px; font-weight: 600; line-height: 1; }
}
/* Condition pill visual lives in components/UBadge.vue now; the page only
   owns its placement (top-left over the card image). */
.card-cond-badge { position: absolute; top: 7px; left: 7px; }
/* Safe-zone "verified pickup spot" badge — bottom-left, green to signal trust.
   Placed opposite to .img-count-badge (top-right) and .badge (top-left) so it
   never collides with either. */
.badge-safe-corner {
  position: absolute; bottom: 7px; left: 7px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px 2px 5px; border-radius: 10px;
  background: var(--success);
}
/* tier-2: GPS shared but no recognized safe spot — muted, no verified icon */
.badge-safe-corner--shared { background: rgba(0, 0, 0, 0.55); padding-left: 7px; }
.bsc-check { width: 10px !important; height: 10px !important; color: var(--ink-inverse); }
.bsc-label { font-size: 10px; color: var(--ink-inverse); font-weight: 600; line-height: 1; }
.card-time {
  font-size: 10px; color: var(--text-subtle);
  flex-shrink: 0; white-space: nowrap;
}
.old-tag { font-size: 10px; color: var(--text-subtle); margin-right: 2px; }

.card-info { padding: 11px 12px 13px; }
.card-title {
  font-size: 13px; color: var(--text-primary); line-height: 1.35; font-weight: 400;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: normal; overflow-wrap: break-word;
}
.card-price-row { display: flex; align-items: baseline; gap: 4px; margin-top: 5px; }
/* Waterfall card price in Fraunces serif + terracotta — matches the
   米白书院 "price is the only confident number on the page" rule.
   Free items shift to sage so "免费 / Free" reads as positive state. */
.card-price {
  font-family: var(--font-serif);
  font-size: 17px; font-weight: 600;
  color: var(--brand);
  letter-spacing: -0.01em;
  line-height: 1;
  font-feature-settings: 'tnum';
}
.card-price-free { color: var(--success); }
/* wanted budget — campus-blue (the wanted/ISO accent), not terracotta. */
.card-price-wanted { color: var(--campus-blue); font-size: 14px; }
/* OBO chip — amber-toned warning pill, ivory_academy pattern. */
.obo-tag {
  font-size: 9px; font-weight: 600;
  color: var(--warning-text);
  background: var(--warning-soft);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* The seller cell gets ~80px on a 390px two-column card, and the Illini pill
   inside it cannot shrink — so whatever was left shrinkable got cut mid-glyph
   ("4.0/5" painted as "4"). The row wraps instead, which only happens when one
   line genuinely cannot hold both groups. */
.card-bottom {
  display: flex; flex-direction: column; align-items: stretch; gap: 2px; margin-top: 7px; min-width: 0;
}
.card-seller {
  display: flex; align-items: center; gap: 5px;
  flex: 1 1 auto; min-width: 0; min-height: 24px; overflow: hidden;
}
.seller-pic { width: 16px; height: 16px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.seller-nick {
  flex: 1 1 auto; min-width: 0;
  font-size: 11px; color: var(--text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.seller-rating {
  flex: 0 0 auto;
  font-size: 11px; color: var(--brand); font-weight: 600;
  white-space: nowrap;
}
/* Illini = the one server-truth trust signal (set from an @illinois.edu email,
   not user-editable). Promoted from a 13px ✓ circle that read as decoration to
   a labeled blue pill so it's legible at the browsing moment. */
.card-illini { flex-shrink: 0; }
.card-fav {
  display: flex; align-items: center; gap: 4px;
  flex: 0 0 auto; min-width: 0; padding: 0; width: 100%;
}
.card-fav .card-time { margin-right: auto; }
.card-save { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; margin: 0 -8px 0 0; flex-shrink: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
.card-save::after { border: 0; }
.card-save:active { background: var(--bg-inset); }
/* Nested controls must not shrink the whole listing under the finger. */
.card:active { transform: none; }
.heart-img {
  width: 18px; height: 18px; cursor: pointer;
  transition: transform 0.15s;
  &:active { transform: scale(1.25); }
}
.fav-num { font-size: 10px; color: var(--text-subtle); }

@media (max-width: 479px) {
  /* The date already communicates age on narrow waterfall cards; dropping
     the redundant "Old" label keeps the fixed date+heart group collision-free. */
  .old-tag { display: none; }
}

/* ========== Skeleton ========== */
.skeleton-card { pointer-events: none; }
.sk-img { background: var(--bg-inset); }
.sk-body { padding: 10px; }
.sk-line {
  height: 10px; background: var(--bg-inset); border-radius: 5px; margin-bottom: 8px;
  animation: shimmer 1.5s ease-in-out infinite;
}
.sk-line.w60 { width: 60%; }
.sk-line.w40 { width: 40%; flex: 1; }
.sk-row { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.sk-circle {
  width: 18px; height: 18px; border-radius: 50%; background: var(--bg-inset); flex-shrink: 0;
  animation: shimmer 1.5s ease-in-out infinite;
}
@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* ========== States ========== */
.tip {
  display: flex; align-items: center; justify-content: center;
  /* was #bbb (~2.3:1 on cream — fails WCAG AA). --ink-soft is 6.4:1. */
  padding: 20px; gap: 8px; color: var(--ink-soft); font-size: 12px;
}
.dots {
  display: flex; gap: 2px;
  .dot {
    animation: blink 1.4s infinite both; font-size: 20px; color: var(--accent-action);
    &.dot-2 { animation-delay: 0.2s; }
    &.dot-3 { animation-delay: 0.4s; }
  }
}
@keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
.divider { width: 28px; height: 1px; background: var(--border); }

.empty {
  display: flex; flex-direction: column; align-items: center; padding-top: 80px; gap: 8px;
}
.empty-title { font-size: 16px; color: var(--ink); font-weight: 600; }
.empty-sub { font-size: 13px; color: var(--ink-quiet); text-align: center; padding: 0 32px; }
.empty-btn {
  margin-top: 18px; padding: 11px 32px;
  background: var(--accent-primary); color: var(--ink-inverse); border-radius: 22px;
  font-size: 14px; font-weight: 600; cursor: pointer;
  &:active { opacity: 0.8; }
}

.back-top {
  position: fixed; right: 16px; bottom: calc(116px + env(safe-area-inset-bottom, 0px));
  width: 40px; height: 40px; border-radius: 50%;
  /* Theme-adaptive warm glass: --surface-rgb flips per theme, so dark mode
     gets a graphite translucent disc instead of a glaring white one. Keeps
     the tighter --shadow-pop (a 40px FAB wants a crisp lift, not the diffuse
     chrome drop). mp-weixin (no backdrop-filter) still reads on the solid. */
  background: rgba(var(--surface-rgb), 0.72); box-shadow: var(--shadow-pop);
  backdrop-filter: saturate(180%) blur(16px); -webkit-backdrop-filter: saturate(180%) blur(16px);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 100;
  &:active { transform: scale(0.9); }
}
.bt-arrow {
  width: 10px; height: 10px;
  border-left: 2px solid var(--accent-primary); border-top: 2px solid var(--accent-primary);
  transform: rotate(45deg); margin-top: 3px;
}

.result-count {
  padding: 4px 16px 8px; font-size: 12px; color: var(--text-muted);
}

/*
 * Search proxy field — tapping anywhere on this bar navigates to
 * /pages/search/index. No native input; the visible text is either
 * the placeholder or the last search query (static label).
 */
.search-proxy { cursor: pointer; }
.sf-placeholder {
  flex: 1;
  font-size: 13px;
  color: var(--ink-quiet);
  letter-spacing: 0.02em;
  line-height: 1.4;
}
.sf-text {
  flex: 1;
  font-size: 13px;
  color: var(--ink);
  letter-spacing: 0.02em;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ============================================
   DESKTOP >= 768px
   ============================================ */
/* #ifdef H5 */
@media (min-width: 768px) {
  /* Sidebar reserves the left rail (.has-sidebar in App.vue); the feed
     fills the remaining column instead of centering at 1120px. */
  .mobile-header { display: none; }

  /* Desktop search + filter row sits at the top of the content column,
     aligned to the same 24px gutter as the cat-bar / waterfall. */
  .home-desktop-tools {
    display: flex; align-items: center; gap: 10px;
    padding: 18px 24px 4px;
  }
  .home-desktop-tools .search-field { flex: 1; min-width: 0; }

  .feed-mode { padding-top: 14px; }
  .cat-bar { padding: 20px 24px 12px; }
  .pill { padding: 7px 20px; font-size: 14px; height: 32px; }

  .feed { flex: 1; min-height: 0; padding-bottom: 0; }
  .waterfall { padding: 10px 24px; gap: 10px; padding-bottom: 10px; }
  .wf-col { gap: 10px; }

  .card {
    transition: transform 0.15s, box-shadow 0.15s;
    &:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(42, 42, 46, 0.08); }
    &:active { transform: scale(0.99); }
  }
  /*
   * Desktop cards are ~370px wide. The inline aspect-ratio from
   * image_dimensions already reserves correct height on first paint;
   * we only need a soft safety cap for freakishly tall uploads (e.g.
   * full-phone screenshots) so one rogue card can't sink the column.
   * 1200px is ~3× the card width — permissive enough that normal
   * portraits (4:5, 3:4, 2:3) render uncropped.
   */
  .card-img-box {
    max-height: 1200px;
    background: var(--bg-subtle);
    overflow: hidden;
  }
  .card-img {
    max-height: 1200px;
    width: 100%;
    object-fit: contain;
  }
  .card-info { padding: 10px 12px 12px; }
  .card-title { font-size: 14px; }
  .card-price { font-size: 18px; }
  .seller-pic { width: 20px; height: 20px; }
  .seller-nick { font-size: 12px; }
  .fav-num { font-size: 12px; }

  /* Center the filter sheet within the content column, right of the rail. */
  .filter-sheet { max-width: 480px; left: var(--sidebar-w); right: 0; margin-left: auto; margin-right: auto;
  }
}
/* #endif */
</style>
