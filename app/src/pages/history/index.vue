<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ t('profile.history') }}</text>
      <text v-if="currentList.length > 0" class="clear-btn" @click="onClear">{{ t('filter.reset') }}</text>
    </view>

    <view class="tabs">
      <view :class="['tab', { active: tab === 'items' }]" @click="tab = 'items'">
        <text>{{ t('history.tabItems') }}</text>
        <text v-if="history.length > 0" class="tab-count">{{ history.length }}</text>
      </view>
      <view :class="['tab', { active: tab === 'posts' }]" @click="tab = 'posts'">
        <text>{{ t('history.tabPosts') }}</text>
        <text v-if="postHistory.length > 0" class="tab-count">{{ postHistory.length }}</text>
      </view>
    </view>

    <view v-if="currentList.length === 0" class="empty">
      <UEmptyArt name="history" />
      <text>{{ t('history.empty') }}</text>
    </view>

    <view v-else-if="tab === 'items'" class="items u-stagger">
      <view
        v-for="item in history"
        :key="item.id"
        class="item-row u-rise"
        @click="goDetail(item.id)"
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

    <view v-else class="items u-stagger">
      <view
        v-for="p in postHistory"
        :key="p.id"
        class="post-row u-rise"
        @click="goPostDetail(p.id)"
        @longpress="onRemoveOne(p.id, 'post')"
      >
        <image :src="p.profile?.avatar_url || defaultAvatarSrc" :alt="p.profile?.nickname || 'avatar'" class="post-avatar" mode="aspectFill" />
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
import { ref, computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useHistory } from '../../composables/useHistory'
import { useTheme } from '../../composables/useTheme'
import { listingPriceLabel, thumbUrl } from '../../utils'
import UEmptyArt from '../../components/UEmptyArt.vue'
import UIcon from '../../components/UIcon.vue'

const { t, localize } = useI18n()
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
const currentList = computed(() => tab.value === 'items' ? history.value : postHistory.value)

function goBack() { uni.navigateBack() }
function goDetail(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
function goPostDetail(id: string) { uni.navigateTo({ url: `/pages/post/index?id=${id}` }) }

function onRemoveOne(id: string, kind: 'item' | 'post') {
  uni.showActionSheet({
    itemList: [t('history.removeOne')],
    success: (res) => {
      if (res.tapIndex === 0) {
        if (kind === 'item') removeFromHistory(id)
        else removePostFromHistory(id)
      }
    },
  })
}

function onClear() {
  uni.showModal({
    title: t('history.clearTitle'),
    content: t('history.clearHint'),
    success: (res) => {
      if (!res.confirm) return
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
  font-size: 11px; color: var(--text-faint); font-weight: 500;
  background: var(--bg-subtle); padding: 1px 6px; border-radius: 8px;
}

.empty { padding: 80px 16px; text-align: center; color: var(--text-faint); font-size: 14px; }

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
