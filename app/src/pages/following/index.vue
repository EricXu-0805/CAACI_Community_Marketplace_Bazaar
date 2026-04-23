<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('nav.following') }}</text>
    </view>

    <scroll-view class="list" scroll-y :scroll-top="scrollTopVal" :scroll-with-animation="false" @scrolltolower="loadMore">
      <view v-if="items.length === 0 && !loading" class="empty">
        <text class="empty-icon">👥</text>
        <text class="empty-text">{{ t('follow.emptyFeed') }}</text>
      </view>

      <view v-else class="grid">
        <view
          v-for="it in items"
          :key="it.id"
          class="card"
          @click="goDetail(it.id)"
        >
          <view class="card-img-wrap">
            <image
              :src="thumbUrl(it.images?.[0], 'card') || '/static/placeholder.svg'"
              :alt="localize(it.title_i18n, it.title)"
              class="card-img"
              mode="aspectFill"
              lazy-load
            />
            <view v-if="it.location_verified && matchSpot(it.location)?.safe" class="badge-safe-corner" :aria-label="t('pickup.verifiedPickup')">
              <text class="bsc-check">✓</text>
              <text class="bsc-label">{{ t('pickup.verifiedPickup') }}</text>
            </view>
          </view>
          <view class="card-body">
            <text class="card-title">{{ localize(it.title_i18n, it.title) }}</text>
            <text class="card-price">{{ formatPrice(it.price, t('home.free')) }}</text>
            <view class="card-seller" v-if="it.profile">
              <image :src="it.profile.avatar_url || '/static/default-avatar.svg'" class="cs-avatar" mode="aspectFill" />
              <text class="cs-name">{{ it.profile.nickname }}</text>
            </view>
          </view>
        </view>
      </view>

      <view v-if="loading" class="loading-tip"><text>{{ t('home.loading') }}</text></view>
      <view v-else-if="!hasMore && items.length > 0" class="end-tip"><text>{{ t('home.endOf') }}</text></view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useFollow } from '../../composables/useFollow'
import { useAuth } from '../../composables/useAuth'
import { matchSpot } from '../../composables/useCampusSpots'
import type { Item } from '../../types'
import { formatPrice, thumbUrl } from '../../utils'

const { t, localize } = useI18n()
const { currentUser } = useAuth()
const { fetchFollowingFeed, loadMyFollowing } = useFollow()

const items = ref<Item[]>([])
const loading = ref(false)
const hasMore = ref(true)
const page = ref(0)

/*
 * uni-app <scroll-view> keeps its last scrollTop across navigations, so
 * reopening this page from the profile menu would drop the user into the
 * middle of the feed. Drive the scrollTop via a ref and bump it to 0 on
 * every onShow. The 1 → 0 two-step is required because assigning the same
 * value twice in a row is a no-op in uni-app H5.
 */
const scrollTopVal = ref(0)
function resetScroll() {
  scrollTopVal.value = 1
  nextTick(() => { scrollTopVal.value = 0 })
}
onShow(() => { resetScroll() })

onMounted(async () => {
  if (!currentUser.value) {
    uni.showToast({ title: t('profile.signInHint'), icon: 'none' })
    return
  }
  loading.value = true
  await loadMyFollowing()
  const rows = await fetchFollowingFeed(0)
  items.value = rows
  hasMore.value = rows.length === 20
  loading.value = false
})

async function loadMore() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  page.value += 1
  const rows = await fetchFollowingFeed(page.value)
  items.value.push(...rows)
  hasMore.value = rows.length === 20
  loading.value = false
}

function goBack() { uni.navigateBack() }
function goDetail(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.list { flex: 1; height: calc(100vh - 56px); }

.grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  padding: 8px;
}
.card {
  background: var(--bg-elev-1); border-radius: 10px; overflow: hidden;
  cursor: pointer;
  &:active { opacity: 0.85; }
}
.card-img-wrap { position: relative; }
.card-img { width: 100%; height: 160px; }
.card-body { padding: 8px 10px 10px; }

/* Safe-zone verified pickup badge — matches home feed style. */
.badge-safe-corner {
  position: absolute; bottom: 7px; left: 7px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px 2px 5px; border-radius: 10px;
  background: rgba(34,197,94,0.92);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.bsc-check { font-size: 10px; color: #fff; font-weight: 800; line-height: 1; }
.bsc-label { font-size: 10px; color: #fff; font-weight: 600; line-height: 1; }
.card-title {
  font-size: 13px; color: var(--text-primary); line-height: 1.3;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card-price { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-top: 4px; display: block; }
.card-seller { display: flex; align-items: center; gap: 5px; margin-top: 5px; }
.cs-avatar { width: 16px; height: 16px; border-radius: 50%; background: var(--bg-subtle); }
.cs-name { font-size: 11px; color: var(--text-secondary, #5a5a63); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 40px; gap: 12px; text-align: center;
}
.empty-icon { font-size: 48px; }
.empty-text { font-size: 14px; color: var(--text-muted); line-height: 1.5; }

.loading-tip, .end-tip {
  text-align: center; padding: 16px; font-size: 12px; color: var(--text-faint);
}
</style>
