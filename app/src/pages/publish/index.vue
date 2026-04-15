<template>
  <view class="page">
    <DesktopNav current="publish" />
    <view class="form">
      <view class="image-section">
        <view class="image-list">
          <view v-for="(img, i) in imageList" :key="i" class="image-item">
            <image :src="img" mode="aspectFill" class="preview-image" />
            <view class="remove-btn" @click="removeImage(i)">✕</view>
          </view>
          <view v-if="imageList.length < 9" class="image-add" @click="chooseImage">
            <text class="add-icon">+</text>
            <text class="add-text">{{ t('publish.addPhoto') }}</text>
          </view>
        </view>
        <text class="image-tip">{{ t('publish.photoTip') }}</text>
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
          <text :class="['arrow', { open: showCat }]">›</text>
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
          <text :class="['arrow', { open: showCond }]">›</text>
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
          <text>{{ detectingLoc ? '...' : '⊙' }}</text>
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
        {{ submitting ? t('publish.submitting') : t('publish.submit') }}
      </button>
    </view>

  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useLocation } from '../../composables/useLocation'
import DesktopNav from '../../components/DesktopNav.vue'
import { useItems } from '../../composables/useItems'
import { type ItemCategory, type ItemCondition } from '../../types'

const { t } = useI18n()
const { detectLocation, detecting: detectingLoc } = useLocation()
const { requireAuth } = useAuth()
const { createItem, uploadImages } = useItems()

const categoryKeys: ItemCategory[] = ['furniture', 'electronics', 'clothing', 'books', 'housing', 'vehicles', 'daily', 'food', 'other']
const conditionKeys = ['new', 'like_new', 'good', 'fair']

const imageList = ref<string[]>([])
const showCat = ref(false)
const showCond = ref(false)
const submitting = ref(false)

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
  try {
    let images: string[] = []
    if (imageList.value.length > 0) images = await uploadImages(imageList.value)

    await createItem({
      title: form.title.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      category: form.category as ItemCategory,
      condition: form.condition as string,
      location: form.location || 'UIUC',
      images,
      negotiable: form.negotiable,
    })

    uni.showToast({ title: t('publish.success'), icon: 'success' })
    setTimeout(() => uni.switchTab({ url: '/pages/index/index' }), 1500)
  } catch (error: any) {
    uni.showToast({ title: error.message || t('publish.fail'), icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #f7f7f8; padding-bottom: 72px; max-width: 480px; margin: 0 auto; }
.form { background: #fff; }
.image-section { padding: 16px; }
.image-list { display: flex; flex-wrap: wrap; gap: 10px; }
.image-item { position: relative; width: 100px; height: 100px; }
.preview-image { width: 100%; height: 100%; border-radius: 8px; object-fit: cover; }
.remove-btn {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px; background: #FF4D4F; color: #fff;
  border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px;
}
.image-add {
  width: 100px; height: 100px; border: 1.5px dashed #d1d1d6;
  border-radius: 8px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px; cursor: pointer;
}
.add-icon { font-size: 28px; color: #aeaeb2; }
.add-text { font-size: 12px; color: #aeaeb2; }
.image-tip { font-size: 12px; color: #aeaeb2; margin-top: 8px; }

.form-group { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; &.row { display: flex; align-items: center; } }
.label { font-size: 15px; color: #1d1d1f; width: 64px; flex-shrink: 0; }
.form-input { font-size: 15px; width: 100%; }
.title-input { font-size: 17px; font-weight: 600; }
.form-textarea { width: 100%; height: 120px; font-size: 15px; line-height: 1.6; }
.price-input { display: flex; align-items: center; flex: 1;
  .currency { font-size: 18px; color: #FF6B35; font-weight: 700; margin-right: 4px; }
}
.flex-input { flex: 1; }

.field-header {
  display: flex; align-items: center; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.field-value {
  flex: 1; text-align: right; font-size: 15px; color: #1d1d1f;
  &.placeholder { color: #aeaeb2; }
}
.arrow {
  font-size: 18px; color: #aeaeb2; margin-left: 8px;
  transition: transform 0.2s; display: inline-block;
  &.open { transform: rotate(90deg); }
}

.pill-grid {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding-top: 12px; animation: fadeIn 0.15s ease;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.sel-pill {
  padding: 8px 15px; border-radius: 8px; font-size: 13px;
  background: #f2f2f7; color: #636366; cursor: pointer; transition: all 0.12s; font-weight: 500;
  &.active { background: #1a1a1a; color: #fff; }
  &:active { transform: scale(0.96); }
}
.loc-detect {
  width: 36px; height: 36px; border-radius: 8px; background: #f2f2f7;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; cursor: pointer; margin-left: 6px;
  font-size: 16px; color: #636366;
  &:active { background: #e5e5ea; }
}

.submit-bar {
  position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 480px; padding: 10px 16px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  background: rgba(252,252,253,0.9);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid rgba(0,0,0,0.06);
}
.submit-btn {
  width: 100%; height: 48px; background: #1a1a1a; color: #fff;
  border-radius: 12px; font-size: 16px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; border: none;
  &[disabled] { opacity: 0.35; }
  &:active { opacity: 0.8; }
}

.toggle-row { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.toggle-hint { flex: 1; font-size: 13px; color: #aeaeb2; text-align: right; margin-right: 10px; }
.toggle {
  width: 44px; height: 26px; border-radius: 13px;
  background: #e0e0e0; position: relative; transition: background 0.25s; flex-shrink: 0;
  &.on { background: #FF6B35; }
}
.toggle-knob {
  width: 22px; height: 22px; border-radius: 50%; background: #fff;
  position: absolute; top: 2px; left: 2px; transition: transform 0.25s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.toggle.on .toggle-knob { transform: translateX(18px); }
</style>
