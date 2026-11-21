<template>
  <view class="page secondary-page secondary-page--catalog has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifdef H5 -->
    <AppSidebar current="profile" />
    <!-- #endif -->
    <view class="secondary-content">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <UIcon name="chevron-left" size="xs" color="accent-primary" />
      </view>
      <text class="header-title" role="heading" aria-level="1">{{ t(TITLE_KEY[view]) }}</text>
    </view>

    <!-- SPEC 6.9: 我的收藏 has two kinds. Saved listings are the page next door. -->
    <view v-if="view === 'saved'" class="tabs" role="tablist" :aria-label="t('profile.savedSection')">
      <view class="tab" role="tab" tabindex="0" aria-selected="false" data-test="saved-items"
        @click="goSavedItems" @keydown.enter.prevent="goSavedItems" @keydown.space.prevent="goSavedItems">
        <text>{{ t('profile.savedItems') }}</text>
      </view>
      <view class="tab active" role="tab" tabindex="0" aria-selected="true">
        <text>{{ t('profile.savedTopics') }}</text>
      </view>
    </view>

    <view v-if="loading" class="empty" aria-busy="true">
      <text class="empty-text">{{ t('home.loading') }}</text>
    </view>
    <view v-else-if="loadError" class="empty" role="alert" aria-live="assertive">
      <text class="empty-text">{{ t('error.loadFailed') }}</text>
      <view class="retry" role="button" tabindex="0" @click="load" @keydown.enter.prevent="load" @keydown.space.prevent="load">{{ t('home.retry') }}</view>
    </view>
    <view v-else-if="rows.length === 0" class="empty" data-test="topic-rows-empty">
      <text class="empty-text">{{ t(EMPTY_KEY[view]) }}</text>
    </view>
    <view v-else class="rows" data-test="topic-rows">
      <view
        v-for="row in rows"
        :key="row.id"
        class="row"
        role="button"
        tabindex="0"
        :aria-label="topicRowTitle(row)"
        @click="openTopic(row.id)"
        @keydown.enter.prevent="openTopic(row.id)"
        @keydown.space.prevent="openTopic(row.id)"
      >
        <text class="row-title">{{ topicRowTitle(row) }}</text>
        <view class="row-meta">
          <text v-if="row.hidden" class="row-tag">{{ t('profile.hiddenTag') }}</text>
          <text v-if="row.category" class="row-meta-t">{{ t(`plaza.category.${row.category}`) }}</text>
          <text class="row-meta-t">{{ formatTime(row.created_at) }}</text>
        </view>
      </view>
    </view>
    </view>
  </view>
</template>

<script setup lang="ts">
/*
 * P3.2 (SPEC 6.9): the member's own topic lists. One page, three views chosen
 * by ?view=: mine (my topics, hidden ones included and tagged), watched, and
 * saved. It reloads every time it is shown, so a watch or a save changed on a
 * topic page is reflected as soon as the member comes back.
 */
// #ifdef H5
import AppSidebar from '../../components/AppSidebar.vue'
// #endif
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, onUnmounted } from 'vue'
import { onLoad, onShow, onHide } from '@dcloudio/uni-app'
import UIcon from '../../components/UIcon.vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { onAccountTransition } from '../../composables/accountScope'
import { useTopicLists, topicRowTitle, type TopicListRow } from '../../composables/useTopicLists'
import { formatTime, navigateBackOr } from '../../utils'
import { captureException } from '../../utils/sentry'

type View = 'mine' | 'watched' | 'saved'
const VIEWS: View[] = ['mine', 'watched', 'saved']
const TITLE_KEY: Record<View, string> = {
  mine: 'profile.myTopics',
  watched: 'profile.watchedTopics',
  saved: 'profile.savedSection',
}
const EMPTY_KEY: Record<View, string> = {
  mine: 'profile.noMyTopics',
  watched: 'profile.noWatchedTopics',
  saved: 'profile.noSavedTopics',
}

const { t } = useI18n()
const { currentUser, awaitAuthReady, requireAuth } = useAuth()
const { fetchMarkedTopics, fetchOwnTopics } = useTopicLists()

const view = ref<View>('mine')
const rows = ref<TopicListRow[]>([])
const loading = ref(true)
const loadError = ref(false)
let loadEpoch = 0

onLoad((query) => {
  const requested = String((query as Record<string, string> | undefined)?.view || '')
  if (VIEWS.includes(requested as View)) view.value = requested as View
})
let pageVisible = false
onShow(() => {
  pageVisible = true
  void load()
})
onHide(() => { pageVisible = false })

// Another account's lists must not stay on screen across a sign-in change, and an empty list
// must not stand in for the next account's: the page is loading until it has read that account's
// rows. It reads them now when it is the page on screen, and on its next show otherwise.
const stopAccountTransitionListener = onAccountTransition(() => {
  loadEpoch += 1
  rows.value = []
  loadError.value = false
  loading.value = true
  if (pageVisible) void Promise.resolve().then(load)
})
onUnmounted(() => {
  pageVisible = false
  loadEpoch += 1
  stopAccountTransitionListener()
})

async function load() {
  await awaitAuthReady()
  if (!requireAuth(undefined, 'reLaunch') || !currentUser.value) return
  const userId = currentUser.value.id
  const epoch = ++loadEpoch
  loading.value = rows.value.length === 0
  loadError.value = false
  try {
    const next = view.value === 'mine'
      ? await fetchOwnTopics(userId)
      : await fetchMarkedTopics(userId, view.value === 'saved' ? 'save' : 'watch')
    if (epoch !== loadEpoch) return
    rows.value = next
  } catch (err) {
    if (epoch !== loadEpoch) return
    loadError.value = true
    captureException(err, { tags: { source: 'my-topics.load' }, level: 'warning' })
  } finally {
    if (epoch === loadEpoch) loading.value = false
  }
}

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }
function goSavedItems() { uni.redirectTo({ url: '/pages/my-items/index?tab=saved' }) }
// A hidden topic opens too: its page shows the author their own text under a general notice, and no reason.
function openTopic(id: string) { uni.navigateTo({ url: `/pages/post/index?id=${encodeURIComponent(id)}` }) }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); flex: 1; }
.tabs {
  display: flex; gap: 8px; padding: 10px 16px;
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.tab {
  display: flex; align-items: center; min-height: 32px; padding: 0 14px; border-radius: 16px;
  background: var(--bg-subtle); color: var(--text-secondary); font-size: 13px; cursor: pointer;
  &.active { background: var(--accent-primary); color: var(--ink-inverse); }
}
.empty { display: flex; flex-direction: column; align-items: center; padding-top: 120px; gap: 12px; }
.empty-text { font-size: 14px; color: var(--text-subtle); }
.retry {
  min-height: 44px; padding: 0 20px; border-radius: var(--radius-pill);
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-primary); color: var(--ink-inverse); font-size: 14px; font-weight: 600;
}
.row {
  display: flex; flex-direction: column; gap: 4px; min-height: 44px; box-sizing: border-box;
  padding: 12px 16px; background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair); cursor: pointer;
  &:active { background: var(--bg-elev-2); }
}
.row-title {
  font-size: 15px; font-weight: 500; line-height: 22px; color: var(--text-primary);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.row-meta { display: flex; align-items: center; gap: 8px; }
.row-meta-t { font-size: 12px; line-height: 16px; color: var(--text-muted); }
.row-tag {
  font-size: 12px; line-height: 16px; padding: 0 6px; border-radius: 4px;
  background: var(--warning-soft); color: var(--ink);
}
</style>
