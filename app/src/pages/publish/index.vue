<template>
  <view class="page">
    <view class="form">
      <view class="image-section">
        <view class="image-list">
          <view v-for="(img, i) in imageList" :key="i" class="image-item">
            <image :src="img" mode="aspectFill" class="preview-image" />
            <view class="remove-btn" @click="removeImage(i)">✕</view>
          </view>
          <view v-if="imageList.length < 9" class="image-add" @click="chooseImage">
            <text class="add-icon">+</text>
            <text class="add-text">添加图片</text>
          </view>
        </view>
        <text class="image-tip">最多上传9张图片，第一张为封面</text>
      </view>

      <view class="form-group">
        <input v-model="form.title" placeholder="标题（必填）" maxlength="50" class="form-input title-input" />
      </view>

      <view class="form-group">
        <textarea v-model="form.description" placeholder="描述一下你的宝贝..." maxlength="500" class="form-textarea" />
      </view>

      <view class="form-group row">
        <text class="label">价格</text>
        <view class="price-input">
          <text class="currency">¥</text>
          <input v-model="form.price" type="digit" placeholder="0.00" class="form-input" />
        </view>
      </view>

      <view class="form-group row" @click="showCategoryPicker = true">
        <text class="label">分类</text>
        <text :class="['value', { placeholder: !form.category }]">
          {{ form.category ? categoryLabels[form.category] : '请选择分类' }}
        </text>
        <text class="arrow">›</text>
      </view>

      <view class="form-group row" @click="showConditionPicker = true">
        <text class="label">成色</text>
        <text :class="['value', { placeholder: !form.condition }]">
          {{ form.condition ? conditionLabels[form.condition] : '请选择成色' }}
        </text>
        <text class="arrow">›</text>
      </view>

      <view class="form-group row">
        <text class="label">位置</text>
        <input v-model="form.location" placeholder="如: UIUC / Champaign" class="form-input flex-input" />
      </view>
    </view>

    <view class="submit-bar">
      <button class="submit-btn" :disabled="submitting" @click="onSubmit">
        {{ submitting ? '发布中...' : '发布' }}
      </button>
    </view>

    <uni-popup ref="categoryPopup" v-if="showCategoryPicker" type="bottom" @close="showCategoryPicker = false">
      <view class="picker-panel">
        <view class="picker-header">
          <text @click="showCategoryPicker = false">取消</text>
          <text class="picker-title">选择分类</text>
          <text />
        </view>
        <view
          v-for="(label, key) in categoryLabels"
          :key="key"
          :class="['picker-item', { active: form.category === key }]"
          @click="form.category = key as any; showCategoryPicker = false"
        >
          {{ label }}
        </view>
      </view>
    </uni-popup>

    <uni-popup ref="conditionPopup" v-if="showConditionPicker" type="bottom" @close="showConditionPicker = false">
      <view class="picker-panel">
        <view class="picker-header">
          <text @click="showConditionPicker = false">取消</text>
          <text class="picker-title">选择成色</text>
          <text />
        </view>
        <view
          v-for="(label, key) in conditionLabels"
          :key="key"
          :class="['picker-item', { active: form.condition === key }]"
          @click="form.condition = key as any; showConditionPicker = false"
        >
          {{ label }}
        </view>
      </view>
    </uni-popup>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useItems } from '../../composables/useItems'
import { CATEGORY_LABELS, CONDITION_LABELS, type ItemCategory, type ItemCondition } from '../../types'

const { requireAuth } = useAuth()
const { createItem, uploadImages } = useItems()

const categoryLabels = CATEGORY_LABELS
const conditionLabels = CONDITION_LABELS

const imageList = ref<string[]>([])
const showCategoryPicker = ref(false)
const showConditionPicker = ref(false)
const submitting = ref(false)

const form = reactive({
  title: '',
  description: '',
  price: '',
  category: '' as ItemCategory | '',
  condition: '' as ItemCondition | '',
  location: 'UIUC',
})

function chooseImage() {
  uni.chooseImage({
    count: 9 - imageList.value.length,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      imageList.value.push(...res.tempFilePaths)
    },
  })
}

function removeImage(index: number) {
  imageList.value.splice(index, 1)
}

async function onSubmit() {
  if (!requireAuth()) return

  if (!form.title.trim()) {
    uni.showToast({ title: '请输入标题', icon: 'none' })
    return
  }
  if (!form.price || Number(form.price) < 0) {
    uni.showToast({ title: '请输入有效价格', icon: 'none' })
    return
  }
  if (!form.category) {
    uni.showToast({ title: '请选择分类', icon: 'none' })
    return
  }
  if (!form.condition) {
    uni.showToast({ title: '请选择成色', icon: 'none' })
    return
  }

  submitting.value = true
  try {
    let images: string[] = []
    if (imageList.value.length > 0) {
      images = await uploadImages(imageList.value)
    }

    await createItem({
      title: form.title.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      category: form.category as ItemCategory,
      condition: form.condition as string,
      location: form.location || 'UIUC',
      images,
    })

    uni.showToast({ title: '发布成功！', icon: 'success' })
    setTimeout(() => {
      uni.switchTab({ url: '/pages/index/index' })
    }, 1500)
  } catch (error: any) {
    uni.showToast({ title: error.message || '发布失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  background: #f5f5f7;
  padding-bottom: 72px;
  max-width: 480px;
  margin: 0 auto;
}

.form { background: #fff; }

.image-section { padding: 16px; }

.image-list { display: flex; flex-wrap: wrap; gap: 10px; }

.image-item { position: relative; width: 100px; height: 100px; }

.preview-image { width: 100%; height: 100%; border-radius: 8px; object-fit: cover; }

.remove-btn {
  position: absolute; top: -6px; right: -6px;
  width: 22px; height: 22px; background: #FF4D4F; color: #fff;
  border-radius: 50%; display: flex; align-items: center;
  justify-content: center; font-size: 11px;
}

.image-add {
  width: 100px; height: 100px; border: 1.5px dashed #d1d1d6;
  border-radius: 8px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px;
}

.add-icon { font-size: 28px; color: #aeaeb2; }
.add-text { font-size: 12px; color: #aeaeb2; }
.image-tip { font-size: 12px; color: #aeaeb2; margin-top: 8px; }

.form-group {
  padding: 14px 16px;
  border-bottom: 1px solid #f0f0f0;
  &.row { display: flex; align-items: center; }
}

.label { font-size: 15px; color: #1d1d1f; width: 64px; flex-shrink: 0; }
.form-input { font-size: 15px; width: 100%; }
.title-input { font-size: 17px; font-weight: 600; }
.form-textarea { width: 100%; height: 120px; font-size: 15px; line-height: 1.6; }

.price-input {
  display: flex; align-items: center; flex: 1;
  .currency { font-size: 18px; color: #FF6B35; font-weight: 700; margin-right: 4px; }
}

.flex-input { flex: 1; }

.value {
  flex: 1; text-align: right; font-size: 15px; color: #1d1d1f;
  &.placeholder { color: #aeaeb2; }
}

.arrow { font-size: 18px; color: #aeaeb2; margin-left: 8px; }

.submit-bar {
  position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 480px; padding: 12px 16px;
  background: #fff; box-shadow: 0 -1px 8px rgba(0,0,0,0.06);
}

.submit-btn {
  width: 100%; height: 48px; background: #FF6B35; color: #fff;
  border-radius: 24px; font-size: 16px; font-weight: 600;
  display: flex; align-items: center; justify-content: center; border: none;
  &[disabled] { opacity: 0.5; }
}

.picker-panel {
  background: #fff; border-radius: 14px 14px 0 0;
  max-height: 60vh; overflow-y: auto;
}

.picker-header {
  display: flex; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid #f0f0f0;
  font-size: 15px;
  .picker-title { font-weight: 600; }
}

.picker-item {
  padding: 14px 16px; font-size: 15px;
  border-bottom: 1px solid #f5f5f7;
  &.active { color: #FF6B35; font-weight: 600; }
}
</style>
