<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
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
      <text>{{ t('history.empty') }}</text>
    </view>

    <view v-else-if="tab === 'items'" class="items">
      <view
        v-for="item in history"
        :key="item.id"
        class="item-row"
        @click="goDetail(item.id)"
        @longpress="onRemoveOne(item.id, 'item')"
      >
        <image :src="item.images?.[0] || '/static/placeholder.svg'" class="item-img" mode="aspectFill" lazy-load />
        <view class="item-info">
          <text class="item-title">{{ item.title }}</text>
          <text class="item-price">{{ formatPrice(item.price, t('home.free')) }}</text>
        </view>
      </view>
    </view>

    <view v-else class="items">
      <view
        v-for="p in postHistory"
        :key="p.id"
        class="post-row"
        @click="goPostDetail(p.id)"
        @longpress="onRemoveOne(p.id, 'post')"
      >
        <image :src="p.profile?.avatar_url || '/static/default-avatar.svg'" class="post-avatar" />
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
              class="post-thumb"
              mode="aspectFill"
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
import { formatPrice } from '../../utils'

const { t } = useI18n()
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
.page { min-height: 100vh; background: #f2f2f7; max-width: 480px; margin: 0 auto; }
.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: #fff; border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; transform: rotate(45deg); margin-left: 4px; }
.header-title { flex: 1; font-size: 17px; font-weight: 600; color: #1a1a1a; }
.clear-btn { font-size: 14px; color: #FF3B30; cursor: pointer; }

.tabs {
  display: flex; background: #fff;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
}
.tab {
  flex: 1; padding: 12px; text-align: center; cursor: pointer;
  position: relative; display: flex; align-items: center; justify-content: center; gap: 6px;
  color: #8e8e93; font-size: 14px; font-weight: 500;
  &.active { color: #1a1a1a; font-weight: 600; }
  &.active::after {
    content: ''; position: absolute; bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 24px; height: 2px; background: #1a1a1a; border-radius: 1px;
  }
}
.tab-count {
  font-size: 11px; color: #aeaeb2; font-weight: 500;
  background: #f2f2f7; padding: 1px 6px; border-radius: 8px;
}

.empty { padding: 80px 16px; text-align: center; color: #aeaeb2; font-size: 14px; }

.items { background: #fff; margin-top: 7px; }
.item-row {
  display: flex; padding: 12px 16px; gap: 12px;
  border-bottom: 0.5px solid rgba(0,0,0,0.06); cursor: pointer;
  &:active { background: #f7f7f8; }
}
.item-img { width: 64px; height: 64px; border-radius: 8px; flex-shrink: 0; background: #f2f2f7; }
.item-info { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.item-title {
  font-size: 14px; color: #1a1a1a; line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.item-price { font-size: 15px; font-weight: 700; color: #1a1a1a; }

.post-row {
  display: flex; padding: 12px 16px; gap: 10px;
  border-bottom: 0.5px solid rgba(0,0,0,0.06); cursor: pointer;
  &:active { background: #f7f7f8; }
}
.post-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: #f2f2f7; flex-shrink: 0;
}
.post-info { flex: 1; min-width: 0; }
.post-top { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.post-name { font-size: 13px; font-weight: 600; color: #1a1a1a; }
.post-official {
  background: #FF6B35; color: #fff;
  padding: 1px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
}
.post-content {
  font-size: 13px; color: #636366; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.post-imgs { display: flex; gap: 4px; margin-top: 6px; }
.post-thumb {
  width: 52px; height: 52px; border-radius: 6px;
  background: #f2f2f7; flex-shrink: 0;
}
</style>
