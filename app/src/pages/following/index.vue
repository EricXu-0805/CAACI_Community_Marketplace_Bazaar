<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ t('nav.following') }}</text>
    </view>

    <scroll-view class="list" scroll-y :scroll-top="scrollTopVal" :scroll-with-animation="false" @scrolltolower="loadMore">
      <view v-if="loading && people.length === 0" class="people">
        <view v-for="n in 6" :key="'ps' + n" class="person-row">
          <view class="pr-avatar u-sk"></view>
          <view class="pr-info">
            <view class="pr-line u-sk" style="width: 44%"></view>
            <view class="pr-line u-sk" style="width: 66%; height: 11px"></view>
          </view>
        </view>
      </view>

      <view v-else-if="people.length === 0 && !loading" class="empty">
        <UEmptyArt name="following" />
        <text class="empty-text">{{ t('follow.emptyPeople') }}</text>
      </view>

      <view v-else class="people u-stagger">
        <view
          v-for="p in people"
          :key="p.id"
          class="person-row u-rise"
          role="button"
          :aria-label="p.nickname || t('app.user')"
          @click="goSeller(p.id)"
        >
          <image :src="p.avatar_url || defaultAvatarSrc" :alt="p.nickname || 'avatar'" class="pr-avatar" mode="aspectFill" />
          <view class="pr-info">
            <view class="pr-name-row">
              <text class="pr-name">{{ p.nickname || t('app.user') }}</text>
              <UBadge v-if="p.is_illini_verified" variant="illini">Illini</UBadge>
            </view>
            <text v-if="p.status_text" class="pr-status">{{ p.status_emoji ? p.status_emoji + ' ' : '' }}{{ p.status_text }}</text>
            <text v-else-if="p.location" class="pr-status">{{ p.location }}</text>
          </view>
          <UIcon name="chevron-right" size="sm" color="text-faint" />
        </view>
      </view>

      <view v-if="loading && people.length > 0" class="loading-tip"><text>{{ t('home.loading') }}</text></view>
      <view v-else-if="!hasMore && people.length > 0" class="end-tip"><text>{{ t('home.endOf') }}</text></view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import { useFollow } from '../../composables/useFollow'
import type { FollowedProfile } from '../../composables/useFollow'
import { useAuth } from '../../composables/useAuth'
import { friendlyErrorMessage } from '../../utils'
import UEmptyArt from '../../components/UEmptyArt.vue'
import UIcon from '../../components/UIcon.vue'
import UBadge from '../../components/UBadge.vue'

const PAGE_SIZE = 30

const { t, lang } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser } = useAuth()
const { fetchFollowingProfiles } = useFollow()

const people = ref<FollowedProfile[]>([])
const loading = ref(false)
const hasMore = ref(true)
const page = ref(0)

/*
 * uni-app <scroll-view> keeps its last scrollTop across navigations, so
 * reopening this page from the profile menu would drop the user into the
 * middle of the list. Drive the scrollTop via a ref and bump it to 0 on
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
    const rows = await fetchFollowingProfiles(0, PAGE_SIZE)
    people.value = rows
    hasMore.value = rows.length === PAGE_SIZE
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
    const rows = await fetchFollowingProfiles(page.value, PAGE_SIZE)
    people.value.push(...rows)
    hasMore.value = rows.length === PAGE_SIZE
  } catch (err: any) {
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    loading.value = false
  }
}

function goBack() { uni.navigateBack() }
function goSeller(id: string) { uni.navigateTo({ url: `/pages/seller/index?id=${id}` }) }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.list { flex: 1; height: calc(100vh - 56px); }

.people { padding: 4px 0; }
.person-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; cursor: pointer;
  border-bottom: 0.5px solid var(--line-hair);
  &:active { background: var(--bg-subtle); }
}
.pr-avatar { width: 44px; height: 44px; border-radius: 50%; background: var(--bg-subtle); flex-shrink: 0; }
.pr-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.pr-name-row { display: flex; align-items: center; gap: 6px; }
.pr-name { font-size: 15px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-status { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pr-line { height: 13px; border-radius: 6px; }

.empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 40px; gap: 12px; text-align: center;
}
.empty-text { font-size: 14px; color: var(--text-muted); line-height: 1.5; }

.loading-tip, .end-tip {
  text-align: center; padding: 16px; font-size: 12px; color: var(--text-faint);
}
</style>
