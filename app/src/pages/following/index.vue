<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
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

      <view v-else-if="loadError && !loading" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
        <UEmptyArt name="following" />
        <text class="empty-text">{{ t('error.loadFailed') }}</text>
        <view class="retry-btn" role="button" :aria-label="t('home.retry')" @click="retryLoad">{{ t('home.retry') }}</view>
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
          <UAvatar :src="p.avatar_url" :owner="p.id" :fallback="defaultAvatarSrc" :alt="p.nickname || 'avatar'" class="pr-avatar" lazy />
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
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useTheme } from '../../composables/useTheme'
import { useFollow } from '../../composables/useFollow'
import type { FollowedProfile } from '../../composables/useFollow'
import { useAuth } from '../../composables/useAuth'
import { friendlyErrorMessage, navigateBackOr } from '../../utils'
import { createAccountPageScope } from '../../composables/accountPageScope'
import UAvatar from '../../components/UAvatar.vue'
import UEmptyArt from '../../components/UEmptyArt.vue'
import UIcon from '../../components/UIcon.vue'
import UBadge from '../../components/UBadge.vue'

const PAGE_SIZE = 30

const { t, lang } = useI18n()
const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)
const { currentUser, requireAuth, awaitAuthReady } = useAuth()
const { fetchFollowingProfiles } = useFollow()

const people = ref<FollowedProfile[]>([])
const loading = ref(false)
const hasMore = ref(true)
const page = ref(0)
const loadError = ref(false)
let followingPageAlive = true

function clearFollowingPageState() {
  people.value = []
  loading.value = false
  hasMore.value = true
  page.value = 0
  loadError.value = false
}

const followingPageScope = createAccountPageScope(() => {
  clearFollowingPageState()
})

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

async function loadInitialForUser(userId: string): Promise<boolean> {
  const request = followingPageScope.begin(userId)
  if (!request) return false
  loading.value = true
  loadError.value = false
  try {
    const rows = await fetchFollowingProfiles(0, PAGE_SIZE)
    if (!followingPageScope.isCurrent(request)) return false
    people.value = rows
    page.value = 0
    hasMore.value = rows.length === PAGE_SIZE
    return true
  } catch (err: any) {
    if (!followingPageScope.isCurrent(request)) return false
    people.value = []
    loadError.value = true
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
    return false
  } finally {
    if (followingPageScope.isCurrent(request)) loading.value = false
  }
}

async function loadInitial(): Promise<boolean> {
  const state = await awaitAuthReady()
  if (!followingPageAlive) return false
  const userId = currentUser.value?.id
  if (!userId) {
    followingPageScope.invalidate()
    clearFollowingPageState()
    // An established session can briefly lack a profile after a transient
    // profile fetch failure. Do not call that "signed out" or send it to the
    // login page; surface a retryable load failure instead.
    if (state === 'authenticated') {
      uni.showToast({ title: t('error.loadFailed'), icon: 'none' })
    } else {
      requireAuth()
    }
    return false
  }
  return loadInitialForUser(userId)
}

onMounted(() => { void loadInitial() })

function retryLoad() { void loadInitial() }

async function loadMore() {
  if (loading.value || !hasMore.value) return
  const userId = currentUser.value?.id
  if (!userId) {
    followingPageScope.invalidate()
    clearFollowingPageState()
    return
  }
  const request = followingPageScope.begin(userId)
  if (!request) return
  const nextPage = page.value + 1
  loading.value = true
  loadError.value = false
  try {
    const rows = await fetchFollowingProfiles(nextPage, PAGE_SIZE)
    if (!followingPageScope.isCurrent(request)) return
    people.value.push(...rows)
    page.value = nextPage
    hasMore.value = rows.length === PAGE_SIZE
  } catch (err: any) {
    if (!followingPageScope.isCurrent(request)) return
    loadError.value = true
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    if (followingPageScope.isCurrent(request)) loading.value = false
  }
}

watch(() => currentUser.value?.id || null, (uid, previousUid) => {
  if (uid === previousUid) return
  followingPageScope.invalidate()
  clearFollowingPageState()
  if (uid) void loadInitialForUser(uid)
})

onUnload(() => {
  followingPageAlive = false
  clearFollowingPageState()
  followingPageScope.dispose()
})

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }
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
.retry-btn { padding: 8px 18px; border-radius: 18px; background: var(--accent-primary); color: #fff; cursor: pointer; }

.loading-tip, .end-tip {
  text-align: center; padding: 16px; font-size: 12px; color: var(--text-subtle);
}
</style>
