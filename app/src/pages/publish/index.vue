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
            <view class="remove-btn" @click="removeImage(i)">
              <view class="remove-x"></view>
            </view>
            <view v-if="i === 0" class="cover-tag">
              <text>{{ t('publish.cover') }}</text>
            </view>
          </view>
          <view v-if="imageList.length < 9" class="image-add" @click="chooseImage">
            <view class="add-icon-css"></view>
            <text class="add-text">{{ t('publish.addPhoto') }}</text>
          </view>
        </view>
        <text class="image-tip">{{ t('publish.photoTip') }}</text>
      </view>

      <!-- Upload progress -->
      <view v-if="uploadProgress" class="upload-bar">
        <view class="upload-fill" :style="{ width: uploadProgress + '%' }"></view>
        <text class="upload-text">{{ t('publish.uploading') }} {{ uploadProgress }}%</text>
      </view>

      <view class="form-group">
        <input v-model="form.title" :placeholder="t('publish.titlePlaceholder')" maxlength="50" class="form-input title-input" />
      </view>

      <view class="form-group">
        <textarea v-model="form.description" :placeholder="t('publish.descPlaceholder')" maxlength="500" class="form-textarea" />
      </view>

      <view class="form-group row">
        <text class="label">{{ t('publish.price') }}</text>
        <view class="price-input">
          <text class="currency">$</text>
          <input v-model="form.price" type="digit" placeholder="0.00" class="form-input" />
        </view>
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
            @click="form.category = cat; showCat = false"
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
            :class="['sel-pill', { active: form.condition === cond }]"
            @click="form.condition = cond as any; showCond = false"
          >
            <text>{{ t('condition.' + cond) }}</text>
          </view>
        </view>
      </view>

      <view class="form-group row">
        <text class="label">{{ t('publish.location') }}</text>
        <input v-model="form.location" :placeholder="t('publish.locationPlaceholder')" class="form-input flex-input" />
        <view class="loc-detect" @click="onDetectLocation">
          <view v-if="detectingLoc" class="loc-spinner"></view>
          <view v-else class="loc-pin"></view>
        </view>
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
        {{ submitting ? t('publish.submitting') : (isEdit ? t('publish.update') : t('publish.submit')) }}
      </button>
    </view>

    <CustomTabBar current="publish" />
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useLocation } from '../../composables/useLocation'
import { useItems } from '../../composables/useItems'
import { compressImage } from '../../utils'
import type { ItemCategory, ItemCondition } from '../../types'
import DesktopNav from '../../components/DesktopNav.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'

const { t } = useI18n()
const { detectLocation, detecting: detectingLoc } = useLocation()
const { requireAuth } = useAuth()
const { createItem, updateItem, fetchItem, uploadImages, fetchItems } = useItems()

const editId = ref('')
const isEdit = ref(false)

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
    } catch {}
  }
})

const categoryKeys: ItemCategory[] = ['furniture', 'electronics', 'clothing', 'books', 'housing', 'vehicles', 'daily', 'food', 'other']
const conditionKeys = ['new', 'like_new', 'good', 'fair']

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

function chooseImage() {
  uni.chooseImage({
    count: 9 - imageList.value.length,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => { imageList.value.push(...res.tempFilePaths) },
  })
}

function removeImage(index: number) {
  imageList.value.splice(index, 1)
}

async function onDetectLocation() {
  const loc = await detectLocation()
  if (loc) form.location = loc
}

async function onSubmit() {
  if (!requireAuth()) return
  if (!form.title.trim()) { uni.showToast({ title: t('publish.needTitle'), icon: 'none' }); return }
  if (!form.price || Number(form.price) < 0) { uni.showToast({ title: t('publish.needPrice'), icon: 'none' }); return }
  if (!form.category) { uni.showToast({ title: t('publish.needCategory'), icon: 'none' }); return }
  if (!form.condition) { uni.showToast({ title: t('publish.needCondition'), icon: 'none' }); return }

  submitting.value = true
  uploadProgress.value = 0
  try {
    const existing: string[] = []
    const toUpload: string[] = []
    for (const img of imageList.value) {
      if (img.startsWith('http')) existing.push(img)
      else toUpload.push(img)
    }
    const uploaded: string[] = []
    for (let i = 0; i < toUpload.length; i++) {
      const compressed = await compressImage(toUpload[i])
      const urls = await uploadImages([compressed])
      uploaded.push(...urls)
      uploadProgress.value = Math.round(((i + 1) / (toUpload.length || 1)) * 100)
    }
    const images = [...existing, ...uploaded]

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      category: form.category as ItemCategory,
      condition: form.condition as ItemCondition,
      location: form.location || 'UIUC',
      images,
      negotiable: form.negotiable,
    }

    if (isEdit.value) {
      await updateItem(editId.value, { ...payload })
      uni.showToast({ title: t('publish.updated'), icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1500)
    } else {
      await createItem(payload)
      uploadProgress.value = 0
      form.title = ''; form.description = ''; form.price = ''
      form.category = ''; form.condition = ''; form.location = 'UIUC'
      form.negotiable = false; imageList.value = []
      fetchItems({ reset: true })
      uni.showToast({ title: t('publish.success'), icon: 'success' })
      setTimeout(() => uni.switchTab({ url: '/pages/index/index' }), 1500)
    }
  } catch (error: any) {
    uni.showToast({ title: error.message || t('publish.fail'), icon: 'none' })
  } finally {
    submitting.value = false
    uploadProgress.value = 0
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: #f2f2f7;
  padding-bottom: calc(72px + 56px); max-width: 480px; margin: 0 auto;
}

/* ========== Header ========== */
.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + env(safe-area-inset-top, 0px));
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  position: sticky; top: 0; z-index: 50;
}
.ph-title { font-size: 17px; font-weight: 700; color: #1a1a1a; }

@media (min-width: 768px) { .page-header { display: none; } }

/* ========== Form ========== */
.form { background: #fff; }
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
    width: 10px; height: 1.5px; background: #fff; border-radius: 1px;
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
  width: 96px; height: 96px; border: 1.5px dashed #d1d1d6;
  border-radius: 9px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px; cursor: pointer;
  &:active { background: #f7f7f8; }
}
.add-icon-css {
  width: 22px; height: 22px; position: relative;
  &::before, &::after {
    content: ''; position: absolute; background: #c7c7cc; border-radius: 1px;
  }
  &::before { width: 22px; height: 2px; top: 10px; left: 0; }
  &::after { width: 2px; height: 22px; top: 0; left: 10px; }
}
.add-text { font-size: 11px; color: #aeaeb2; }
.image-tip { font-size: 12px; color: #c7c7cc; margin-top: 8px; }

/* ========== Upload Progress ========== */
.upload-bar {
  position: relative; height: 28px; margin: 0 16px 8px;
  background: #f2f2f7; border-radius: 6px; overflow: hidden;
}
.upload-fill {
  position: absolute; top: 0; bottom: 0; left: 0;
  background: rgba(26,26,26,0.08);
  transition: width 0.3s ease;
}
.upload-text {
  position: relative; z-index: 1;
  font-size: 12px; color: #636366; font-weight: 500;
  line-height: 28px; padding-left: 10px;
}

/* ========== Form Groups ========== */
.form-group {
  padding: 13px 16px;
  border-bottom: 0.5px solid rgba(0,0,0,0.06);
  &.row { display: flex; align-items: center; }
}
.label { font-size: 15px; color: #1a1a1a; width: 64px; flex-shrink: 0; font-weight: 500; }
.form-input { font-size: 15px; width: 100%; color: #1a1a1a; }
.title-input { font-size: 17px; font-weight: 600; }
.form-textarea { width: 100%; height: 110px; font-size: 15px; line-height: 1.6; color: #1a1a1a; }
.price-input {
  display: flex; align-items: center; flex: 1;
  .currency { font-size: 17px; color: #1a1a1a; font-weight: 700; margin-right: 4px; }
}
.flex-input { flex: 1; }

.field-header {
  display: flex; align-items: center; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.field-value {
  flex: 1; text-align: right; font-size: 15px; color: #1a1a1a;
  &.placeholder { color: #c7c7cc; }
}
.chevron {
  width: 8px; height: 8px; margin-left: 8px;
  border-top: 1.5px solid #c7c7cc; border-right: 1.5px solid #c7c7cc;
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
  background: #f2f2f7; color: #636366; cursor: pointer;
  transition: all 0.12s; font-weight: 500;
  &.active { background: #1a1a1a; color: #fff; }
  &:active { transform: scale(0.96); }
}

/* ========== Location ========== */
.loc-detect {
  width: 36px; height: 36px; border-radius: 9px; background: #f2f2f7;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; cursor: pointer; margin-left: 6px;
  &:active { background: #e5e5ea; }
}
.loc-pin {
  width: 12px; height: 16px; position: relative;
  &::before {
    content: ''; position: absolute; top: 0; left: 0;
    width: 12px; height: 12px; border: 2px solid #636366;
    border-radius: 50%;
  }
  &::after {
    content: ''; position: absolute; bottom: 0; left: 50%;
    transform: translateX(-50%);
    width: 0; height: 0;
    border-left: 4px solid transparent; border-right: 4px solid transparent;
    border-top: 5px solid #636366;
  }
}
.loc-spinner {
  width: 16px; height: 16px;
  border: 2px solid #e5e5ea; border-top-color: #636366;
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ========== Toggle ========== */
.toggle-row { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.toggle-hint { flex: 1; font-size: 13px; color: #aeaeb2; text-align: right; margin-right: 10px; }
.toggle {
  width: 44px; height: 26px; border-radius: 13px;
  background: #e0e0e0; position: relative; transition: background 0.25s; flex-shrink: 0;
  &.on { background: #34C759; }
}
.toggle-knob {
  width: 22px; height: 22px; border-radius: 50%; background: #fff;
  position: absolute; top: 2px; left: 2px; transition: transform 0.25s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.toggle.on .toggle-knob { transform: translateX(18px); }

/* ========== Submit ========== */
.submit-bar {
  position: fixed; bottom: calc(50px + env(safe-area-inset-bottom, 0px));
  left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 480px; padding: 9px 16px;
  background: rgba(255,255,255,0.92);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid rgba(0,0,0,0.06);
  z-index: 40;
}
.submit-btn {
  width: 100%; height: 46px; background: #1a1a1a; color: #fff;
  border-radius: 23px; font-size: 15px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; border: none;
  &[disabled] { opacity: 0.3; }
  &:active { opacity: 0.8; }
}

@media (min-width: 768px) {
  .submit-bar { bottom: 0; }
}
</style>
