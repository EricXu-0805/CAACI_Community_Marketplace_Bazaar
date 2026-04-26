<template>
  <view class="page">
    <DesktopNav current="publish" />

    <!-- Mobile Header -->
    <view class="page-header">
      <text class="ph-title">{{ isEdit ? t('publish.editTitle') : t('publish.title') }}</text>
    </view>

    <view class="form">
      <view class="image-section">
        <view class="image-list">
          <view v-for="(img, i) in imageList" :key="i" class="image-item">
            <image :src="img" mode="aspectFill" class="preview-image" />
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
        <view class="loc-detect" role="button" :aria-label="t('a11y.detectLocation')" @click="onDetectLocation">
          <view v-if="detectingLoc" class="loc-spinner"></view>
          <view v-else class="loc-pin"></view>
        </view>
      </view>

      <scroll-view scroll-x class="spot-row">
        <view
          v-for="spot in CAMPUS_SPOTS"
          :key="spot.id"
          class="spot-chip"
          :class="{ active: form.location === spotLabel(spot) }"
          @click="form.location = spotLabel(spot)"
        >
          {{ spotLabel(spot) }}
        </view>
      </scroll-view>

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
        {{ submitting ? t('publish.submitting') : (isEdit ? t('publish.update') : t('publish.submit')) }}
      </button>
    </view>

    <CustomTabBar current="publish" />
  </view>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onUnmounted } from 'vue'
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { useCampusSpots, matchSpot, type CampusSpot } from '../../composables/useCampusSpots'
import { useLocation } from '../../composables/useLocation'
import { useItems } from '../../composables/useItems'
import { useTranslate } from '../../composables/useTranslate'
import { friendlyErrorMessage } from '../../utils'
import type { ItemCategory, ItemCondition } from '../../types'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'

const { t, lang } = useI18n()
const { CAMPUS_SPOTS } = useCampusSpots()

function spotLabel(spot: CampusSpot) {
  return lang.value === 'zh' ? spot.zh : spot.en
}
const { detectLocation, detecting: detectingLoc } = useLocation()
const { requireAuth } = useAuth()
const { createItem, updateItem, fetchItem, uploadImagesWithDims, fetchItems } = useItems()
const { translateItemContent } = useTranslate()

const editId = ref('')
const isEdit = ref(false)

/*
 * Fire-and-forget bilingual filler.
 *
 * Publish UX must not block on translation — the endpoint can be cold
 * (8s) and we already pay 5-10s for moderation. So we insert the row
 * with only the source-language entry in title_i18n, pop the success
 * toast immediately, and THEN ask the translator to fill the other
 * locale(s) and patch the row via updateItem. If the network drops or
 * the endpoint returns garbage, the i18n map stays partial and the
 * reader-side fallback (`map[lang] ?? original`) simply shows the
 * author's original text in whatever language they typed it in — not
 * a regression from the pre-migration state.
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
    // Nothing new — author-only map already in DB.
    if (titleKeys.length <= 1 && descKeys.length <= 1) return

    await updateItem(itemId, {
      title_i18n: Object.keys(title_i18n).length ? title_i18n : null,
      description_i18n: Object.keys(description_i18n).length ? description_i18n : null,
    })
  } catch (err) {
    console.warn('[publish] bilingual fill skipped:', err)
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
  location: 'UIUC',
  negotiable: false,
})

const locationVerified = ref(false)
watch(() => form.location, () => {
  locationVerified.value = false
})

/*
 * Tag toggle handlers: tapping the currently-active pill clears the
 * selection (form.category / form.condition becomes ''). This is what
 * lets users escape the "I picked a category by mistake, now the form
 * is permanently dirty" trap. The pill's active style adds a × hint
 * (see .sel-pill.active::after in the scoped styles) to advertise
 * that re-tapping unselects. Sheet auto-closes on either path so the
 * user immediately sees the field returning to its placeholder state.
 */
function onCategoryTap(cat: ItemCategory) {
  form.category = form.category === cat ? '' : cat
  showCat.value = false
}
function onConditionTap(cond: string) {
  form.condition = (form.condition === cond ? '' : cond) as ItemCondition | ''
  showCond.value = false
}

onLoad(async (options) => {
  if (options?.edit) {
    editId.value = options.edit
    isEdit.value = true
    try {
      const item = await fetchItem(options.edit)
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
    } catch {}
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

/* ---------- Draft save ----------
   Persist in-progress form data to local storage so users don't lose
   work when they accidentally tap a tabbar icon mid-compose. Scoped to
   new-item mode only (edit mode has a live item row already). */
const DRAFT_KEY = 'publish_draft_v1'

const isDirty = computed(() => {
  if (isEdit.value) return false
  return (
    form.title.trim().length > 0 ||
    form.description.trim().length > 0 ||
    form.price.trim().length > 0 ||
    form.category !== '' ||
    form.condition !== '' ||
    form.negotiable !== false ||
    imageList.value.length > 0
  )
})

function saveDraft() {
  try {
    uni.setStorageSync(DRAFT_KEY, {
      form: { ...form },
      images: [...imageList.value],
      savedAt: Date.now(),
    })
  } catch { /* storage full / private mode — ignore */ }
}

function clearDraft() {
  try { uni.removeStorageSync(DRAFT_KEY) } catch { /* ignore */ }
}

type PublishDraft = { form: Record<string, any>; images: string[]; savedAt: number }

function loadDraft(): PublishDraft | null {
  try {
    const raw = uni.getStorageSync(DRAFT_KEY)
    if (!raw || typeof raw !== 'object') return null
    return raw as PublishDraft
  } catch { return null }
}

function applyDraft(draft: { form: any; images: string[] }) {
  Object.assign(form, draft.form)
  imageList.value = [...(draft.images || [])]
  uni.showToast({ title: t('publish.draftRestored'), icon: 'none' })
}

/*
 * Reset all form state to defaults — used after the user picks "Save"
 * or "Discard" in the draft prompt. Critical: without this reset the
 * form stays dirty after the prompt closes, which means the recursive
 * uni.switchTab() inside promptSaveDraft's onDecided callback would
 * trigger the SAME tab guard, the SAME prompt, and uni.showModal's
 * single-instance lock would swallow the second modal silently — user
 * sees "stuck on publish, second tap does nothing". Resetting first
 * makes isDirty=false, so the recursive switchTab passes through the
 * guard cleanly.
 */
function resetForm() {
  form.title = ''
  form.description = ''
  form.price = ''
  form.category = ''
  form.condition = ''
  form.location = 'UIUC'
  form.negotiable = false
  imageList.value = []
}

function promptSaveDraft(onDecided: () => void) {
  uni.showModal({
    title: t('publish.draftPromptTitle'),
    content: t('publish.draftPromptBody'),
    confirmText: t('publish.draftSave'),
    cancelText: t('publish.draftDiscard'),
    confirmColor: '#2A2A2E',
    success: (r) => {
      if (r.confirm) {
        saveDraft()
        resetForm()
        uni.showToast({ title: t('publish.draftSaved'), icon: 'none' })
      } else if (r.cancel) {
        clearDraft()
        resetForm()
      } else {
        // Modal dismissed without a clear confirm/cancel (rare on H5
        // but possible on mp). Don't navigate — leave the form alone
        // and let the user try again. Equivalent to fail() below.
        pendingTabUrl = ''
        return
      }
      onDecided()
    },
    /*
     * Modal failed to show at all (very rare — usually means uni runtime
     * is in a degraded state). Don't auto-navigate; clear the pending
     * URL so the next tab tap starts fresh instead of silently jumping.
     */
    fail: () => { pendingTabUrl = '' },
  })
}

/* Tabbar uses uni.switchTab, which bypasses navigation guards. The
   official escape hatch is uni.addInterceptor('switchTab'). Scope the
   interceptor to this page's lifetime so other pages don't inherit it. */
let switchTabInterceptor: { invoke: (args: any) => boolean } | null = null
let pendingTabUrl = ''

function installTabGuard() {
  if (switchTabInterceptor) return
  switchTabInterceptor = {
    invoke(args: { url: string }) {
      /* Staying on the publish tab itself shouldn't trigger the prompt. */
      if (args.url && args.url.includes('/pages/publish/index')) return true
      if (!isDirty.value) return true
      pendingTabUrl = args.url
      promptSaveDraft(() => {
        if (pendingTabUrl) {
          const url = pendingTabUrl
          pendingTabUrl = ''
          uni.switchTab({ url })
        }
      })
      return false
    },
  }
  uni.addInterceptor('switchTab', switchTabInterceptor)
}

function removeTabGuard() {
  if (switchTabInterceptor) {
    uni.removeInterceptor('switchTab')
    switchTabInterceptor = null
  }
}

onShow(() => {
  if (isEdit.value) return
  const draft = loadDraft()
  if (draft && !isDirty.value) {
    uni.showModal({
      title: t('publish.draftRestoreTitle'),
      content: t('publish.draftRestoreBody'),
      confirmText: t('publish.draftRestore'),
      cancelText: t('publish.draftDiscard'),
      confirmColor: '#2A2A2E',
      success: (r) => {
        if (r.confirm) applyDraft(draft)
        else if (r.cancel) clearDraft()
      },
    })
  }
  installTabGuard()
})

onHide(() => { removeTabGuard() })
onUnload(() => { removeTabGuard() })
onUnmounted(() => { removeTabGuard() })

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
      /* On H5 the `count` hint is advisory — the underlying <input
         type="file" multiple> lets users pick unlimited files. Enforce
         the cap here and surface it to the user (WeChat-style) instead
         of silently truncating. */
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
  const loc = await detectLocation()
  if (!loc) return
  form.location = loc
  const spot = matchSpot(loc)
  locationVerified.value = !!(spot && spot.safe)
}

async function onSubmit() {
  if (!requireAuth()) return
  if (!form.title.trim()) { uni.showToast({ title: t('publish.needTitle'), icon: 'none' }); return }
  if (!form.price || Number(form.price) < 0) { uni.showToast({ title: t('publish.needPrice'), icon: 'none' }); return }
  if (Number(form.price) > 100000) { uni.showToast({ title: t('publish.priceTooHigh'), icon: 'none' }); return }
  if (!form.category) { uni.showToast({ title: t('publish.needCategory'), icon: 'none' }); return }
  if (!form.condition) { uni.showToast({ title: t('publish.needCondition'), icon: 'none' }); return }

  if (form.category === 'currency_exchange' && !isEdit.value) {
    const confirmed = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: t('scam.publishTitle'),
        content: t('scam.publishBody'),
        confirmText: t('scam.publishAgree'),
        cancelText: t('scam.publishCancel'),
        confirmColor: 'var(--accent-warn)',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return
  }

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
    console.log('[publish-debug] images split — existing:', existing.length, 'toUpload:', toUpload.length)

    let uploaded: string[] = []
    let uploadedDims: Array<{ w: number; h: number }> = []
    if (toUpload.length > 0) {
      try {
        const res = await uploadImagesWithDims(toUpload)
        uploaded = res.urls
        uploadedDims = res.dims
      } catch (upErr: any) {
        console.warn('[publish-debug] upload threw:', upErr)
        throw new Error(upErr?.message || t('publish.uploadFailed'))
      }
      uploadProgress.value = 100
      console.log('[publish-debug] uploaded:', uploaded.length, '/', toUpload.length)
      if (uploaded.length === 0) {
        throw new Error(t('publish.uploadFailed'))
      }
      /* Diagnostic: surface partial upload failures that would otherwise be
         swallowed. uploadImagesWithDims() catches per-file errors and skips
         them, so uploaded.length < toUpload.length means some images were lost. */
      if (uploaded.length < toUpload.length) {
        uni.showToast({
          title: `${uploaded.length}/${toUpload.length} images uploaded`,
          icon: 'none',
          duration: 4000,
        })
      }
    }

    const images = [...existing, ...uploaded]
    /*
     * image_dimensions covers ONLY the newly uploaded images in this
     * call; pre-existing URLs (edit flow) don't get dimensions because
     * we can't reliably measure arbitrary remote URLs client-side. The
     * frontend still falls back to @load for those, so leaving their
     * slots absent is correct. We use `null` pads rather than zeros so
     * consumers can distinguish "unknown" from "0×0".
     */
    const existingDims: Array<{ w: number; h: number } | null> = existing.map(() => null)
    const finalDims = [...existingDims, ...uploadedDims].filter(
      (d): d is { w: number; h: number } => !!d && d.w > 0 && d.h > 0,
    )

    const trimmedTitle = form.title.trim()
    const trimmedDesc = form.description.trim()
    // Author-language is today's UI locale. Settings is the only place a
    // user can change it, so this is a correct proxy for "what language
    // did they think in while writing this listing".
    const sourceLang = lang.value

    const payload = {
      title: trimmedTitle,
      description: trimmedDesc,
      price: Number(form.price),
      category: form.category as ItemCategory,
      condition: form.condition as ItemCondition,
      location: form.location || 'UIUC',
      images,
      image_dimensions: finalDims,
      // Seed the i18n maps with the original text in the source lang.
      // The async translation pass below adds the other language(s).
      title_i18n: trimmedTitle ? { [sourceLang]: trimmedTitle } : null,
      description_i18n: trimmedDesc ? { [sourceLang]: trimmedDesc } : null,
      source_lang: sourceLang,
      negotiable: form.negotiable,
      location_verified: locationVerified.value,
    }

    if (isEdit.value) {
      await updateItem(editId.value, { ...payload })
      uni.showToast({ title: t('publish.updated'), icon: 'success' })
      scheduleBilingualFill(editId.value, trimmedTitle, trimmedDesc, sourceLang)
      setTimeout(() => uni.navigateBack(), 1500)
    } else {
      const newItem = await createItem(payload)
      uploadProgress.value = 0
      form.title = ''; form.description = ''; form.price = ''
      form.category = ''; form.condition = ''; form.location = 'UIUC'
      form.negotiable = false; imageList.value = []
      clearDraft()
      uni.showToast({ title: t('publish.success'), icon: 'success' })
      scheduleBilingualFill(newItem.id, trimmedTitle, trimmedDesc, sourceLang)
      setTimeout(() => {
        uni.navigateTo({ url: `/pages/detail/index?id=${newItem.id}` })
      }, 1000)
    }
  } catch (error: any) {
    console.error('Publish error:', error)
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

/* ========== Header ========== */
.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + var(--status-bar-height, env(safe-area-inset-top, 0px)));
  background: rgba(var(--surface-rgb), 0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid var(--line-hair);
  position: sticky; top: 0; z-index: 50;
}
.ph-title { font-size: 17px; font-weight: 700; color: var(--text-primary); }

@media (min-width: 768px) { .page-header { display: none; } }

/* ========== Form ========== */
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
  background: rgba(26,26,26,0.08);
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
/* Labels need a min-width so short Chinese labels (分类 / 成色 / 价格) line
   up vertically across rows, but a fixed width breaks longer English labels
   (Category / Condition / Location). min-width + flex-shrink: 0 + padding-right
   gives both: ZH locks to the 64px floor, EN grows past it without wrapping. */
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
    /* × hint: tells the user "tap again to deselect". Pure CSS, no
       icon dep. Only renders on active state so the inactive pill
       layout stays unchanged. */
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
.loc-detect {
  width: 36px; height: 36px; border-radius: 9px; background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; cursor: pointer; margin-left: 6px;
  &:active { background: var(--bg-inset); }
}
.loc-pin {
  width: 12px; height: 16px; position: relative;
  &::before {
    content: ''; position: absolute; top: 0; left: 0;
    width: 12px; height: 12px; border: 2px solid var(--text-secondary);
    border-radius: 50%;
  }
  &::after {
    content: ''; position: absolute; bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 0; height: 0;
    border-left: 4px solid transparent; border-right: 4px solid transparent;
    border-top: 5px solid var(--ink-quiet);
  }
}
.loc-spinner {
  width: 16px; height: 16px;
  border: 2px solid var(--bg-inset); border-top-color: var(--text-secondary);
  border-radius: 50%; animation: spin 0.7s linear infinite;
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
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.toggle.on .toggle-knob { transform: translateX(18px); }

/* ========== Submit ========== */
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
