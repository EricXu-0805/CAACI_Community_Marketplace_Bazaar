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
  background: $bg-secondary;
  padding-bottom: 120rpx;
}

.form {
  background: $bg-primary;
}

.image-section {
  padding: $spacing-md;
}

.image-list {
  display: flex;
  flex-wrap: wrap;
  gap: $spacing-sm;
}

.image-item {
  position: relative;
  width: 200rpx;
  height: 200rpx;
}

.preview-image {
  width: 100%;
  height: 100%;
  border-radius: $radius-sm;
}

.remove-btn {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 40rpx;
  height: 40rpx;
  background: $danger-color;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
}

.image-add {
  width: 200rpx;
  height: 200rpx;
  border: 2rpx dashed $border-color;
  border-radius: $radius-sm;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: $spacing-xs;
}

.add-icon {
  font-size: 48rpx;
  color: $text-hint;
}

.add-text {
  font-size: 22rpx;
  color: $text-hint;
}

.image-tip {
  font-size: 22rpx;
  color: $text-hint;
  margin-top: $spacing-sm;
}

.form-group {
  padding: $spacing-md;
  border-bottom: 1rpx solid $border-color;

  &.row {
    display: flex;
    align-items: center;
  }
}

.label {
  font-size: 28rpx;
  color: $text-primary;
  width: 120rpx;
  flex-shrink: 0;
}

.form-input {
  font-size: 28rpx;
  width: 100%;
}

.title-input {
  font-size: 32rpx;
  font-weight: bold;
}

.form-textarea {
  width: 100%;
  height: 200rpx;
  font-size: 28rpx;
}

.price-input {
  display: flex;
  align-items: center;
  flex: 1;

  .currency {
    font-size: 32rpx;
    color: $brand-color;
    font-weight: bold;
    margin-right: $spacing-xs;
  }
}

.flex-input {
  flex: 1;
}

.value {
  flex: 1;
  text-align: right;
  font-size: 28rpx;
  color: $text-primary;

  &.placeholder {
    color: $text-hint;
  }
}

.arrow {
  font-size: 32rpx;
  color: $text-hint;
  margin-left: $spacing-sm;
}

.submit-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: $spacing-md;
  background: $bg-primary;
  box-shadow: 0 -2rpx 10rpx rgba(0, 0, 0, 0.05);
}

.submit-btn {
  width: 100%;
  height: 88rpx;
  background: $brand-color;
  color: white;
  border-radius: 44rpx;
  font-size: 32rpx;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;

  &[disabled] {
    opacity: 0.6;
  }
}

.picker-panel {
  background: $bg-primary;
  border-radius: $radius-lg $radius-lg 0 0;
  max-height: 60vh;
  overflow-y: auto;
}

.picker-header {
  display: flex;
  justify-content: space-between;
  padding: $spacing-md;
  border-bottom: 1rpx solid $border-color;

  .picker-title {
    font-weight: bold;
  }
}

.picker-item {
  padding: $spacing-md;
  font-size: 28rpx;
  border-bottom: 1rpx solid $border-color;

  &.active {
    color: $brand-color;
    font-weight: bold;
  }
}
</style>
