<template>
  <view class="page">
    <DesktopNav current="publish" />

    <!--
      Subpage header with back button — mirrors pages/profile/edit.vue
      (the canonical non-tabbar subpage pattern in this repo). The
      bottom .submit-bar with "Save Changes" button is preserved per
      the Hybrid header decision: thumb-reachable + matches the
      new-publish flow's muscle memory. No top-bar Save action.
    -->
    <view class="header">
      <view class="back-btn" role="button" :aria-label="t('a11y.back')" @click="goBack">
        <view class="back-arrow"></view>
      </view>
      <text class="header-title">{{ t('publish.editTitle') }}</text>
    </view>

    <view class="form">
      <view class="image-section">
        <view class="image-list">
          <view v-for="(img, i) in imageList" :key="i" class="image-item">
            <image :src="img" :alt="form.title || 'Item photo'" mode="aspectFill" class="preview-image" />
            <view class="remove-btn" role="button" :aria-label="t('a11y.delete')" @click="removeImage(i)">
              <view class="remove-x"></view>
            </view>
            <view v-if="i === 0" class="cover-tag">
              <text>{{ t('publish.cover') }}</text>
            </view>
          </view>
          <view v-if="imageList.length < 9" class="image-add" @click="chooseImage">
            <view class="add-icon-css"></view>
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
        <input v-model="form.title" :placeholder="t('publish.titlePlaceholder')" maxlength="50" class="form-input title-input" />
        <text class="char-count">{{ form.title.length }}/50</text>
      </view>

      <view class="form-group">
        <textarea v-model="form.description" :placeholder="t('publish.descPlaceholder')" maxlength="500" class="form-textarea" />
        <text class="char-count">{{ form.description.length }}/500</text>
      </view>

      <view class="form-group row">
        <text class="label">{{ t('publish.price') }}</text>
        <view class="price-input">
          <text class="currency">$</text>
          <input v-model="form.price" type="digit" placeholder="0.00" class="form-input" />
        </view>
      </view>

      <view v-if="avgPrice > 0 && form.category" class="price-hint">
        <text>{{ t('publish.avgPrice') }}: ${{ avgPrice }}</text>
      </view>

      <!-- Category: inline pill selector -->
      <view class="form-group">
        <view class="field-header" @click="showCat = !showCat">
          <text class="label">{{ t('publish.category') }}</text>
          <text :class="['field-value', { placeholder: !form.category }]">
            {{ form.category ? t('cat.' + form.category) : t('publish.categorySelect') }}
          </text>
          <view :class="['chevron', { open: showCat }]"></view>
        </view>
        <view v-if="showCat" class="pill-grid">
          <view
            v-for="cat in categoryKeys"
            :key="cat"
            :class="['sel-pill', { active: form.category === cat }]"
            @click="onCategoryTap(cat)"
          >
            <text>{{ t('cat.' + cat) }}</text>
          </view>
        </view>
      </view>

      <!-- Condition: inline pill selector -->
      <view class="form-group">
        <view class="field-header" @click="showCond = !showCond">
          <text class="label">{{ t('publish.condition') }}</text>
          <text :class="['field-value', { placeholder: !form.condition }]">
            {{ form.condition ? t('condition.' + form.condition) : t('publish.conditionSelect') }}
          </text>
          <view :class="['chevron', { open: showCond }]"></view>
        </view>
        <view v-if="showCond" class="pill-grid">
          <view
            v-for="cond in conditionKeys"
            :key="cond"
            :class="['sel-pill cond-pill', { active: form.condition === cond }]"
            @click="onConditionTap(cond)"
          >
            <text class="cp-name">{{ t('condition.' + cond) }}</text>
            <text class="cp-hint">{{ t('condition.' + cond + '_hint') }}</text>
          </view>
        </view>
      </view>

      <view class="form-group row">
        <text class="label">{{ t('publish.location') }}</text>
        <input v-model="form.location" :placeholder="t('publish.locationPlaceholder')" class="form-input flex-input" />
      </view>

      <scroll-view scroll-x class="spot-row">
        <view
          v-for="spot in CAMPUS_SPOTS"
          :key="spot.id"
          class="spot-chip"
          :class="{ active: form.location === spotLabel(spot) }"
          @click="onSpotChipTap(spot)"
        >
          {{ spotLabel(spot) }}
        </view>
      </scroll-view>

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

      <view class="form-group row toggle-row" @click="form.negotiable = !form.negotiable">
        <text class="label">{{ t('publish.obo') }}</text>
        <text class="toggle-hint">{{ t('publish.oboHint') }}</text>
        <view :class="['toggle', { on: form.negotiable }]">
          <view class="toggle-knob"></view>
        </view>
      </view>
    </view>

    <view class="submit-bar">
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
      :visible="permissionModalVisible"
      @close="permissionModalVisible = false"
    />
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { useCampusSpots, matchSpot, type CampusSpot } from '../../composables/useCampusSpots'
import { useLocation } from '../../composables/useLocation'
import { useItems } from '../../composables/useItems'
import { useTranslate } from '../../composables/useTranslate'
import { friendlyErrorMessage } from '../../utils'
import { DIALOG_WARN } from '../../utils/dialogColors'
import type { ItemCategory, ItemCondition } from '../../types'
import DesktopNav from '../../components/DesktopNav.vue'
import PermissionDeniedModal from '../../components/PermissionDeniedModal.vue'

const { t, lang } = useI18n()
const { CAMPUS_SPOTS } = useCampusSpots()

function spotLabel(spot: CampusSpot) {
  return lang.value === 'zh' ? spot.zh : spot.en
}
const { detectLocation, detecting: detectingLoc } = useLocation()
const { requireAuth } = useAuth()
const { updateItem, fetchItem, uploadImagesWithDims } = useItems()
const { translateItemContent } = useTranslate()

const editId = ref('')

function goBack() { uni.navigateBack() }

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
    })
  } catch (err) {
    console.warn('[publish-edit] bilingual fill skipped:', err)
  }
}

const { supabase } = useSupabase()
const avgPrice = ref(0)

const categoryKeys: ItemCategory[] = ['furniture', 'electronics', 'clothing', 'books', 'housing', 'vehicles', 'rideshare', 'daily', 'food', 'other']
const conditionKeys = ['new', 'like_new', 'good', 'fair', 'defective']

const imageList = ref<string[]>([])
const showCat = ref(false)
const showCond = ref(false)
const submitting = ref(false)
const uploadProgress = ref(0)

const form = reactive({
  title: '',
  description: '',
  price: '',
  category: '' as ItemCategory | '',
  condition: '' as ItemCondition | '',
  location: '',
  negotiable: false,
})

const locationVerified = ref(false)
watch(() => form.location, () => {
  locationVerified.value = false
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
onLoad(async (options) => {
  if (!options?.id) {
    uni.showToast({
      title: t('publish.editFetchFailed'),
      icon: 'none',
      duration: 2000,
    })
    setTimeout(() => uni.navigateBack(), 1500)
    return
  }
  editId.value = options.id
  try {
    const item = await fetchItem(options.id)
    form.title = item.title
    form.description = item.description
    form.price = String(item.price)
    form.category = item.category
    form.condition = item.condition
    form.location = item.location
    form.negotiable = item.negotiable ?? false
    imageList.value = [...item.images]
    const verifiedOnLoad = !!(item as any).location_verified
    queueMicrotask(() => { locationVerified.value = verifiedOnLoad })
  } catch (err) {
    console.error('[publish-edit] fetch item failed:', err)
    uni.showToast({
      title: t('publish.editFetchFailed'),
      icon: 'none',
      duration: 2000,
    })
    setTimeout(() => uni.navigateBack(), 1500)
    return
  }
})

watch(() => form.category, async (cat) => {
  if (!cat) { avgPrice.value = 0; return }
  const { data } = await supabase.from('items').select('price').eq('category', cat).eq('status', 'active').limit(50)
  if (data && data.length > 0) {
    avgPrice.value = Math.round(data.reduce((s: number, i: any) => s + Number(i.price), 0) / data.length)
  } else { avgPrice.value = 0 }
})

const MAX_IMAGES_PUBLISH = 9

function chooseImage() {
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
      const picked = res.tempFilePaths || []
      const accepted = picked.slice(0, remaining)
      const dropped = picked.length - accepted.length
      imageList.value.push(...accepted)
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
}

async function onDetectLocation() {
  const result = await detectLocation()
  if (!result.ok) {
    console.warn('[publish-edit-debug] location detect failed:', result.reason)
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
  console.log('[publish-edit-debug] location detected via geolocation:', result.location, 'prevLocation:', form.location)
  form.location = result.location
  const spot = matchSpot(result.location)
  locationVerified.value = !!(spot && spot.safe)
}

function onSpotChipTap(spot: CampusSpot) {
  const label = spotLabel(spot)
  console.log('[publish-edit-debug] spot chip tapped:', { id: spot.id, label, prevLocation: form.location })
  form.location = label
}

async function onSubmit() {
  if (!requireAuth()) return
  if (!form.title.trim()) { uni.showToast({ title: t('publish.needTitle'), icon: 'none' }); return }
  if (!form.price || Number(form.price) < 0) { uni.showToast({ title: t('publish.needPrice'), icon: 'none' }); return }
  if (!form.category) { uni.showToast({ title: t('publish.needCategory'), icon: 'none' }); return }
  if (!form.condition) { uni.showToast({ title: t('publish.needCondition'), icon: 'none' }); return }
  if (Number(form.price) > 100000) {
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
    if (!confirmed) return
  }

  /*
   * No currency_exchange scam-warning modal here — the original guard
   * in publish/index.vue was already gated `!isEdit.value` (don't
   * re-warn on every edit), and currency_exchange is not selectable
   * in the pill grid anyway (anomaly F, out of scope). Carrying the
   * dead guard into this file would just be noise.
   */

  submitting.value = true
  uploadProgress.value = 0
  const failsafe = setTimeout(() => { submitting.value = false }, 60000)
  try {
    const existing: string[] = []
    const toUpload: string[] = []
    for (const img of imageList.value) {
      if (img.startsWith('http')) existing.push(img)
      else toUpload.push(img)
    }
    console.log('[publish-edit-debug] images split — existing:', existing.length, 'toUpload:', toUpload.length)

    let uploaded: string[] = []
    let uploadedDims: Array<{ w: number; h: number }> = []
    if (toUpload.length > 0) {
      try {
        const res = await uploadImagesWithDims(toUpload, { entryPoint: 'publish' })
        uploaded = res.urls
        uploadedDims = res.dims
      } catch (upErr: any) {
        console.warn('[publish-edit-debug] upload threw:', upErr)
        if (upErr?.heic === true) throw new Error(t('heic.unsupported'))
        throw new Error(upErr?.message || t('publish.uploadFailed'))
      }
      uploadProgress.value = 100
      console.log('[publish-edit-debug] uploaded:', uploaded.length, '/', toUpload.length)
      if (uploaded.length === 0) {
        throw new Error(t('publish.uploadFailed'))
      }
      if (uploaded.length < toUpload.length) {
        uni.showToast({
          title: `${uploaded.length}/${toUpload.length} images uploaded`,
          icon: 'none',
          duration: 4000,
        })
      }
    }

    const images = [...existing, ...uploaded]
    const existingDims: Array<{ w: number; h: number } | null> = existing.map(() => null)
    const finalDims = [...existingDims, ...uploadedDims].filter(
      (d): d is { w: number; h: number } => !!d && d.w > 0 && d.h > 0,
    )

    const trimmedTitle = form.title.trim()
    const trimmedDesc = form.description.trim()
    const sourceLang = lang.value

    console.log('[publish-edit-debug] submit prep — form snapshot:', {
      editId: editId.value,
      title: trimmedTitle.slice(0, 40),
      category: form.category,
      condition: form.condition,
      price: form.price,
      location: form.location,
      locationVerified: locationVerified.value,
      negotiable: form.negotiable,
      imagesCount: imageList.value.length,
      sourceLang,
    })

    const payload = {
      title: trimmedTitle,
      description: trimmedDesc,
      price: Number(form.price),
      category: form.category as ItemCategory,
      condition: form.condition as ItemCondition,
      location: form.location || '',
      images,
      image_dimensions: finalDims,
      title_i18n: trimmedTitle ? { [sourceLang]: trimmedTitle } : null,
      description_i18n: trimmedDesc ? { [sourceLang]: trimmedDesc } : null,
      source_lang: sourceLang,
      negotiable: form.negotiable,
      location_verified: locationVerified.value,
    }

    console.log('[publish-edit-debug] submit prep — payload location field:', {
      payloadLocation: payload.location,
      payloadLocationVerified: payload.location_verified,
      finalImagesCount: payload.images.length,
    })

    const updated = await updateItem(editId.value, { ...payload })
    console.log('[publish-edit-debug] updateItem returned — DB row location:', updated?.location, 'id:', updated?.id)
    uni.showToast({ title: t('publish.updated'), icon: 'success' })
    scheduleBilingualFill(editId.value, trimmedTitle, trimmedDesc, sourceLang)
    setTimeout(() => uni.navigateBack(), 1500)
  } catch (error: any) {
    if (error?.message === 'Invalid price') {
      uni.showToast({ title: t('publish.priceExceedsLimit'), icon: 'none', duration: 3000 })
      return
    }
    console.error('Publish-edit error:', error)
    uni.showToast({
      title: friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('publish.fail'),
      icon: 'none',
      duration: 3000,
    })
  } finally {
    clearTimeout(failsafe)
    submitting.value = false
    uploadProgress.value = 0
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-subtle);
  padding-bottom: calc(72px + 62px); max-width: 480px; margin: 0 auto;
}

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
  padding-top: calc(12px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
  position: sticky; top: 0; z-index: 50;
}
.back-btn {
  width: 32px; height: 32px; display: flex;
  align-items: center; justify-content: center; cursor: pointer;
}
.back-arrow {
  width: 9px; height: 9px;
  border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary);
  transform: rotate(45deg); margin-left: 4px;
}
.header-title {
  flex: 1; text-align: center; font-size: 17px; font-weight: 600;
  color: var(--text-primary); padding-right: 32px;
}

@media (min-width: 768px) { .header { display: none; } }

/* ========== Form (verbatim from publish/index.vue) ========== */
.form { background: var(--bg-elev-1); }
.image-section { padding: 16px; }
.image-list { display: flex; flex-wrap: wrap; gap: 9px; }
.image-item { position: relative; width: 96px; height: 96px; }
.preview-image { width: 100%; height: 100%; border-radius: 9px; object-fit: cover; }
.remove-btn {
  position: absolute; top: -5px; right: -5px;
  width: 20px; height: 20px; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.remove-x {
  width: 10px; height: 10px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; top: 50%; left: 0;
    width: 10px; height: 1.5px; background: var(--bg-elev-1); border-radius: 1px;
  }
  &::before { transform: rotate(45deg); }
  &::after { transform: rotate(-45deg); }
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
.add-icon-css {
  width: 22px; height: 22px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; background: var(--text-faint); border-radius: 1px;
  }
  &::before { width: 22px; height: 2px; top: 10px; left: 0; }
  &::after { width: 2px; height: 22px; top: 0; left: 10px; }
}
.add-text { font-size: 11px; color: var(--text-faint); }
.add-count { font-size: 10px; color: var(--text-faint); margin-top: 2px; font-variant-numeric: tabular-nums; }
.image-tip { font-size: 12px; color: var(--text-faint); margin-top: 8px; }

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
.form-textarea { width: 100%; height: 110px; font-size: 15px; line-height: 1.6; color: var(--text-primary); }
.price-input {
  display: flex; align-items: center; flex: 1;
  .currency { font-size: 17px; color: var(--text-primary); font-weight: 700; margin-right: 4px; }
}
.flex-input { flex: 1; }
.char-count { display: block; text-align: right; font-size: 11px; color: var(--text-faint); margin-top: 4px; }
.price-hint { padding: 0 16px 8px; font-size: 12px; color: var(--text-muted); }

.field-header {
  display: flex; align-items: center; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.field-value {
  flex: 1; text-align: right; font-size: 15px; color: var(--text-primary);
  &.placeholder { color: var(--text-faint); }
}
.chevron {
  width: 8px; height: 8px; margin-left: 8px;
  border-top: 1.5px solid var(--text-faint); border-right: 1.5px solid var(--text-faint);
  transform: rotate(45deg); transition: transform 0.2s;
  &.open { transform: rotate(135deg); }
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
    &::after {
      content: '×';
      position: absolute;
      right: 9px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 14px;
      line-height: 1;
      color: rgba(255, 255, 255, 0.65);
      font-weight: 400;
    }
  }
  &:active { transform: scale(0.96); }
}
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
  margin-top: 10px;
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
.toggle-hint { flex: 1; font-size: 13px; color: var(--text-faint); text-align: right; margin-right: 10px; }
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
  background: rgba(var(--surface-rgb), 0.92);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid var(--line-hair);
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
  .submit-bar { bottom: 0; }
}
</style>
