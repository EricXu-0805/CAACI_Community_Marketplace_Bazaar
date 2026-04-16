<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('profile.history') }}</text>
      <text v-if="history.length > 0" class="clear-btn" @click="onClear">{{ t('filter.reset') }}</text>
    </view>

    <view v-if="history.length === 0" class="empty">
      <text>{{ t('history.empty') }}</text>
    </view>

    <view v-else class="items">
      <view v-for="item in history" :key="item.id" class="item-row" @click="goDetail(item.id)">
        <image :src="item.images?.[0] || '/static/placeholder.png'" class="item-img" mode="aspectFill" />
        <view class="item-info">
          <text class="item-title">{{ item.title }}</text>
          <text class="item-price">${{ item.price }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { useHistory } from '../../composables/useHistory'

const { t } = useI18n()
const { history, clearHistory } = useHistory()

function goBack() { uni.navigateBack() }
function goDetail(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
function onClear() {
  uni.showModal({
    title: t('history.clearTitle'),
    content: t('history.clearHint'),
    success: (res) => { if (res.confirm) clearHistory() },
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
</style>
