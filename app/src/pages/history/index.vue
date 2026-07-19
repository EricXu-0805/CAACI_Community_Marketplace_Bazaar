<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ t('profile.history') }}</text>
      <text v-if="historyReady && currentList.length > 0" class="clear-btn" role="button" @click="onClear">{{ t('filter.reset') }}</text>
    </view>

    <view class="tabs" role="tablist" :aria-label="t('profile.history')">
      <view
        :class="['tab', { active: tab === 'items' }]"
        role="tab"
        :tabindex="tab === 'items' ? 0 : -1"
        :aria-selected="tab === 'items' ? 'true' : 'false'"
        aria-controls="history-items-panel"
        @click="tab = 'items'"
        @keydown="onHistoryTabKeydown($event, 'items')"
      >
        <text>{{ t('history.tabItems') }}</text>
        <text v-if="historyReady && history.length > 0" class="tab-count">{{ history.length }}</text>
      </view>
      <view
        :class="['tab', { active: tab === 'posts' }]"
        role="tab"
        :tabindex="tab === 'posts' ? 0 : -1"
        :aria-selected="tab === 'posts' ? 'true' : 'false'"
        aria-controls="history-posts-panel"
        @click="tab = 'posts'"
        @keydown="onHistoryTabKeydown($event, 'posts')"
      >
        <text>{{ t('history.tabPosts') }}</text>
        <text v-if="historyReady && postHistory.length > 0" class="tab-count">{{ postHistory.length }}</text>
      </view>
    </view>

    <view v-if="historyReady && currentList.length === 0" class="empty">
      <UEmptyArt name="history" />
      <text>{{ t('history.empty') }}</text>
    </view>

    <view v-else-if="historyReady && tab === 'items'" id="history-items-panel" class="items u-stagger" role="tabpanel">
      <view
        v-for="item in history"
        :key="item.id"
        class="item-row u-rise"
        role="button"
        :aria-label="localize(item.title_i18n, item.title)"
        aria-keyshortcuts="Shift+F10 Delete"
        @click="goDetail(item.id)"
        @keydown="onHistoryCardKeydown($event, item.id, 'item')"
        @longpress="onRemoveOne(item.id, 'item')"
      >
        <image v-if="thumbUrl(item.images?.[0], 'list')" :src="thumbUrl(item.images?.[0], 'list')" :alt="item.title" class="item-img" mode="aspectFill" lazy-load />
        <view v-else class="item-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal sm">集</text></view>
        <view class="item-info">
          <text class="item-title">{{ localize(item.title_i18n, item.title) }}</text>
          <view class="item-price-row">
            <text v-if="item.listing_type === 'wanted'" class="u-wanted-tag">{{ t('item.wanted') }}</text>
            <text class="item-price">{{ listingPriceLabel(item, t) }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-else-if="historyReady" id="history-posts-panel" class="items u-stagger" role="tabpanel">
      <view
        v-for="p in postHistory"
        :key="p.id"
        class="post-row u-rise"
        role="button"
        :aria-label="p.content"
        aria-keyshortcuts="Shift+F10 Delete"
        @click="goPostDetail(p.id)"
        @keydown="onHistoryCardKeydown($event, p.id, 'post')"
        @longpress="onRemoveOne(p.id, 'post')"
      >
        <UAvatar :src="p.profile?.avatar_url" :owner="p.user_id" :fallback="defaultAvatarSrc" :alt="p.profile?.nickname || 'avatar'" class="post-avatar" lazy />
        <view class="post-info">
          <view class="post-top">
            <text class="post-name">{{ p.profile?.nickname || t('app.user') }}</text>
            <text v-if="p.is_official" class="post-official">{{ t('plaza.official') }}</text>
          </view>
          <text class="post-content">{{ p.content }}</text>
          <view v-if="p.images && p.images.length > 0" class="post-imgs">
            <image
              v-for="(img, i) in p.images.slice(0, 3)"
              :key="i"
              :src="img"
              :alt="'Post photo'"
              class="post-thumb"
              mode="aspectFill"
              lazy-load
            />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useHistory } from '../../composables/useHistory'
import { useTheme } from '../../composables/useTheme'
import { useAuth } from '../../composables/useAuth'
import { listingPriceLabel, navigateBackOr, thumbUrl } from '../../utils'
import UAvatar from '../../components/UAvatar.vue'
import UEmptyArt from '../../components/UEmptyArt.vue'
import UIcon from '../../components/UIcon.vue'
import { onAccountTransition } from '../../composables/accountScope'

const { t, localize } = useI18n()
const { awaitAuthReady } = useAuth()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const {
  history,
  postHistory,
  removeFromHistory,
  removePostFromHistory,
  clearHistory,
  clearPostHistory,
} = useHistory()

const tab = ref<'items' | 'posts'>('items')
const historyReady = ref(false)
const currentList = computed(() => tab.value === 'items' ? history.value : postHistory.value)
let historyActionEpoch = 0
let historyReadyEpoch = 0
let pageMounted = true

async function revealReconciledHistory() {
  const readyEpoch = ++historyReadyEpoch
  await awaitAuthReady()
  if (!pageMounted || readyEpoch !== historyReadyEpoch) return
  historyReady.value = true
}

const stopAccountTransitionListener = onAccountTransition(() => {
  // The storage owner transition already clears the history singleton. This
  // epoch also invalidates action-sheet/modal callbacks opened by the previous
  // owner so they cannot delete history created by the next owner.
  historyActionEpoch += 1
  historyReadyEpoch += 1
  historyReady.value = false
  if (pageMounted) void Promise.resolve().then(revealReconciledHistory)
})
onMounted(() => { void revealReconciledHistory() })
onUnmounted(() => {
  pageMounted = false
  historyReadyEpoch += 1
  stopAccountTransitionListener()
})

function onHistoryTabKeydown(event: KeyboardEvent, current: 'items' | 'posts') {
  const order: Array<'items' | 'posts'> = ['items', 'posts']
  let nextIndex = order.indexOf(current)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (nextIndex + 1) % order.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (nextIndex - 1 + order.length) % order.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = order.length - 1
  else return
  event.preventDefault()
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  tab.value = order[nextIndex]
  nextTick(() => tabList?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus())
}

function onHistoryCardKeydown(event: KeyboardEvent, id: string, kind: 'item' | 'post') {
  if (event.key !== 'Delete' && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
  event.preventDefault()
  event.stopPropagation()
  onRemoveOne(id, kind)
}

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }
function goDetail(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
function goPostDetail(id: string) { uni.navigateTo({ url: `/pages/post/index?id=${id}` }) }

function onRemoveOne(id: string, kind: 'item' | 'post') {
  const actionEpoch = historyActionEpoch
  uni.showActionSheet({
    itemList: [t('history.removeOne')],
    success: (res) => {
      if (actionEpoch !== historyActionEpoch) return
      if (res.tapIndex === 0) {
        if (kind === 'item') removeFromHistory(id)
        else removePostFromHistory(id)
      }
    },
  })
}

function onClear() {
  const actionEpoch = historyActionEpoch
  uni.showModal({
    title: t('history.clearTitle'),
    content: t('history.clearHint'),
    success: (res) => {
      if (!res.confirm || actionEpoch !== historyActionEpoch) return
      if (tab.value === 'items') clearHistory()
      else clearPostHistory()
    },
  })
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.header-title { flex: 1; font-size: 17px; font-weight: 600; color: var(--text-primary); }
.clear-btn { font-size: 14px; color: var(--accent-danger); cursor: pointer; }

.tabs {
  display: flex; background: var(--bg-elev-1);
  border-bottom: 0.5px solid var(--line-hair);
}
.tab {
  flex: 1; padding: 12px; text-align: center; cursor: pointer;
  position: relative; display: flex; align-items: center; justify-content: center; gap: 6px;
  color: var(--text-muted); font-size: 14px; font-weight: 500;
  &.active { color: var(--text-primary); font-weight: 600; }
  &.active::after {
    content: ''; position: absolute; bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 24px; height: 2px; background: var(--accent-primary); border-radius: 1px;
  }
}
.tab-count {
  font-size: 11px; color: var(--text-subtle); font-weight: 500;
  background: var(--bg-subtle); padding: 1px 6px; border-radius: 8px;
}

.empty { padding: 80px 16px; text-align: center; color: var(--text-subtle); font-size: 14px; }

.items { background: var(--bg-elev-1); margin-top: 7px; }
.item-row {
  display: flex; padding: 12px 16px; gap: 12px;
  border-bottom: 0.5px solid var(--line-hair); cursor: pointer;
  &:active { background: var(--bg-elev-2); }
}
.item-img { width: 64px; height: 64px; border-radius: 8px; flex-shrink: 0; background: var(--bg-subtle); }
.item-info { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.item-title {
  font-size: 14px; color: var(--text-primary); line-height: 1.45; letter-spacing: 0.02em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.item-price-row { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
.item-price { font-size: 15px; font-weight: 700; color: var(--text-primary); }

.post-row {
  display: flex; padding: 12px 16px; gap: 10px;
  border-bottom: 0.5px solid var(--line-hair); cursor: pointer;
  &:active { background: var(--bg-elev-2); }
}
.post-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--bg-subtle); flex-shrink: 0;
}
.post-info { flex: 1; min-width: 0; }
.post-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.post-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.post-official {
  background: var(--accent-action); color: #fff;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
}
.post-content {
  font-size: 13px; color: var(--text-secondary); line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.post-imgs { display: flex; gap: 4px; margin-top: 6px; }
.post-thumb {
  width: 52px; height: 52px; border-radius: 6px;
  background: var(--bg-subtle); flex-shrink: 0;
}
</style>
