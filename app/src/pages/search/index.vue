<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <!--
      Search page — refinement-pass layout (moved here from the
      home dropdown). Focused input + cancel, recent searches,
      category browse grid. On submit we hand the query back to
      the home feed via a pending_search storage key that
      home's onShow() consumes and clears.
    -->
    <view class="page-header">
      <view class="search-field">
        <view class="sf-icon"></view>
        <input
          v-model="query"
          :placeholder="t('home.search')"
          :aria-label="t('home.search')"
          class="sf-input"
          confirm-type="search"
          :focus="true"
          @confirm="onSubmit"
        />
        <view v-if="query" class="sf-clear" role="button" :aria-label="t('a11y.searchClear')" @click="query = ''">×</view>
      </view>
      <text class="cancel-btn" @click="goBack">{{ t('filter.cancel') }}</text>
    </view>

    <scroll-view class="body" scroll-y :show-scrollbar="false">
      <view v-if="recent.length > 0" class="section">
        <view class="sec-header">
          <text class="sec-title">{{ t('home.recentSearch') }}</text>
          <text class="sec-clear" @click="clearHistory">{{ t('filter.reset') }}</text>
        </view>
        <view class="chip-row u-stagger">
          <view
            v-for="h in recent"
            :key="h"
            class="chip"
            @click="pick(h)"
          >
            <text class="chip-text">{{ h }}</text>
            <view class="chip-x" role="button" :aria-label="t('a11y.delete')" @click.stop="removeOne(h)"></view>
          </view>
        </view>
      </view>

      <view class="section">
        <view class="sec-header">
          <text class="sec-title">{{ t('home.browseByCategory') }}</text>
        </view>
        <view class="cat-grid u-stagger">
          <view
            v-for="c in categories"
            :key="'c'+c.value"
            class="cat-tile"
            @click="pickCategory(c.value)"
          >
            <UIcon :name="c.icon" size="sm" color="ink-soft" />
            <text class="cat-label">{{ c.label }}</text>
          </view>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { computed, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { ItemCategory } from '../../types'
import { BROWSE_CATEGORIES } from '../../utils'
import UIcon from '../../components/UIcon.vue'

const { t } = useI18n()

const query = ref('')
const recent = ref<string[]>([])

try {
  recent.value = JSON.parse(uni.getStorageSync('searchHistory') || '[]')
} catch {}

const MAX_HISTORY = 8
const STORAGE_KEY = 'searchHistory'

/* Registry cat-* icons; housing aliases to home-regular per registry note. */
const CATEGORY_ICON: Record<string, string> = {
  electronics: 'cat-electronics',
  furniture: 'cat-furniture',
  housing: 'home',
  clothing: 'cat-clothing',
  books: 'cat-books',
  vehicles: 'cat-transport',
  rideshare: 'cat-transport',
  daily: 'cat-daily',
  food: 'cat-food',
  other: 'cat-other',
}
const catKeys: (ItemCategory | null)[] = [...BROWSE_CATEGORIES]
const categories = computed(() => catKeys.map(k => ({
  value: k,
  label: t('cat.' + k),
  icon: CATEGORY_ICON[k || 'other'] || 'tag',
})))

function saveToHistory(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  recent.value = [trimmed, ...recent.value.filter(s => s !== trimmed)].slice(0, MAX_HISTORY)
  try { uni.setStorageSync(STORAGE_KEY, JSON.stringify(recent.value)) } catch {}
}

function onSubmit() {
  const text = query.value.trim()
  if (!text) return
  saveToHistory(text)
  try {
    uni.setStorageSync('pending_search', text)
    uni.removeStorageSync('pending_category')
  } catch {}
  uni.navigateBack()
}

function pick(text: string) {
  query.value = text
  onSubmit()
}

function pickCategory(cat: ItemCategory | null) {
  try {
    uni.setStorageSync('pending_category', cat || '')
    uni.removeStorageSync('pending_search')
  } catch {}
  uni.navigateBack()
}

function removeOne(text: string) {
  recent.value = recent.value.filter(s => s !== text)
  try { uni.setStorageSync(STORAGE_KEY, JSON.stringify(recent.value)) } catch {}
}

function clearHistory() {
  recent.value = []
  try { uni.removeStorageSync(STORAGE_KEY) } catch {}
}

function goBack() { uni.navigateBack() }
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: var(--canvas);
  max-width: 480px;
  margin: 0 auto;
  display: flex; flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
  overflow-x: hidden;
}

/*
 * box-sizing + min-width: 0 on the flex parent and child are the
 * combination that keeps the cancel button visible no matter how long
 * the placeholder or typed query is. Without min-width: 0 on the flex-1
 * child, the input's intrinsic min-content width refuses to shrink,
 * pushing the cancel button off-screen on narrow viewports — which is
 * what users were seeing when they had to swipe to find it.
 */
.page-header {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px;
  padding-top: calc(10px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  /* #ifdef MP-WEIXIN */
  /* keep the cancel button out from under the native capsule */
  padding-right: var(--mp-navbar-right-pad, 0px);
  /* #endif */
  background: var(--canvas);
  border-bottom: 0.5px solid var(--border);
  box-sizing: border-box;
  width: 100%;
}

.search-field {
  flex: 1 1 auto;
  min-width: 0;
  display: flex; align-items: center; gap: 8px;
  background: var(--surface-alt);
  border: 0.5px solid var(--border-hair);
  border-radius: var(--radius-md);
  padding: 9px 13px;
  box-sizing: border-box;
}
.sf-icon {
  width: 14px; height: 14px; flex-shrink: 0;
  border: 1.6px solid var(--ink-faint); border-radius: 50%; position: relative;
}
.sf-icon::after {
  content: ''; position: absolute; right: -4px; bottom: -4px;
  width: 5px; height: 1.6px; background: var(--ink-faint);
  transform: rotate(45deg); transform-origin: left center;
}
.sf-input {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  color: var(--ink);
  letter-spacing: 0.02em;
  background: transparent;
  border: none; outline: none;
}
.sf-clear {
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--ink-faint);
  color: #fff; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  cursor: pointer;
}
.cancel-btn {
  font-size: 14px;
  color: var(--ink);
  letter-spacing: 0.02em;
  cursor: pointer;
  flex-shrink: 0;
  &:active { opacity: 0.6; }
}

.body {
  flex: 1;
  padding: 4px 16px 24px;
  box-sizing: border-box;
}

.section {
  margin-top: 20px;
}
.sec-header {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 12px;
}
.sec-title {
  font-family: var(--font-serif);
  font-size: 15px; font-weight: 500;
  color: var(--ink);
  letter-spacing: 0.03em;
}
.sec-clear {
  font-size: 11px;
  color: var(--ink-quiet);
  letter-spacing: 0.02em;
  cursor: pointer;
  &:active { opacity: 0.6; }
}

/*
 * Recent-search chips — refinement-pass pattern:
 *   parchment bg pill + inline × remover. Tap chip body to search,
 *   tap × to delete just that entry (debounced via click.stop).
 */
.chip-row {
  display: flex; flex-wrap: wrap; gap: 7px;
}
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px 6px 12px;
  background: var(--parchment);
  color: var(--ink);
  border-radius: var(--radius-pill);
  font-size: 12px;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { background: var(--frame); }
}
.chip-text { line-height: 1.2; }
.chip-x {
  width: 12px; height: 12px; position: relative; flex-shrink: 0;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0; right: 0;
    height: 1.5px; background: var(--ink-quiet);
    border-radius: 1px;
  }
  &::before { transform: rotate(45deg); }
  &::after  { transform: rotate(-45deg); }
  &:active { opacity: 0.5; }
}

.cat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.cat-tile {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 12px 4px;
  background: var(--parchment);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { background: var(--frame); }
}
.cat-label {
  font-size: 11px;
  color: var(--ink);
  letter-spacing: 0.02em;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: break-word;
  word-break: break-word;
}
</style>
