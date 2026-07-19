<template>
  <view class="page" :class="mpThemeClass" :style="mpChrome">
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack"><UIcon name="chevron-left" size="xs" color="accent-primary" /></view>
      <text class="header-title">{{ t('savedSearch.title') }}</text>
    </view>

    <view class="hint">
      <text>{{ t('savedSearch.hint') }}</text>
    </view>

    <scroll-view class="list" scroll-y :scroll-top="scrollTopVal" :scroll-with-animation="false">
      <view v-if="loading && items.length === 0">
        <view v-for="n in 5" :key="'sk' + n" class="ss-skel">
          <view class="ss-skel-main">
            <view class="ss-skel-line u-sk" style="width: 42%"></view>
            <view class="ss-skel-chips">
              <view class="ss-skel-chip u-sk"></view>
              <view class="ss-skel-chip u-sk"></view>
            </view>
          </view>
          <view class="ss-skel-del u-sk"></view>
        </view>
      </view>
      <view v-else-if="loadError && items.length === 0" class="empty" role="alert" aria-live="assertive" aria-atomic="true">
        <UIcon name="bell" size="xl" color="ink-faint" />
        <text class="empty-text">{{ t('error.loadFailed') }}</text>
        <view class="retry-btn" role="button" :aria-label="t('home.retry')" @click="loadSavedSearchesForCurrentAccount">{{ t('home.retry') }}</view>
      </view>
      <view v-else-if="items.length === 0" class="empty">
        <UIcon name="bell" size="xl" color="ink-faint" />
        <text class="empty-text">{{ t('savedSearch.empty') }}</text>
      </view>
      <view v-else class="u-stagger">
        <view v-for="s in items" :key="s.id" class="ss-card">
          <view class="ss-main">
            <text class="ss-kw">{{ s.keyword }}</text>
            <view class="ss-meta">
              <text v-if="s.listing_type && s.listing_type !== 'both'" class="ss-chip">{{ t('savedSearch.type_' + s.listing_type) }}</text>
              <text v-if="s.category" class="ss-chip">{{ t('cat.' + s.category) }}</text>
              <text v-if="s.price_min || s.price_max" class="ss-chip">
                ${{ s.price_min || 0 }}–${{ s.price_max || '∞' }}
              </text>
            </view>
          </view>
          <view class="ss-del" role="button" :aria-label="t('a11y.delete')" @click="onDelete(s.id)">
            <view class="trash-ico"></view>
          </view>
        </view>
      </view>
    </scroll-view>

    <view class="fab" role="button" :aria-label="t('a11y.addSavedSearch')" @click="openForm">
      <text class="fab-plus">+</text>
    </view>

    <view v-if="showForm" class="sheet-mask" @click="closeForm()"></view>
    <view
      v-if="showForm"
      ref="formDialogEl"
      class="form-sheet open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="saved-search-form-title"
      tabindex="-1"
      @keydown="onFormDialogKeydown"
    >
      <view class="fs-header">
        <text
          class="fs-cancel"
          role="button"
          :aria-label="t('plaza.cancel')"
          @click="closeForm()"
        >{{ t('plaza.cancel') }}</text>
        <text id="saved-search-form-title" class="fs-title">{{ t('savedSearch.new') }}</text>
        <text
          :class="['fs-save', { disabled: !form.keyword.trim() || submitting }]"
          role="button"
          :aria-label="t('editProfile.save')"
          :aria-disabled="!form.keyword.trim() || submitting"
          @click="onSubmit"
        >{{ t('editProfile.save') }}</text>
      </view>
      <view class="fs-body">
        <view class="fs-row">
          <text class="fs-label">{{ t('savedSearch.keyword') }}</text>
          <input
            v-model="form.keyword"
            :placeholder="t('savedSearch.keywordPh')"
            :aria-label="t('savedSearch.keyword')"
            class="fs-input"
            maxlength="60"
          />
        </view>
        <view class="fs-row">
          <text class="fs-label">{{ t('savedSearch.type') }}</text>
          <view class="fs-cats">
            <view
              v-for="lt in listingTypeKeys"
              :key="lt"
              :class="['fs-chip', { active: form.listingType === lt }]"
              role="button"
              :aria-label="t('savedSearch.type_' + lt)"
              :aria-pressed="form.listingType === lt"
              @click="form.listingType = lt"
            >
              <text>{{ t('savedSearch.type_' + lt) }}</text>
            </view>
          </view>
        </view>
        <view class="fs-row">
          <text class="fs-label">{{ t('filter.category') || t('publish.category') }}</text>
          <view class="fs-cats">
            <view
              v-for="c in categoryKeys"
              :key="c || 'any'"
              :class="['fs-chip', { active: form.category === c }]"
              role="button"
              :aria-label="c ? t('cat.' + c) : t('cat.all')"
              :aria-pressed="form.category === c"
              @click="form.category = c as any"
            >
              <text>{{ c ? t('cat.' + c) : t('cat.all') }}</text>
            </view>
          </view>
        </view>
        <view class="fs-row fs-row-price">
          <text class="fs-label">{{ t('filter.price') }}</text>
          <view class="fs-price-wrap">
            <input v-model="form.priceMin" type="number" :placeholder="t('filter.priceMin')" :aria-label="t('filter.priceMin')" class="fs-price-input" />
            <text class="fs-dash">–</text>
            <input v-model="form.priceMax" type="number" :placeholder="t('filter.priceMax')" :aria-label="t('filter.priceMax')" class="fs-price-input" />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, nextTick, watch, onUnmounted } from 'vue'
import { onShow, onHide } from '@dcloudio/uni-app'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useSavedSearch, type SavedSearchListingType } from '../../composables/useSavedSearch'
import { friendlyErrorMessage, BROWSE_CATEGORIES, navigateBackOr } from '../../utils'
import type { ItemCategory } from '../../types'
import UIcon from '../../components/UIcon.vue'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
} from '../../composables/accountScope'

const { t, lang } = useI18n()
const { currentUser, requireAuth, awaitAuthReady } = useAuth()
const { items, fetchMine, create, remove } = useSavedSearch()

const showForm = ref(false)
const formDialogEl = ref<HTMLElement | null>(null)
const submitting = ref(false)
const loading = ref(false)
const loadError = ref(false)
const form = ref<{ keyword: string; category: ItemCategory | null; listingType: SavedSearchListingType; priceMin: string; priceMax: string }>({
  keyword: '',
  category: null,
  listingType: 'sell',
  priceMin: '',
  priceMax: '',
})
const emptyForm = () => ({
  keyword: '',
  category: null as ItemCategory | null,
  listingType: 'sell' as SavedSearchListingType,
  priceMin: '',
  priceMax: '',
})
let pageVisible = false
let pageEpoch = 0
let formDialogOpener: HTMLElement | null = null
let formDialogFocusEpoch = 0

function openForm() {
  if (showForm.value) return
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    formDialogOpener = document.activeElement
  }
  const focusEpoch = ++formDialogFocusEpoch
  showForm.value = true
  nextTick(() => {
    if (focusEpoch !== formDialogFocusEpoch || !showForm.value || typeof document === 'undefined') return
    const dialog = formDialogEl.value
    const firstInput = dialog?.querySelector<HTMLElement>('input:not([disabled])')
    ;(firstInput || dialog)?.focus()
  })
}

function closeForm(restoreFocus = true) {
  if (!showForm.value) {
    // Account transitions / page hides must also cancel a restore that was
    // queued by a just-closed previous-account dialog.
    if (!restoreFocus) {
      formDialogOpener = null
      formDialogFocusEpoch += 1
    }
    return
  }
  const target = formDialogOpener
  formDialogOpener = null
  const focusEpoch = ++formDialogFocusEpoch
  showForm.value = false
  if (!restoreFocus) return
  nextTick(() => {
    if (focusEpoch !== formDialogFocusEpoch || showForm.value || !target || typeof document === 'undefined') return
    if (document.contains(target)) target.focus()
  })
}

function onFormDialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeForm()
    return
  }
  if (event.key !== 'Tab' || typeof document === 'undefined') return
  const dialog = event.currentTarget as HTMLElement | null
  if (!dialog) return
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'input:not([disabled]), textarea:not([disabled]), [role="button"]:not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"])',
  )).filter(element => element.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const index = current ? focusable.indexOf(current) : -1
  if (event.shiftKey && index <= 0) {
    event.preventDefault()
    focusable[focusable.length - 1].focus()
  } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
    event.preventDefault()
    focusable[0].focus()
  }
}

function resetSavedSearchPrivateState() {
  pageEpoch += 1
  closeForm(false)
  submitting.value = false
  loading.value = false
  loadError.value = false
  form.value = emptyForm()
}

const stopAccountTransitionListener = onAccountTransition(resetSavedSearchPrivateState)
onUnmounted(() => {
  pageVisible = false
  pageEpoch += 1
  submitting.value = false
  loading.value = false
  loadError.value = false
  closeForm(false)
  stopAccountTransitionListener()
  formDialogFocusEpoch += 1
  formDialogOpener = null
})

const categoryKeys: (ItemCategory | null)[] = [null, ...BROWSE_CATEGORIES]
const listingTypeKeys: SavedSearchListingType[] = ['sell', 'wanted', 'both']

/*
 * uni-app <scroll-view> remembers its last scrollTop between page shows.
 * Entering via profile's menu would often land the user mid-list. We drive
 * scrollTop through a ref and bump it to 0 on every onShow — the 1 → 0
 * flicker is deliberate because assigning the same number twice in a row
 * doesn't retrigger the scroll reset in uni-app H5.
 */
const scrollTopVal = ref(0)

function resetScroll() {
  scrollTopVal.value = 1
  nextTick(() => { scrollTopVal.value = 0 })
}

async function loadSavedSearchesForCurrentAccount() {
  const requestEpoch = ++pageEpoch
  const state = await awaitAuthReady()
  if (requestEpoch !== pageEpoch || !pageVisible) return
  if (!requireAuth()) {
    if (state === 'authenticated' && !currentUser.value) {
      uni.showToast({ title: t('error.loadFailed'), icon: 'none' })
    }
    return
  }
  const userId = currentUser.value?.id
  if (!userId) return
  const accountToken = captureAccountRequest(userId)
  if (!isAccountRequestCurrent(accountToken)) return
  loadError.value = false
  loading.value = true
  try {
    await fetchMine()
  } catch (err: any) {
    if (requestEpoch !== pageEpoch || !isAccountRequestCurrent(accountToken) || !pageVisible) return
    loadError.value = true
    uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'), icon: 'none', duration: 2500 })
  } finally {
    if (requestEpoch === pageEpoch && isAccountRequestCurrent(accountToken)) loading.value = false
  }
}

onShow(() => {
  pageVisible = true
  resetScroll()
  void loadSavedSearchesForCurrentAccount()
})

onHide(() => {
  pageVisible = false
  pageEpoch += 1
  loading.value = false
  loadError.value = false
  closeForm(false)
})

watch(() => currentUser.value?.id ?? null, (userId, previousUserId) => {
  if (userId === previousUserId || !pageVisible) return
  if (userId) void loadSavedSearchesForCurrentAccount()
  else requireAuth()
})

async function onSubmit() {
  if (!form.value.keyword.trim() || submitting.value) return
  await awaitAuthReady()
  if (submitting.value) return
  if (!requireAuth() || !currentUser.value) return
  const submitAccountToken = captureAccountRequest(currentUser.value.id)
  const submitEpoch = pageEpoch
  if (!isAccountRequestCurrent(submitAccountToken)) return
  // uni-app's number input is typed as a string here, but some runtimes emit
  // a number. Normalize both shapes before validating so a platform-specific
  // model value cannot bypass or crash the guard.
  const priceMinRaw = String(form.value.priceMin ?? '').trim()
  const priceMaxRaw = String(form.value.priceMax ?? '').trim()
  const priceMin = priceMinRaw === '' ? null : Number(priceMinRaw)
  const priceMax = priceMaxRaw === '' ? null : Number(priceMaxRaw)
  if ((priceMin !== null && (!Number.isFinite(priceMin) || priceMin < 0))
    || (priceMax !== null && (!Number.isFinite(priceMax) || priceMax < 0))) {
    uni.showToast({ title: t('savedSearch.invalidPrice'), icon: 'none', duration: 2500 })
    return
  }
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    uni.showToast({ title: t('savedSearch.invalidPriceRange'), icon: 'none', duration: 2500 })
    return
  }
  submitting.value = true
  try {
    await create({
      keyword: form.value.keyword,
      category: form.value.category,
      listingType: form.value.listingType,
      priceMin,
      priceMax,
    })
    if (submitEpoch !== pageEpoch || !isAccountRequestCurrent(submitAccountToken)) return
    closeForm()
    form.value = emptyForm()
    uni.showToast({ title: t('savedSearch.created'), icon: 'success' })
  } catch (err: any) {
    if (submitEpoch !== pageEpoch || !isAccountRequestCurrent(submitAccountToken)) return
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    if (submitEpoch === pageEpoch && isAccountRequestCurrent(submitAccountToken)) submitting.value = false
  }
}

async function onDelete(id: string) {
  const userId = currentUser.value?.id
  if (!userId) return
  const dialogAccountToken = captureAccountRequest(userId)
  const dialogEpoch = pageEpoch
  uni.showModal({
    title: t('savedSearch.deleteConfirm'),
    success: async (res) => {
      if (!res.confirm || dialogEpoch !== pageEpoch || !isAccountRequestCurrent(dialogAccountToken)) return
      try {
        await remove(id)
        if (dialogEpoch !== pageEpoch || !isAccountRequestCurrent(dialogAccountToken)) return
        uni.showToast({ title: t('profile.deleted'), icon: 'success' })
      } catch (err: any) {
        if (dialogEpoch !== pageEpoch || !isAccountRequestCurrent(dialogAccountToken)) return
        uni.showToast({ title: friendlyErrorMessage(err, lang.value as 'en' | 'zh') || t('error.actionFailed'), icon: 'none' })
      }
    },
  })
}

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }
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

.hint {
  padding: 10px 16px; font-size: 12px; color: var(--text-secondary, var(--ink-quiet));
  background: var(--bg-elev-2); border-bottom: 0.5px solid var(--line-hair);
}
.list { padding: 8px 12px 100px; }
.empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 40px; gap: 12px; text-align: center;
}
.empty-text { font-size: 14px; color: var(--text-muted); line-height: 1.5; }
.retry-btn {
  min-height: 44px; padding: 0 20px; border-radius: var(--radius-pill);
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-primary); color: #fff; font-size: 14px; font-weight: 600;
}

.ss-card {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-elev-1); border-radius: 10px;
  padding: 12px 14px; margin-bottom: 8px;
}
.ss-skel {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-elev-1); border-radius: 10px;
  padding: 12px 14px; margin-bottom: 8px;
}
.ss-skel-main { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.ss-skel-line { height: 13px; }
.ss-skel-chips { display: flex; gap: 6px; }
.ss-skel-chip { width: 64px; height: 18px; border-radius: 10px; }
.ss-skel-del { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; }
.ss-main { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.ss-kw { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.ss-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.ss-chip {
  font-size: 11px; padding: 3px 8px;
  background: var(--bg-subtle); color: var(--text-secondary, var(--ink-quiet));
  border-radius: 10px;
}
.ss-del {
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { background: var(--bg-subtle); }
}
.trash-ico {
  width: 14px; height: 16px; border: 1.5px solid var(--text-muted); border-radius: 1px;
  position: relative;
  &::before {
    content: ''; position: absolute; top: -4px; left: -2px; right: -2px;
    height: 2px; background: var(--text-muted); border-radius: 1px;
  }
}

.fab {
  position: fixed; right: 20px; bottom: calc(20px + env(safe-area-inset-bottom));
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent-primary); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-pop);
  cursor: pointer; z-index: 10;
  &:active { transform: scale(0.96); }
}
.fab-plus { color: #fff; font-size: 28px; line-height: 1; }

.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
}
.form-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001;
  background: var(--bg-elev-1); border-radius: 18px 18px 0 0;
  transform: translateY(100%); transition: transform 0.26s ease;
  padding-bottom: env(safe-area-inset-bottom);
  &.open { transform: translateY(0); }
}
.fs-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--line-hair);
}
.fs-cancel, .fs-save { font-size: 14px; cursor: pointer; color: var(--text-secondary, var(--ink-quiet)); }
.fs-save { color: var(--brand); font-weight: 600; &.disabled { color: var(--text-faint); pointer-events: none; } }
.fs-title { font-size: 15px; font-weight: 600; }
.fs-body { padding: 12px 16px 20px; }
.fs-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.fs-label { font-size: 12px; color: var(--text-secondary, var(--ink-quiet)); }
.fs-input {
  height: 40px; box-sizing: border-box;
  padding: 10px 12px; border-radius: 8px;
  background: var(--bg-subtle); font-size: 14px;
}
.fs-cats { display: flex; flex-wrap: wrap; gap: 6px; }
.fs-chip {
  padding: 5px 12px; border-radius: 14px; font-size: 12px;
  background: var(--bg-subtle); color: var(--text-secondary, var(--ink-quiet));
  cursor: pointer;
  &.active { background: var(--ink); color: var(--ink-inverse); }
}
.fs-row-price { }
.fs-price-wrap { display: flex; align-items: center; gap: 8px; }
.fs-price-input {
  height: 40px; box-sizing: border-box;
  flex: 1; padding: 10px 12px; border-radius: 8px;
  background: var(--bg-subtle); font-size: 14px;
}
.fs-dash { color: var(--text-faint); }
</style>
