<template>
  <view class="page has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <AppSidebar current="publish" />

    <!--
      Subpage header with back button — mirrors pages/profile/edit.vue
      (the canonical non-tabbar subpage pattern in this repo). The
      bottom .submit-bar with "Save Changes" button is preserved per
      the Hybrid header decision: thumb-reachable + matches the
      new-publish flow's muscle memory. No top-bar Save action.
    -->
    <view v-if="editReady" class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <UIcon name="chevron-left" size="xs" color="accent-primary" />
      </view>
      <text class="header-title">{{ t('publish.editTitle') }}</text>
    </view>

    <view v-if="!editReady" class="auth-check" role="status" aria-live="polite">
      <text>{{ t('login.wait') }}</text>
    </view>

    <view v-if="editReady" class="form">
      <view class="image-section">
        <view class="image-list">
          <view v-for="(img, i) in imageList" :key="i" class="image-item">
            <image :src="img" :alt="form.title || 'Item photo'" mode="aspectFill" class="preview-image" />
            <view class="remove-btn" role="button" :aria-label="t('a11y.delete')" @click="removeImage(i)">
              <UIcon name="close" size="xs" color="#FFFFFF" aria-hidden="true" />
            </view>
            <view v-if="i === 0" class="cover-tag">
              <text>{{ t('publish.cover') }}</text>
            </view>
          </view>
          <view v-if="imageList.length < 9" class="image-add" role="button" :aria-label="t('publish.addPhoto')" @click="chooseImage">
            <UIcon name="plus" size="sm" color="text-faint" />
            <text class="add-text">{{ t('publish.addPhoto') }}</text>
            <text class="add-count">{{ imageList.length }}/9</text>
          </view>
        </view>
        <text class="image-tip">{{ imageList.length >= 9 ? t('publish.imageMaxReached') : t('publish.imageOptional') }}</text>
      </view>

      <!-- Upload progress -->
      <view v-if="uploadProgress" class="upload-bar">
        <view class="upload-fill" :style="{ width: uploadProgress + '%' }"></view>
        <text class="upload-text">{{ t('publish.uploading') }} {{ uploadProgress }}%</text>
      </view>

      <view class="form-group">
        <input v-model="form.title" :placeholder="form.listingType === 'wanted' ? t('publish.wantedTitlePlaceholder') : t('publish.titlePlaceholder')" :aria-label="form.listingType === 'wanted' ? t('publish.wantedTitlePlaceholder') : t('publish.titlePlaceholder')" maxlength="50" class="form-input title-input" @focus="onFieldFocus" @blur="onFieldBlur" />
        <text class="char-count">{{ form.title.length }}/50</text>
      </view>

      <view class="form-group">
        <textarea v-model="form.description" :placeholder="t('publish.descPlaceholder')" :aria-label="t('publish.descPlaceholder')" maxlength="500" class="form-textarea" @focus="onFieldFocus" @blur="onFieldBlur" />
        <text class="char-count">{{ form.description.length }}/500</text>
      </view>

      <view class="form-group row">
        <text class="label">{{ form.listingType === 'wanted' ? t('publish.budget') : t('publish.price') }}</text>
        <view class="price-input">
          <text class="currency">$</text>
          <input v-model="form.price" type="digit" :placeholder="form.listingType === 'wanted' ? t('publish.budgetPlaceholder') : '0.00'" :aria-label="form.listingType === 'wanted' ? t('publish.budget') : t('publish.price')" class="form-input" @focus="onFieldFocus" @blur="onFieldBlur" />
        </view>
      </view>

      <view v-if="avgPrice > 0 && form.category && form.listingType !== 'wanted'" class="price-hint">
        <text>{{ t('publish.avgPrice') }}: ${{ avgPrice }}</text>
      </view>

      <!-- Category: inline pill selector -->
      <view class="form-group">
        <view
          class="field-header"
          role="button"
          :aria-label="t('publish.category')"
          :aria-expanded="showCat ? 'true' : 'false'"
          aria-controls="edit-category-options"
          @click="showCat = !showCat"
        >
          <text class="label">{{ t('publish.category') }}</text>
          <text :class="['field-value', { placeholder: !form.category }]">
            {{ form.category ? t('cat.' + form.category) : t('publish.categorySelect') }}
          </text>
          <view :class="['chevron', { open: showCat }]"><UIcon name="chevron-right" size="xs" color="text-faint" /></view>
        </view>
        <view v-if="showCat" id="edit-category-options" class="pill-grid">
          <view
            v-for="cat in categoryKeys"
            :key="cat"
            :class="['sel-pill', { active: form.category === cat }]"
            role="button"
            :aria-label="t('cat.' + cat)"
            :aria-pressed="form.category === cat ? 'true' : 'false'"
            @click="onCategoryTap(cat)"
          >
            <text>{{ t('cat.' + cat) }}</text>
            <UIcon v-if="form.category === cat" class="sel-pill-clear" name="close" size="xs" color="currentColor" aria-hidden="true" />
          </view>
        </view>
      </view>

      <!-- Condition: inline pill selector (sell only — N/A for a wanted post) -->
      <view v-if="form.listingType !== 'wanted'" class="form-group">
        <view
          class="field-header"
          role="button"
          :aria-label="t('publish.condition')"
          :aria-expanded="showCond ? 'true' : 'false'"
          aria-controls="edit-condition-options"
          @click="showCond = !showCond"
        >
          <text class="label">{{ t('publish.condition') }}</text>
          <text :class="['field-value', { placeholder: !form.condition }]">
            {{ form.condition ? t('condition.' + form.condition) : t('publish.conditionSelect') }}
          </text>
          <view :class="['chevron', { open: showCond }]"><UIcon name="chevron-right" size="xs" color="text-faint" /></view>
        </view>
        <view v-if="showCond" id="edit-condition-options" class="pill-grid">
          <view
            v-for="cond in conditionKeys"
            :key="cond"
            :class="['sel-pill cond-pill', { active: form.condition === cond }]"
            role="button"
            :aria-label="t('condition.' + cond)"
            :aria-pressed="form.condition === cond ? 'true' : 'false'"
            @click="onConditionTap(cond)"
          >
            <text class="cp-name">{{ t('condition.' + cond) }}</text>
            <text class="cp-hint">{{ t('condition.' + cond + '_hint') }}</text>
            <UIcon v-if="form.condition === cond" class="sel-pill-clear" name="close" size="xs" color="currentColor" aria-hidden="true" />
          </view>
        </view>
      </view>

      <view class="form-group row">
        <text class="label">{{ t('publish.location') }}</text>
        <input v-model="form.location" :placeholder="t('publish.locationPlaceholder')" :aria-label="t('publish.location')" class="form-input flex-input" @focus="onFieldFocus" @blur="onFieldBlur" />
      </view>

      <scroll-view scroll-x class="spot-row">
        <view
          v-for="spot in CAMPUS_SPOTS"
          :key="spot.id"
          class="spot-chip"
          :class="{ active: form.location === spotLabel(spot) }"
          role="button"
          :aria-label="spotLabel(spot)"
          :aria-pressed="form.location === spotLabel(spot) ? 'true' : 'false'"
          @click="onSpotChipTap(spot)"
        >
          {{ spotLabel(spot) }}
        </view>
      </scroll-view>

      <!-- #ifdef H5 -->
      <!-- H5-only: on mp this button would need uni.getLocation, whose
           console 接口申请 is category-gated (individual subjects are
           effectively never approved) — so the mp build drops the button
           (manual location input + spot chips remain) and the manifest
           declares no location APIs at all, keeping that whole review
           risk class off the table. -->
      <view
        class="locate-btn"
        :class="{ 'locate-btn--detecting': detectingLoc }"
        role="button"
        :aria-label="t('a11y.detectLocation')"
        :aria-busy="detectingLoc ? 'true' : 'false'"
        @click="!detectingLoc && onDetectLocation()"
      >
        <view v-if="detectingLoc" class="locate-btn-spinner"></view>
        <image v-else class="locate-btn-icon" src="/static/locate.svg" alt="" mode="aspectFit" />
        <text class="locate-btn-text">{{ detectingLoc ? t('publish.detectingLocation') : t('publish.useCurrentLocation') }}</text>
      </view>
      <OsmAttribution />
      <!-- #endif -->

      <view
        class="form-group row toggle-row"
        role="button"
        :aria-label="t('publish.obo')"
        :aria-pressed="form.negotiable ? 'true' : 'false'"
        @click="form.negotiable = !form.negotiable"
      >
        <text class="label">{{ t('publish.obo') }}</text>
        <text class="toggle-hint">{{ t('publish.oboHint') }}</text>
        <view :class="['toggle', { on: form.negotiable }]">
          <view class="toggle-knob"></view>
        </view>
      </view>
    </view>

    <view v-show="editReady && !typing" class="submit-bar u-glass u-glass--hair-t">
      <button class="submit-btn" :disabled="submitting" @click="onSubmit">
        {{ submitting ? t('publish.submitting') : t('publish.update') }}
      </button>
    </view>
    <!--
      No <CustomTabBar /> here — this is a non-tabbar subpage. Users
      land here via uni.navigateTo from detail / profile and exit via
      the back button or after a successful save (uni.navigateBack).
    -->

    <PermissionDeniedModal
      v-if="editReady"
      :visible="permissionModalVisible"
      @close="permissionModalVisible = false"
    />
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, reactive, watch, onUnmounted } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { useCampusSpots, type CampusSpot } from '../../composables/useCampusSpots'
import { useLocation } from '../../composables/useLocation'
import { useItems, type UploadAccountToken } from '../../composables/useItems'
import { useTranslate } from '../../composables/useTranslate'
import { mutationCommitState, mutationOutcomeError, shouldCompensateMutationFailure } from '../../api/mutationCommit'
import { friendlyErrorMessage, navigateBackOr, PUBLISHABLE_CATEGORIES } from '../../utils'
import { DIALOG_WARN } from '../../utils/dialogColors'
import { captureException } from '../../utils/sentry'
import type { Item, ItemCategory, ItemCondition } from '../../types'
import type { ImageDim } from '../../types'
import AppSidebar from '../../components/AppSidebar.vue'
import PermissionDeniedModal from '../../components/PermissionDeniedModal.vue'
import UIcon from '../../components/UIcon.vue'
import OsmAttribution from '../../components/OsmAttribution.vue'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../../composables/accountScope'

const { t, lang } = useI18n()
const { CAMPUS_SPOTS } = useCampusSpots()

function spotLabel(spot: CampusSpot) {
  return lang.value === 'zh' ? spot.zh : spot.en
}
const { detectLocation, detecting: detectingLoc } = useLocation()
const { currentUser, requireAuth, awaitAuthReady } = useAuth()
const { updateItem, fetchItem, uploadImagesWithDims, removeOwnedItemImages } = useItems()
const { translateItemContent } = useTranslate()

const editId = ref('')
const loadedUpdatedAt = ref('')
const loadedEditableSnapshot = ref('')
let editPageAccountToken: AccountRequestToken | null = null
const editReady = ref(false)
let routeEditId = ''
let editPageMounted = true
let editPageVisible = false
let editPrepareEpoch = 0
let editOperationEpoch = 0
let editNavigationEpoch = 0
let editPageDestroyed = false
let editLoadToastOwned = false
let editLoadToastEpoch = 0

function showOwnedEditLoadToast(title: string, duration = 2000) {
  if (!editPageMounted || !editPageVisible) return
  const toastEpoch = ++editLoadToastEpoch
  editLoadToastOwned = true
  uni.showToast({ title, icon: 'none', duration })
  // Natural expiry releases ownership only; it must never issue a late
  // hideToast that could dismiss a newer page's toast.
  setTimeout(() => {
    if (toastEpoch === editLoadToastEpoch) editLoadToastOwned = false
  }, duration)
}

function hideOwnedEditLoadToast() {
  if (!editLoadToastOwned) return
  editLoadToastOwned = false
  editLoadToastEpoch += 1
  try { uni.hideToast() } catch {}
}

function editableSnapshot(item: Pick<Item,
  'title' | 'description' | 'price' | 'category' | 'condition' | 'location' |
  'images' | 'image_dimensions' | 'negotiable' | 'listing_type'
>): string {
  return JSON.stringify({
    title: item.title,
    description: item.description,
    price: Number(item.price),
    category: item.category,
    condition: item.condition,
    location: item.location || '',
    images: item.images || [],
    image_dimensions: item.image_dimensions || [],
    negotiable: item.negotiable ?? false,
    listing_type: item.listing_type || 'sell',
  })
}

async function commitEditWithCompatibleRetry(
  updates: Parameters<typeof updateItem>[1],
  accountToken?: UploadAccountToken,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await updateItem(
        editId.value,
        updates,
        { expectedUpdatedAt: loadedUpdatedAt.value, accountToken },
      )
    } catch (error: any) {
      if (error?.message !== 'item_edit_conflict' || attempt === 2) throw error
      const current = await fetchItem(editId.value, { incrementView: false })
      if (!accountToken || !isAccountRequestCurrent(accountToken)) {
        throw mutationOutcomeError(new Error('Account changed during edit retry'), 'not_committed')
      }
      if (current.status === 'sold' || current.status === 'deleted') {
        throw new Error('item_not_editable')
      }
      // Ignore version bumps caused only by async i18n enrichment, counters,
      // or other non-editable metadata. Any user-editable field difference is
      // a real concurrent edit and remains fail-closed.
      if (editableSnapshot(current) !== loadedEditableSnapshot.value) throw error
      loadedUpdatedAt.value = current.updated_at
    }
  }
  throw new Error('item_edit_conflict')
}

function goBack() { navigateBackOr(() => uni.switchTab({ url: '/pages/profile/index' })) }

/*
 * Fire-and-forget bilingual filler — same pattern as publish/index.vue.
 * Save UX must not block on translation. The user sees "Updated!" toast
 * and navigateBack immediately; the translator runs in the background
 * and patches title_i18n / description_i18n via updateItem if it gets
 * back something useful before the page unloads. If it fails, the
 * existing reader-side fallback (`map[lang] ?? original`) keeps showing
 * the author's text in whatever language they typed.
 */
async function scheduleBilingualFill(
  itemId: string,
  title: string,
  description: string,
  sourceLang: string,
  expectedUpdatedAt: string,
  accountToken: UploadAccountToken,
) {
  try {
    if (!title && !description) return
    const { title_i18n, description_i18n } = await translateItemContent({
      title,
      description,
      sourceLang: sourceLang as any,
    })
    const titleKeys = Object.keys(title_i18n)
    const descKeys = Object.keys(description_i18n)
    if (titleKeys.length <= 1 && descKeys.length <= 1) return

    await updateItem(itemId, {
      title_i18n: Object.keys(title_i18n).length ? title_i18n : null,
      description_i18n: Object.keys(description_i18n).length ? description_i18n : null,
    }, { expectedUpdatedAt, accountToken })
  } catch (err) {
    console.warn('[publish-edit] bilingual fill skipped')
  }
}

const { supabase } = useSupabase()
const avgPrice = ref(0)
let avgPriceRequestId = 0

const categoryKeys: ItemCategory[] = PUBLISHABLE_CATEGORIES
const conditionKeys = ['new', 'like_new', 'good', 'fair', 'defective']

const imageList = ref<string[]>([])
const originalImageUrls = ref<string[]>([])
// Keep dimensions index-aligned with imageList. `{ w: 0, h: 0 }` is an
// explicit unknown slot that render helpers already treat as a fallback.
const imageDimensions = ref<ImageDim[]>([])
const showCat = ref(false)
const showCond = ref(false)
const submitting = ref(false)
let submitEntryLocked = false
const uploadProgress = ref(0)

/* Same phone-viewport bar hiding as publish/index — with the keyboard
   open the fixed save bar wedges in right above it. */
const typing = ref(false)
let typingT: ReturnType<typeof setTimeout> | null = null
function isPhoneViewport(): boolean {
  // #ifdef H5
  return typeof window !== 'undefined' && window.innerWidth < 768
  // #endif
  // #ifndef H5
  return true
  // #endif
}
function onFieldFocus() {
  if (!isPhoneViewport()) return
  if (typingT) clearTimeout(typingT)
  typing.value = true
}
function onFieldBlur() {
  if (typingT) clearTimeout(typingT)
  typingT = setTimeout(() => { typing.value = false }, 120)
}

const form = reactive({
  title: '',
  description: '',
  price: '',
  category: '' as ItemCategory | '',
  condition: '' as ItemCondition | '',
  location: '',
  negotiable: false,
  listingType: 'sell' as 'sell' | 'wanted',
})

/*
 * Phase 1b: permission_denied now opens a modal (LocationPermission
 * DeniedModal) instead of a fleeting toast. The modal teaches users
 * the Settings path; other failure reasons stay as toast since
 * they're either retryable or environmental. Mirrors publish/index.vue
 * per handoff §11 A9 (twin publish surfaces require lockstep).
 */
const permissionModalVisible = ref(false)

function onCategoryTap(cat: ItemCategory) {
  form.category = form.category === cat ? '' : cat
  showCat.value = false
}
function onConditionTap(cond: string) {
  form.condition = (form.condition === cond ? '' : cond) as ItemCondition | ''
  showCond.value = false
}

/*
 * Edit-mode load: read ?id=<itemId> and prefill the form from the
 * existing row. If the id is missing OR fetchItem rejects (item
 * deleted, RLS denies, network blip), surface a friendly toast and
 * auto-navigate back instead of leaving the user on a stuck-empty
 * form with a Save button that would fail server-side anyway.
 *
 * The bare `?id=` requirement is enforced first because reaching this
 * page without an id is illegitimate — the only callers are detail
 * and profile, both of which always pass an id. A bare URL means a
 * hand-crafted attempt or a stale deep link; same UX response works.
 */
function resetEditForm() {
  form.title = ''
  form.description = ''
  form.price = ''
  form.category = ''
  form.condition = ''
  form.location = ''
  form.negotiable = false
  form.listingType = 'sell'
  imageList.value = []
  originalImageUrls.value = []
  imageDimensions.value = []
  loadedUpdatedAt.value = ''
  loadedEditableSnapshot.value = ''
  showCat.value = false
  showCond.value = false
}

function resetEditPrivateState() {
  editPrepareEpoch += 1
  editOperationEpoch += 1
  editReady.value = false
  editPageAccountToken = null
  editId.value = ''
  submitEntryLocked = false
  submitting.value = false
  uploadProgress.value = 0
  permissionModalVisible.value = false
  avgPriceRequestId += 1
  avgPrice.value = 0
  if (typingT) {
    clearTimeout(typingT)
    typingT = null
  }
  typing.value = false
  resetEditForm()
}

async function prepareEditPage(itemId: string) {
  const prepareEpoch = ++editPrepareEpoch
  const navigationEpoch = editNavigationEpoch
  const prepareStillVisible = () => (
    editPageMounted
    && editPageVisible
    && prepareEpoch === editPrepareEpoch
    && navigationEpoch === editNavigationEpoch
  )
  editReady.value = false
  const state = await awaitAuthReady()
  if (!prepareStillVisible()) return
  if (!requireAuth() || !currentUser.value) {
    if (state === 'authenticated' && prepareStillVisible()) {
      showOwnedEditLoadToast(t('error.loadFailed'), 1500)
      setTimeout(() => {
        if (prepareStillVisible()) goBack()
      }, 1200)
    }
    return
  }
  const accountToken = captureAccountRequest(currentUser.value.id)
  if (!isAccountRequestCurrent(accountToken)) return
  editPageAccountToken = accountToken
  editId.value = itemId
  try {
    const item = await fetchItem(itemId, { incrementView: false })
    if (
      !prepareStillVisible()
      || editPageAccountToken !== accountToken
      || !isAccountRequestCurrent(accountToken)
      || item.user_id !== accountToken.userId
    ) return
    if (item.status === 'sold' || item.status === 'deleted') {
      showOwnedEditLoadToast(t('publish.itemNotEditable'))
      setTimeout(() => {
        if (
          prepareStillVisible()
          && isAccountRequestCurrent(accountToken)
        ) {
          goBack()
        }
      }, 1500)
      return
    }
    form.title = item.title
    form.description = item.description
    form.price = String(item.price)
    form.category = item.category
    form.condition = item.condition
    form.location = item.location
    form.negotiable = item.negotiable ?? false
    form.listingType = (item.listing_type || 'sell') as 'sell' | 'wanted'
    imageList.value = [...item.images]
    originalImageUrls.value = [...item.images]
    loadedUpdatedAt.value = item.updated_at
    loadedEditableSnapshot.value = editableSnapshot(item)
    imageDimensions.value = item.images.map((_, index) => {
      const dim = item.image_dimensions?.[index]
      return dim && dim.w > 0 && dim.h > 0 ? dim : { w: 0, h: 0 }
    })
    editReady.value = true
  } catch (err) {
    if (
      !prepareStillVisible()
      || !isAccountRequestCurrent(accountToken)
    ) return
    console.error('[publish-edit] fetch item failed')
    showOwnedEditLoadToast(t('publish.editFetchFailed'))
    setTimeout(() => {
      if (
        prepareStillVisible()
        && isAccountRequestCurrent(accountToken)
      ) {
        goBack()
      }
    }, 1500)
  }
}

const stopAccountTransitionListener = onAccountTransition((transition) => {
  resetEditPrivateState()
  if (transition.userId && editPageVisible && routeEditId) {
    void Promise.resolve().then(() => {
      if (editPageMounted && editPageVisible && routeEditId) return prepareEditPage(routeEditId)
    })
  }
})

function destroyEditPage() {
  if (editPageDestroyed) return
  editPageDestroyed = true
  // uni-app can defer Vue unmount after the native page has already left the
  // stack. Invalidate every pending fetch/timer in onUnload itself so an old
  // edit page cannot navigateBack from whatever route is now visible.
  editPageMounted = false
  editPageVisible = false
  editNavigationEpoch += 1
  hideOwnedEditLoadToast()
  routeEditId = ''
  resetEditPrivateState()
  stopAccountTransitionListener()
}

onLoad((options) => {
  routeEditId = typeof options?.id === 'string' ? options.id : ''
})

onShow(() => {
  if (!editPageMounted) return
  editPageVisible = true
  if (!routeEditId) {
    const invalidRouteEpoch = editPrepareEpoch
    const invalidRouteNavigationEpoch = editNavigationEpoch
    showOwnedEditLoadToast(t('publish.editFetchFailed'))
    setTimeout(() => {
      if (
        editPageMounted
        && editPageVisible
        && invalidRouteEpoch === editPrepareEpoch
        && invalidRouteNavigationEpoch === editNavigationEpoch
        && !routeEditId
      ) goBack()
    }, 1500)
    return
  }
  if (!editReady.value) void prepareEditPage(routeEditId)
})

onHide(() => {
  editPageVisible = false
  editNavigationEpoch += 1
  hideOwnedEditLoadToast()
})
onUnload(destroyEditPage)

onUnmounted(destroyEditPage)

watch(() => form.category, async (cat) => {
  const requestId = ++avgPriceRequestId
  if (!cat) { avgPrice.value = 0; return }
  const { data } = await supabase.from('items').select('price').eq('category', cat).eq('status', 'active').limit(50)
  if (requestId !== avgPriceRequestId) return
  if (data && data.length > 0) {
    avgPrice.value = Math.round(data.reduce((s: number, i: any) => s + Number(i.price), 0) / data.length)
  } else { avgPrice.value = 0 }
})

const MAX_IMAGES_PUBLISH = 9

function chooseImage() {
  const pickerAccountToken = editPageAccountToken
  if (
    !editReady.value
    || !pickerAccountToken
    || !isAccountRequestCurrent(pickerAccountToken)
  ) return
  const remaining = MAX_IMAGES_PUBLISH - imageList.value.length
  if (remaining <= 0) {
    uni.showToast({ title: t('publish.imageMaxReached'), icon: 'none' })
    return
  }
  uni.chooseImage({
    count: remaining,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      if (
        !editReady.value
        || editPageAccountToken !== pickerAccountToken
        || !isAccountRequestCurrent(pickerAccountToken)
      ) return
      const picked = Array.isArray(res.tempFilePaths)
        ? res.tempFilePaths
        : res.tempFilePaths ? [res.tempFilePaths] : []
      const accepted = picked.slice(0, remaining)
      const dropped = picked.length - accepted.length
      imageList.value.push(...accepted)
      imageDimensions.value.push(...accepted.map(() => ({ w: 0, h: 0 })))
      if (dropped > 0) {
        uni.showToast({
          title: t('publish.imageDropped').replace('{n}', String(dropped)),
          icon: 'none',
          duration: 2500,
        })
      }
    },
  })
}

function removeImage(index: number) {
  imageList.value.splice(index, 1)
  imageDimensions.value.splice(index, 1)
}

async function onDetectLocation() {
  const locationAccountToken = editPageAccountToken
  if (
    !editReady.value
    || !locationAccountToken
    || !isAccountRequestCurrent(locationAccountToken)
  ) return
  const result = await detectLocation()
  if (
    !editReady.value
    || editPageAccountToken !== locationAccountToken
    || !isAccountRequestCurrent(locationAccountToken)
  ) return
  if (!result.ok) {
    console.warn('[publish-edit] location detect failed')
    /*
     * Phase 1b dispatch: permission_denied → modal (teach the
     * Settings path), other reasons → toast. Mirrors publish/index.vue
     * onDetectLocation character-for-character (modulo debug prefix)
     * per handoff §11 A9 twin-surface lockstep rule.
     */
    if (result.reason === 'permission_denied') {
      permissionModalVisible.value = true
      return
    }
    const reasonKey: Record<string, string> = {
      permission_prompt_dismissed: 'publish.gpsPermissionDismissed',
      position_unavailable: 'publish.gpsUnavailable',
      timeout: 'publish.gpsTimeout',
      geocode_failed: 'publish.gpsGeocodeFailed',
      unsupported: 'publish.gpsUnsupported',
    }
    uni.showToast({
      title: t(reasonKey[result.reason] || 'publish.gpsUnknownError'),
      icon: 'none',
      duration: 2500,
    })
    return
  }
  form.location = result.location
}

function onSpotChipTap(spot: CampusSpot) {
  const label = spotLabel(spot)
  form.location = label
}

async function onSubmit() {
  // Lock before auth readiness and the high-price confirmation modal so
  // rapid clicks cannot launch two edit/upload transactions in parallel.
  if (submitEntryLocked) return
  submitEntryLocked = true
  const operationEpoch = ++editOperationEpoch
  const operationNavigationEpoch = editNavigationEpoch
  const entryAccountToken = editPageAccountToken
  const operationStillCurrent = () => (
    operationEpoch === editOperationEpoch
    && operationNavigationEpoch === editNavigationEpoch
    && editPageMounted
    && editPageVisible
    && editReady.value
    && entryAccountToken !== null
    && editPageAccountToken === entryAccountToken
    && isAccountRequestCurrent(entryAccountToken)
  )
  try {
  await awaitAuthReady()
  if (!operationStillCurrent()) return
  if (!requireAuth()) return
  if (!form.title.trim()) { uni.showToast({ title: t('publish.needTitle'), icon: 'none' }); return }
  const rawPrice = form.price.trim()
  const price = rawPrice === '' && form.listingType === 'wanted'
    ? 0
    : /^\d+(?:\.\d{1,2})?$/.test(rawPrice)
      ? Number(rawPrice)
      : Number.NaN
  if (!Number.isFinite(price) || price < 0) { uni.showToast({ title: t('publish.needPrice'), icon: 'none' }); return }
  if (!form.category) { uni.showToast({ title: t('publish.needCategory'), icon: 'none' }); return }
  if (form.listingType !== 'wanted' && !form.condition) { uni.showToast({ title: t('publish.needCondition'), icon: 'none' }); return }
  if (price > 100000) {
    const confirmed = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: t('publish.priceTooHigh'),
        content: t('publish.priceTooHighBody'),
        confirmText: t('publish.priceTooHighConfirm'),
        cancelText: t('publish.priceTooHighCancel'),
        confirmColor: DIALOG_WARN,
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed || !operationStillCurrent()) return
  }

  if (!operationStillCurrent() || !entryAccountToken) {
    uni.showToast({ title: t('publish.fail'), icon: 'none' })
    return
  }
  const submitAccountToken = entryAccountToken

  submitting.value = true
  uploadProgress.value = 0
  let uploadedForCleanup: string[] = []
  let uploadAccountToken: UploadAccountToken | null = null
  let updateCommitted = false
  try {
    const existing: string[] = []
    const existingDims: ImageDim[] = []
    const toUpload: string[] = []
    for (const [index, img] of imageList.value.entries()) {
      if (img.startsWith('http')) {
        existing.push(img)
        const dim = imageDimensions.value[index]
        existingDims.push(dim && dim.w > 0 && dim.h > 0 ? dim : { w: 0, h: 0 })
      }
      else toUpload.push(img)
    }
    let uploaded: string[] = []
    let uploadedDims: Array<{ w: number; h: number }> = []
    if (toUpload.length > 0) {
      try {
        const res = await uploadImagesWithDims(toUpload, {
          entryPoint: 'publish',
          accountToken: submitAccountToken,
        })
        uploaded = res.urls
        uploadedForCleanup = [...res.urls]
        uploadedDims = res.dims
        uploadAccountToken = res.accountToken
        if (
          res.accountToken.userId !== submitAccountToken.userId
          || res.accountToken.generation !== submitAccountToken.generation
          || !isAccountRequestCurrent(submitAccountToken)
        ) {
          throw mutationOutcomeError(new Error('Account changed during item edit upload'), 'not_committed')
        }
      } catch (upErr: any) {
        if (upErr?.heic === true) throw new Error(t('heic.unsupported'))
        throw new Error(upErr?.message || t('publish.uploadFailed'))
      }
      uploadProgress.value = 100
      if (uploaded.length === 0) {
        throw new Error(t('publish.uploadFailed'))
      }
      if (uploaded.length < toUpload.length) {
        if (!operationStillCurrent()) {
          throw mutationOutcomeError(new Error('Account changed during item edit upload'), 'not_committed')
        }
        uni.showToast({
          title: t('publish.imagesUploaded', { done: uploaded.length, total: toUpload.length }),
          icon: 'none',
          duration: 4000,
        })
      }
    }

    const images = [...existing, ...uploaded]
    const finalDims: ImageDim[] = [...existingDims, ...uploadedDims]

    const trimmedTitle = form.title.trim()
    const trimmedDesc = form.description.trim()
    const sourceLang = lang.value

    const payload = {
      title: trimmedTitle,
      description: trimmedDesc,
      // Wanted post: blanked budget → 0 (open budget); condition N/A → keep the
      // column default. listing_type is intentionally NOT updated (immutable
      // once posted — a sell item stays sell and vice versa).
      price,
      category: form.category as ItemCategory,
      condition: (form.condition || 'good') as ItemCondition,
      location: form.location || '',
      images,
      image_dimensions: finalDims,
      title_i18n: trimmedTitle ? { [sourceLang]: trimmedTitle } : null,
      description_i18n: trimmedDesc ? { [sourceLang]: trimmedDesc } : null,
      source_lang: sourceLang,
      negotiable: form.negotiable,
    }

    const updatedItem = await commitEditWithCompatibleRetry(
      { ...payload },
      submitAccountToken,
    )
    if (!operationStillCurrent()) {
      throw mutationOutcomeError(new Error('Account changed after item edit'), 'committed')
    }
    updateCommitted = true
    loadedUpdatedAt.value = updatedItem.updated_at
    const removedImages = originalImageUrls.value.filter(url => !images.includes(url))
    // Commit the uploaded URLs/dimensions as the new local baseline before
    // re-enabling Save in finally. Without this, a fast second click during
    // the delayed navigateBack window re-uploaded the same temp file and left
    // the first object orphaned.
    imageList.value = [...images]
    imageDimensions.value = [...finalDims]
    originalImageUrls.value = [...images]
    loadedEditableSnapshot.value = editableSnapshot(updatedItem)
    if (removedImages.length > 0) {
      try {
        await removeOwnedItemImages(removedImages, {
          ownerUserId: updatedItem.user_id,
          telemetrySource: 'publish.edit_removed_image_cleanup',
        })
      } catch (cleanupError) {
        captureException(cleanupError, { tags: { source: 'publish.edit_removed_image_cleanup' }, level: 'warning' })
      }
    }
    if (!operationStillCurrent()) return
    uni.showToast({ title: t('publish.updated'), icon: 'success' })
    scheduleBilingualFill(
      editId.value,
      trimmedTitle,
      trimmedDesc,
      sourceLang,
      updatedItem.updated_at,
      submitAccountToken,
    )
    // Keep both locks held through the success acknowledgement. Releasing in
    // finally while a detached timer was pending allowed a second Save to race
    // the first bilingual fill and surface a false edit conflict.
    await new Promise<void>((resolve) => setTimeout(resolve, 1500))
    if (operationStillCurrent()) goBack()
  } catch (error: any) {
    if (!updateCommitted && shouldCompensateMutationFailure(error) && uploadedForCleanup.length > 0) {
      try {
        await removeOwnedItemImages(uploadedForCleanup, {
          ownerUserId: uploadAccountToken?.userId,
          telemetrySource: 'publish.edit_upload_cleanup',
        })
      } catch (cleanupError) {
        captureException(cleanupError, { tags: { source: 'publish.edit_upload_cleanup' }, level: 'warning' })
      }
    } else if (!updateCommitted && mutationCommitState(error) === 'unknown' && uploadedForCleanup.length > 0) {
      captureException(error, {
        tags: { source: 'publish.edit_commit_unknown', orphan_risk: 'true' },
        extra: { objectCount: uploadedForCleanup.length },
        level: 'warning',
      })
    }
    if (!operationStillCurrent()) return
    if (error?.message === 'Invalid price') {
      uni.showToast({ title: t('publish.priceExceedsLimit'), icon: 'none', duration: 3000 })
      return
    }
    if (error?.message === 'item_edit_conflict') {
      uni.showToast({ title: t('publish.editConflict'), icon: 'none', duration: 3000 })
      await new Promise<void>((resolve) => setTimeout(resolve, 1800))
      if (operationStillCurrent()) goBack()
      return
    }
    if (error?.message === 'item_not_editable') {
      uni.showToast({ title: t('publish.itemNotEditable'), icon: 'none', duration: 3000 })
      await new Promise<void>((resolve) => setTimeout(resolve, 1800))
      if (operationStillCurrent()) goBack()
      return
    }
    captureException(error, { tags: { source: 'publish.edit' }, level: 'error' })
    uni.showToast({
      title: friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('publish.fail'),
      icon: 'none',
      duration: 3000,
    })
  } finally {
    if (operationEpoch === editOperationEpoch) {
      submitting.value = false
      uploadProgress.value = 0
    }
  }
  } finally {
    if (operationEpoch === editOperationEpoch) submitEntryLocked = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-subtle);
  padding-bottom: calc(72px + 62px); max-width: 480px; margin: 0 auto;
}
.auth-check { min-height: 60vh; display: flex; align-items: center; justify-content: center; color: var(--text-subtle); }

/*
  ========== Header (subpage style with back button) ==========
  Replaces the sticky title-only .page-header used in publish/index.vue.
  Mirrors pages/profile/edit.vue's header so the two edit-flow subpages
  have a consistent shape. .header-title gets padding-right equal to
  the back-btn width (32px) so the title is visually centered without
  needing a right-side spacer view.
*/
.header {
  display: flex; align-items: center; padding: 12px 16px;
  padding-top: calc(12px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
  position: sticky; top: 0; z-index: 50;
}
.back-btn {
  width: 32px; height: 32px; display: flex;
  align-items: center; justify-content: center; cursor: pointer;
}
.header-title {
  flex: 1; text-align: center; font-size: 17px; font-weight: 600;
  color: var(--text-primary); padding-right: 32px;
}

/* ========== Form (verbatim from publish/index.vue) ========== */
.form { background: var(--bg-elev-1); }
.image-section { padding: 16px; }
.image-list { display: flex; flex-wrap: wrap; gap: 9px; }
.image-item { position: relative; width: 96px; height: 96px; }
.preview-image { width: 100%; height: 100%; border-radius: 9px; object-fit: cover; }
.remove-btn {
  position: absolute; top: -5px; right: -5px;
  width: 32px; height: 32px; background: rgba(0,0,0,0.62); backdrop-filter: blur(4px);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.cover-tag {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
  border-radius: 0 0 9px 9px; text-align: center; padding: 2px 0;
  text { font-size: 10px; color: #fff; font-weight: 500; }
}
.image-add {
  width: 96px; height: 96px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px; cursor: pointer;
  transition: background var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { background: var(--paper-2); }
}
.add-text { font-size: 11px; color: var(--text-subtle); }
.add-count { font-size: 10px; color: var(--text-subtle); margin-top: 2px; font-variant-numeric: tabular-nums; }
.image-tip { font-size: 12px; color: var(--text-subtle); margin-top: 8px; }

/* ========== Upload Progress ========== */
.upload-bar {
  position: relative; height: 28px; margin: 0 16px 8px;
  background: var(--bg-subtle); border-radius: 6px; overflow: hidden;
}
.upload-fill {
  position: absolute; top: 0; bottom: 0; left: 0;
  background: var(--line-hair);
  transition: width 0.3s ease;
}
.upload-text {
  position: relative; z-index: 1;
  font-size: 12px; color: var(--text-secondary); font-weight: 500;
  line-height: 28px; padding-left: 10px;
}

/* ========== Form Groups ========== */
.form-group {
  padding: 13px 16px;
  border-bottom: 0.5px solid var(--line-hair);
  &.row { display: flex; align-items: center; }
}
.label { font-size: 15px; color: var(--text-primary); min-width: 64px; flex-shrink: 0; font-weight: 500; padding-right: 8px; }
.form-input { font-size: 15px; width: 100%; color: var(--text-primary); }
.title-input { font-size: 17px; font-weight: 600; }
.form-textarea { width: 100%; height: 110px; font-size: 15px; line-height: 1.6; color: var(--text-primary); overflow-y: auto; word-break: normal; overflow-wrap: break-word; }
.price-input {
  display: flex; align-items: center; flex: 1;
  .currency { font-size: 17px; color: var(--text-primary); font-weight: 700; margin-right: 4px; }
}
.flex-input { flex: 1; }
.char-count { display: block; text-align: right; font-size: 11px; color: var(--text-subtle); margin-top: 4px; }
.price-hint { padding: 0 16px 8px; font-size: 12px; color: var(--text-muted); }

.field-header {
  display: flex; align-items: center; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.field-value {
  flex: 1; text-align: right; font-size: 15px; color: var(--text-primary);
  &.placeholder { color: var(--text-subtle); }
}
.chevron {
  display: flex; margin-left: 8px;
  transition: transform 0.2s;
  &.open { transform: rotate(90deg); }
}

.pill-grid {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding-top: 12px; animation: fadeIn 0.15s ease;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.sel-pill {
  padding: 7px 14px; border-radius: 8px; font-size: 13px;
  background: var(--bg-subtle); color: var(--text-secondary); cursor: pointer;
  transition: all 0.12s; font-weight: 500;
  position: relative;
  &.active {
    background: var(--accent-primary); color: #fff;
    padding-right: 26px;
  }
  &:active { transform: scale(0.96); }
}
.sel-pill-clear { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); opacity: 0.72; }
.cond-pill {
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  padding: 8px 14px;
  min-width: 112px;
}
.cp-name { font-size: 13px; font-weight: 600; }
.cp-hint { font-size: 10px; opacity: 0.7; line-height: 1.25; }
.cond-pill.active .cp-hint { color: rgba(255,255,255,0.8); }

/* ========== Location ========== */
.spot-row {
  white-space: nowrap;
  padding: 0 0 8px 0;
  margin-top: 4px;
}
.spot-chip {
  display: inline-block;
  padding: 6px 12px;
  margin-right: 8px;
  background: var(--bg-subtle);
  color: var(--text-primary);
  font-size: 13px;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.15s;
  &:active { background: var(--bg-inset); }
  &.active { background: var(--accent-primary); color: #fff; }
}
.locate-btn {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 12px 14px;
  /* Keep the edit flow visually identical to new-publish and off the
     viewport edge on narrow Safari screens. */
  margin: 10px 16px 0;
  background: var(--bg-subtle);
  border: 1px solid var(--border-strong, var(--bg-inset));
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:active {
    background: var(--bg-inset);
  }

  &--detecting {
    pointer-events: none;
    opacity: 0.75;
  }
}

.locate-btn-icon {
  width: 18px;
  height: 18px;
  display: block;
  flex-shrink: 0;
}

.locate-btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--bg-inset);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.locate-btn-text {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ========== Toggle ========== */
.toggle-row { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.toggle-hint { flex: 1; font-size: 13px; color: var(--text-subtle); text-align: right; margin-right: 10px; }
.toggle {
  width: 44px; height: 26px; border-radius: 13px;
  background: var(--border-strong);
  position: relative; transition: background var(--dur-2, 220ms) var(--ease-std, ease);
  flex-shrink: 0;
  &.on { background: var(--success); }
}
.toggle-knob {
  width: 22px; height: 22px; border-radius: 50%; background: var(--bg-elev-1);
  position: absolute; top: 2px; left: 2px; transition: transform 0.25s;
  box-shadow: var(--shadow-soft);
}
.toggle.on .toggle-knob { transform: translateX(18px); }

/*
  ========== Submit (Hybrid header decision) ==========
  This subpage keeps the bottom .submit-bar with the "Save Changes"
  button instead of moving Save into the top header. The 56px bottom
  offset accounts for the absent CustomTabBar — but mp-weixin and H5
  agree: position:fixed / safe-area-inset-bottom is the same calc as
  publish/index.vue. Kept identical so users get muscle-memory match
  with the new-publish flow.
*/
.submit-bar {
  position: fixed; bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 480px; padding: 9px 16px;
  /* fill + blur + top hairline come from .u-glass + .u-glass--hair-t */
  z-index: 40;
}
.submit-btn {
  width: 100%; height: 46px; background: var(--accent-primary); color: #fff;
  border-radius: 23px; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; border: none;
  &[disabled] { opacity: 0.3; }
  &:active { opacity: 0.8; }
}

@media (min-width: 768px) {
  /* Adaptive shell: rail reserves the left; fill + center the form, and
     re-center the fixed submit bar under the 720px form column. */
  .page { max-width: none; margin: 0; }
  /* Keep the back button reachable on desktop (the sidebar is global nav,
     not "return to the item you came from") and align it with the form. */
  .header { max-width: 720px; margin-left: auto; margin-right: auto; }
  .form { max-width: 720px; margin-left: auto; margin-right: auto; }
  .submit-bar { bottom: 0; left: var(--sidebar-w); right: 0; width: auto; max-width: 720px; margin-left: auto; margin-right: auto; transform: none; }
}
</style>
