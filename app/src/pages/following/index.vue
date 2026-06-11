<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('nav.following') }}</text>
    </view>

    <scroll-view class="list" scroll-y :scroll-top="scrollTopVal" :scroll-with-animation="false" @scrolltolower="loadMore">
      <view v-if="items.length === 0 && !loading" class="empty">
        <text class="u-thumb-ph-seal" style="opacity:0.14;font-size:48px">集</text>
        <UIcon name="user-plus" size="xl" color="ink-faint" />
        <text class="empty-text">{{ t('follow.emptyFeed') }}</text>
      </view>

      <view v-else class="grid">
        <view
          v-for="it in items"
          :key="it.id"
          class="card u-rise"
          @click="goDetail(it.id)"
        >
          <view class="card-img-wrap">
            <image
              v-if="thumbUrl(it.images?.[0], 'card')"
              :src="thumbUrl(it.images?.[0], 'card')"
              :alt="localize(it.title_i18n, it.title)"
              class="card-img"
              mode="aspectFill"
              lazy-load
            />
            <view v-else class="card-img u-thumb-ph u-thumb-ph--fill"><text class="u-thumb-ph-seal">集</text></view>
            <view v-if="it.location_verified && matchSpot(it.location)?.safe" class="badge-safe-corner" :aria-label="t('pickup.verifiedPickup')">
              <text class="bsc-check">✓</text>
              <text class="bsc-label">{{ t('pickup.verifiedPickup') }}</text>
            </view>
          </view>
          <view class="card-body">
            <text class="card-title">{{ localize(it.title_i18n, it.title) }}</text>
            <text class="card-price">{{ formatPrice(it.price, t('home.free')) }}</text>
            <view class="card-seller" v-if="it.profile">
              <image :src="it.profile.avatar_url || defaultAvatarSrc" :alt="it.profile.nickname || 'avatar'" class="cs-avatar" mode="aspectFill" />
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
import { ref, computed, nextTick, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import { useFollow } from '../../composables/useFollow'
import { useAuth } from '../../composables/useAuth'
import { matchSpot } from '../../composables/useCampusSpots'
import type { Item } from '../../types'
import { formatPrice, thumbUrl, friendlyErrorMessage } from '../../utils'
import UIcon from '../../components/UIcon.vue'

const { t, localize, lang } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
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
  try {
    await loadMyFollowing()
    const rows = await fetchFollowingFeed(0)
    items.value = rows
    hasMore.value = rows.length === 20
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    loading.value = false
  }
})

async function loadMore() {
  if (loading.value || !hasMore.value) return
  loading.value = true
  page.value += 1
  try {
    const rows = await fetchFollowingFeed(page.value)
    items.value.push(...rows)
    hasMore.value = rows.length === 20
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    loading.value = false
  }
}

function goBack() { uni.navigateBack() }
function goDetail(id: string) { uni.navigateTo({ url: `/pages/detail/index?id=${id}` }) }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.list { flex: 1; height: calc(100vh - 56px); }

.grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  padding: 8px;
}
.card {
  background: var(--bg-elev-1); border-radius: var(--radius-lg); overflow: hidden;
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
  background: var(--success);
}
.bsc-check { font-size: 10px; color: var(--ink-inverse); font-weight: 800; line-height: 1; }
.bsc-label { font-size: 10px; color: var(--ink-inverse); font-weight: 600; line-height: 1; }
.card-title {
  font-size: 13px; color: var(--text-primary); line-height: 1.45; letter-spacing: 0.02em;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card-price { font-size: 15px; font-weight: 700; color: var(--text-primary); margin-top: 4px; display: block; }
.card-seller { display: flex; align-items: center; gap: 5px; margin-top: 5px; }
.cs-avatar { width: 16px; height: 16px; border-radius: 50%; background: var(--bg-subtle); }
.cs-name { font-size: 11px; color: var(--text-secondary, var(--ink-quiet)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 40px; gap: 12px; text-align: center;
}
.empty-text { font-size: 14px; color: var(--text-muted); line-height: 1.5; }

.loading-tip, .end-tip {
  text-align: center; padding: 16px; font-size: 12px; color: var(--text-faint);
}
</style>
