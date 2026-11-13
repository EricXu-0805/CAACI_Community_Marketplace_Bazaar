<template>
  <!--
    Chrome shared by the three community views (home, a board, all discussions).
    From 1024px it is the 56px header of SPEC 5.2 ①, which replaces the left
    rail on this page; below that it is the 48px top bar and the 44px board
    chips of SPEC 5.3 ①②. It sits outside the scrolling area, so it stays put.
  -->
  <view v-if="desktop" class="cx-hdr">
    <view class="cx-hdr-in">
      <view class="cx-brand" role="button" :aria-label="t('app.name')" @click="emit('home')">
        <image class="cx-seal" :src="logoSrc" mode="aspectFit" />
        <text class="cx-wm">{{ t('app.name') }}</text>
      </view>
      <text class="cx-region" data-test="region-label">{{ regionLabel(lang) }}</text>
      <view v-if="showRegionSwitcher()" class="cx-region-switcher" data-test="region-switcher">
        <text v-for="region in REGIONS" :key="region.slug" class="cx-region">{{ lang === 'zh' ? region.zh : region.en }}</text>
      </view>

      <view class="cx-nav" role="navigation" :aria-label="t('a11y.primaryNav')" @keydown.esc="menuOpen = false">
        <view class="cx-nav-i cx-nav-on" role="button" aria-controls="cx-boards"
          :aria-expanded="menuOpen ? 'true' : 'false'" @click="menuOpen = !menuOpen">
          <text class="cx-nav-t">{{ t('plaza.title') }}</text>
          <UIcon class="cx-caret" name="chevron-right" size="xs" color="ink-soft" />
        </view>
        <view v-if="menuOpen" class="cx-mask" @click="menuOpen = false"></view>
        <view v-if="menuOpen" id="cx-boards" class="cx-pop">
          <text v-for="category in POST_CATEGORIES" :key="category" class="cx-pop-i" role="button"
            @click="pick(() => emit('board', category))">{{ t(`plaza.category.${category}`) }}</text>
          <text class="cx-pop-i cx-pop-all" role="button" @click="pick(() => emit('all'))">{{ t('plaza.allDiscussions') }}</text>
        </view>
        <text class="cx-nav-i cx-nav-t" role="button" @click="goTab('/pages/index/index')">{{ t('home.navMarket') }}</text>
      </view>

      <view class="cx-right">
        <view class="cx-search">
          <UIcon name="search" size="xs" color="ink-quiet" />
          <input
            class="cx-search-in"
            v-model="searchModel"
            :placeholder="t('plaza.searchPlaceholder')"
            :aria-label="t('plaza.searchPlaceholder')"
            confirm-type="search"
            @input="emit('search-input')"
            @confirm="emit('search-submit')"
          />
        </view>
        <view class="cx-compose" role="button" @click="emit('compose')">
          <text class="cx-compose-t">{{ t('plaza.write') }}</text>
        </view>
        <template v-if="isLoggedIn">
          <view class="cx-ib" role="button" :aria-label="messagesLabel" @click="goTab('/pages/messages/index')">
            <UIcon name="messages" size="sm" color="ink-soft" />
            <text v-if="unreadCount > 0" class="cx-num">{{ unreadCount > 99 ? '99+' : unreadCount }}</text>
          </view>
          <view class="cx-ib" role="button" :aria-label="notifLabel" @click="goNotifications">
            <UIcon name="bell" size="sm" color="ink-soft" />
            <text v-if="unreadNotifCount > 0" class="cx-num">{{ unreadNotifCount > 99 ? '99+' : unreadNotifCount }}</text>
          </view>
          <UAvatar class="cx-ava" role="button" :src="currentUser?.avatar_url" :owner="currentUser?.id"
            :fallback="defaultAvatarSrc" :alt="t('nav.profile')" @click="goTab('/pages/profile/index')" />
        </template>
        <template v-else>
          <text class="cx-login" role="button" @click="emit('login')">{{ t('home.signIn') }}</text>
          <text class="cx-join" role="button" @click="emit('login')">{{ t('home.join') }}</text>
        </template>
      </view>
    </view>
  </view>

  <view v-else class="cx-m">
    <view class="cx-top">
      <view v-if="view !== 'home'" class="cx-ib cx-back" role="button" :aria-label="t('a11y.back')" @click="emit('home')">
        <UIcon name="chevron-left" size="sm" color="ink-soft" />
      </view>
      <text v-if="view === 'all'" class="cx-title">{{ t('plaza.allDiscussions') }}</text>
      <template v-else>
        <image class="cx-seal" :src="logoSrc" mode="aspectFit" />
        <text class="cx-wm">{{ t('app.name') }}</text>
      </template>
      <text class="cx-region" data-test="region-label">{{ regionLabel(lang) }}</text>
      <view v-if="showRegionSwitcher()" class="cx-region-switcher" data-test="region-switcher">
        <text v-for="region in REGIONS" :key="region.slug" class="cx-region">{{ lang === 'zh' ? region.zh : region.en }}</text>
      </view>
      <view class="cx-top-r">
        <view class="cx-ib" role="button" :aria-label="t('a11y.search')" @click="emit('search-open')">
          <UIcon name="search" size="sm" color="ink-soft" />
        </view>
        <view class="cx-ib" role="button" :aria-label="notifLabel" @click="goNotifications">
          <UIcon name="bell" size="sm" color="ink-soft" />
          <view v-if="unreadNotifCount > 0" class="cx-dot"></view>
        </view>
      </view>
    </view>
    <!-- All discussions filters by board with its own chips, so these are for home and board pages. -->
    <scroll-view v-if="view !== 'all'" class="cx-chips" scroll-x :show-scrollbar="false">
      <view class="cx-chips-row">
        <view :class="['cx-chip', { on: view === 'home' }]" role="button"
          :aria-current="view === 'home' ? 'page' : undefined" @click="emit('home')">
          <text class="cx-chip-t">{{ t('cat.all') }}</text>
        </view>
        <view v-for="category in POST_CATEGORIES" :key="category" :class="['cx-chip', { on: board === category }]" role="button"
          :aria-current="board === category ? 'page' : undefined" @click="emit('board', category)">
          <text class="cx-chip-t">{{ t(`plaza.category.${category}`) }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import UAvatar from './UAvatar.vue'
import UIcon from './UIcon.vue'
import { useAuth } from '../composables/useAuth'
import { useI18n } from '../composables/useI18n'
import { useNotifications } from '../composables/useNotifications'
import { useTheme } from '../composables/useTheme'
import { useUnread } from '../composables/useUnread'
import { POST_CATEGORIES, type PostCategory } from '../utils/communityPost'
import { REGIONS, regionLabel, showRegionSwitcher } from '../utils/region'

const props = defineProps<{
  view: 'home' | 'board' | 'all'
  board: PostCategory | null
  desktop: boolean
  search: string
  isLoggedIn: boolean
}>()
const emit = defineEmits<{
  (event: 'home'): void
  (event: 'all'): void
  (event: 'board', category: PostCategory): void
  (event: 'compose'): void
  (event: 'login'): void
  (event: 'update:search', value: string): void
  (event: 'search-input'): void
  (event: 'search-submit'): void
  (event: 'search-open'): void
}>()

const { t, tc, lang } = useI18n()
const { isDark } = useTheme()
const { currentUser } = useAuth()
const { unreadCount } = useUnread()
const { unreadNotifCount } = useNotifications()

const logoSrc = computed(() => isDark.value ? '/static/logo-mark-dark.svg' : '/static/logo-mark.svg')
const defaultAvatarSrc = computed(() => isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg')
// The count sits in the control's name: the badge beside the icon is not read on its own.
const messagesLabel = computed(() => unreadCount.value > 0
  ? `${t('nav.messages')}, ${unreadCount.value} ${tc('a11y.unreadCount', unreadCount.value)}`
  : t('nav.messages'))
const notifLabel = computed(() => unreadNotifCount.value > 0
  ? `${t('notif.title')}, ${t('a11y.unreadNotifications')}`
  : t('notif.title'))

const searchModel = computed({ get: () => props.search, set: value => emit('update:search', value) })
const menuOpen = ref(false)
function pick(go: () => void) {
  menuOpen.value = false
  go()
}
function goTab(url: string) { uni.switchTab({ url }) }
function goNotifications() { uni.navigateTo({ url: '/pages/notifications/index' }) }
</script>

<style lang="scss" scoped>
/* #ifdef H5 */
.cx-seal { flex: none; display: block; }
.cx-wm { flex: none; font-family: var(--font-serif); font-weight: 600; color: var(--ink); white-space: nowrap; }
.cx-region {
  flex: none; padding: 0 var(--space-2); border-radius: var(--radius-pill);
  font-size: var(--t-caption); color: var(--ink-soft); white-space: nowrap;
  box-shadow: inset 0 0 0 1px var(--line-soft);
}
.cx-region-switcher { display: flex; gap: var(--space-2); }
.cx-ib { position: relative; flex: none; display: flex; align-items: center; justify-content: center; cursor: pointer; }

/* ---- desktop header ---- */
.cx-hdr { position: relative; z-index: 30; flex: none; height: 56px; background: var(--surface); border-bottom: 1px solid var(--line-soft); }
.cx-hdr-in { display: flex; align-items: center; width: min(1200px, calc(100% - var(--space-8))); height: 56px; margin: 0 auto; }
.cx-brand { flex: none; display: flex; align-items: center; gap: var(--space-2); cursor: pointer; }
.cx-hdr .cx-seal { width: 32px; height: 32px; }
.cx-hdr .cx-wm { font-size: 20px; line-height: var(--space-6); }
.cx-hdr .cx-region { margin-left: var(--space-4); line-height: var(--space-6); }
.cx-nav { position: relative; flex: none; display: flex; align-items: center; gap: var(--space-6); height: 56px; margin-left: var(--space-6); }
.cx-nav-i { display: flex; align-items: center; gap: var(--space-1); height: 56px; cursor: pointer; }
.cx-nav-t { font-size: 14px; line-height: 56px; color: var(--ink-soft); white-space: nowrap; }
.cx-nav-on { box-shadow: inset 0 -2px 0 var(--brand); }
.cx-nav-on .cx-nav-t { color: var(--ink); font-weight: 600; }
.cx-caret { transform: rotate(90deg); }
.cx-mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 39; }
.cx-pop {
  position: absolute; top: 56px; left: 0; z-index: 40; min-width: 200px; padding: var(--space-2);
  display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--line-soft); border-radius: var(--radius-md); box-shadow: var(--shadow-pop);
}
.cx-pop-i { padding: 0 var(--space-3); border-radius: var(--radius-sm); font-size: 14px; line-height: 36px; color: var(--ink); cursor: pointer; }
.cx-pop-i:hover { background: var(--surface-alt); }
.cx-pop-all { margin-top: var(--space-1); color: var(--ink-soft); box-shadow: 0 -1px 0 var(--line-hair); }
.cx-right { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: var(--space-3); margin-left: var(--space-6); }
.cx-search {
  flex: 0 1 320px; min-width: 0; display: flex; align-items: center; gap: var(--space-2);
  height: 36px; padding: 0 var(--space-3); border-radius: var(--radius-sm); background: var(--surface-alt);
}
.cx-search-in { flex: 1; min-width: 0; font-size: 14px; color: var(--ink); background: transparent; }
.cx-compose {
  flex: none; display: flex; align-items: center; justify-content: center; min-width: 72px; height: 36px;
  padding: 0 var(--space-3); border-radius: var(--radius-sm); background: var(--brand); cursor: pointer;
}
.cx-compose:active { background: var(--brand-deep); }
.cx-compose-t { font-size: 14px; font-weight: 600; color: var(--ink-inverse); white-space: nowrap; }
.cx-hdr .cx-ib { width: 36px; height: 36px; }
.cx-num {
  position: absolute; top: 0; right: 0; min-width: var(--space-4); padding: 0 var(--space-1); border-radius: var(--radius-pill);
  font-size: var(--t-meta); line-height: var(--space-4); text-align: center; font-variant-numeric: tabular-nums;
  color: var(--ink-inverse); background: var(--brand);
}
.cx-ava { flex: none; width: 32px; height: 32px; border-radius: 50%; overflow: hidden; background: var(--surface-alt); cursor: pointer; }
.cx-login, .cx-join { flex: none; font-size: 14px; line-height: var(--space-7); white-space: nowrap; cursor: pointer; }
.cx-login { color: var(--ink-soft); }
.cx-join { padding: 0 var(--space-3); border-radius: var(--radius-sm); color: var(--ink); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-bold); }

/* ---- phone top bar and board chips ---- */
.cx-m { flex: none; z-index: 20; background: var(--surface); padding-top: env(safe-area-inset-top, 0px); }
.cx-top { display: flex; align-items: center; gap: var(--space-2); height: 48px; padding: 0 var(--space-1) 0 var(--space-4); }
.cx-m .cx-seal { width: 24px; height: 24px; }
.cx-m .cx-wm, .cx-title { font-size: var(--t-h3); line-height: var(--space-6); }
.cx-title { flex: none; font-weight: 600; color: var(--ink); white-space: nowrap; }
.cx-m .cx-region { line-height: 26px; }
.cx-top-r { flex: none; display: flex; margin-left: auto; }
.cx-m .cx-ib { width: 40px; height: 40px; }
.cx-back { margin-left: calc(-1 * var(--space-3)); }
.cx-dot { position: absolute; top: var(--space-2); right: var(--space-2); width: var(--space-2); height: var(--space-2); border-radius: 50%; background: var(--brand); }
.cx-chips { width: 100%; height: 44px; white-space: nowrap; border-bottom: 1px solid var(--line-soft); }
.cx-chips-row { display: flex; align-items: center; gap: var(--space-2); width: max-content; height: 44px; padding: 0 var(--space-4); }
.cx-chip {
  flex: none; display: flex; align-items: center; height: 30px; padding: 0 var(--space-3);
  border-radius: var(--radius-pill); box-shadow: inset 0 0 0 1px var(--line-soft); cursor: pointer;
}
.cx-chip-t { font-size: 14px; color: var(--ink-soft); white-space: nowrap; }
.cx-chip.on { box-shadow: inset 0 0 0 1px var(--brand); }
.cx-chip.on .cx-chip-t { color: var(--brand); }
/* #endif */
</style>
