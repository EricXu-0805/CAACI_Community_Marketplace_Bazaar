<template>
  <UButton variant="ghost" :loading="opening" :class="['me-entry', {
    'me-entry-outline': outline, 'me-entry-responsive': responsive,
  }]" @click="start">
    <text class="me-entry-short">{{ t('events.createShort') }}</text>
    <text class="me-entry-full">{{ t('events.create') }}</text>
  </UButton>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import UButton from './UButton.vue'
import { useAuth } from '../composables/useAuth'
import { useI18n } from '../composables/useI18n'
import { assertWritesAllowed } from '../composables/useRestriction'
import { friendlyErrorMessage } from '../utils'

withDefaults(defineProps<{ readonly outline?: boolean; readonly responsive?: boolean }>(), {
  outline: false, responsive: false,
})
const { t, lang } = useI18n()
const { awaitAuthReady, currentUser, requireAuth } = useAuth()
const opening = ref(false)
async function start() {
  if (opening.value) return
  opening.value = true
  try {
    await awaitAuthReady()
    if (!requireAuth('/pages/event/create/index')) return
    if (!currentUser.value?.is_illini_verified) {
      uni.showActionSheet({
        title: t('events.needVerify'), itemList: [t('events.goVerify')],
        success: ({ tapIndex }) => {
          if (tapIndex === 0) uni.navigateTo({ url: '/pages/illini-verify/index' })
        },
      })
      return
    }
    assertWritesAllowed()
    uni.navigateTo({ url: '/pages/event/create/index' })
  } catch (error) {
    if (!(error instanceof Error)) throw error
    uni.showToast({ title: friendlyErrorMessage(error, lang.value === 'zh' ? 'zh' : 'en') || t('error.actionFailed'), icon: 'none' })
  } finally {
    opening.value = false
  }
}
</script>

<style scoped>
.me-entry.u-btn { background: transparent; color: var(--ink-soft); box-shadow: none; }
.me-entry.me-entry-outline { background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-bold); }
.me-entry-short { display: none; }
.me-entry-responsive .me-entry-short { display: inline; }
.me-entry-responsive .me-entry-full { display: none; }
/* #ifdef H5 */
@media (min-width: 768px) {
  .me-entry-responsive.u-btn { background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-bold); }
  .me-entry-responsive .me-entry-short { display: none; }
  .me-entry-responsive .me-entry-full { display: inline; }
}
/* #endif */
</style>
