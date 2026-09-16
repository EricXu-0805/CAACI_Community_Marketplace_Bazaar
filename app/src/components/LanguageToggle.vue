<template>
  <view class="language-choice">
    <UButton variant="ghost" :aria-label="t('a11y.langToggle')" @click="toggleLang">
      <text :lang="lang === 'en' ? 'zh' : 'en'">{{ t('lang.switch') }}</text>
    </UButton>
  </view>
</template>

<script setup lang="ts">
import UButton from './UButton.vue'
import { useI18n } from '../composables/useI18n'
const { t, lang, toggleLang } = useI18n()
</script>

<style scoped>
.language-choice { display: flex; justify-content: flex-end; flex-shrink: 0; padding: 8px 16px 0; }
</style>
