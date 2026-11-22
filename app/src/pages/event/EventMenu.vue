<template>
  <UButton class="ed-more" variant="ghost" :loading="working" :aria-label="t('a11y.more')" @click="open">
    <UIcon name="more-horizontal" size="sm" color="currentColor" />
  </UButton>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import UButton from '../../components/UButton.vue'
import UIcon from '../../components/UIcon.vue'
import { useAuth } from '../../composables/useAuth'
import { useI18n } from '../../composables/useI18n'
import { useModeration } from '../../composables/useModeration'
import { useMemberEventWrites, memberEventErrorKey } from '../../composables/useMemberEventWrites'
import { captureAccountRequest, isAccountRequestCurrent, type AccountRequestToken } from '../../composables/accountScope'
import { BASE_URL } from '../../config/runtime'
import { friendlyErrorMessage } from '../../utils'
import { eventState, type CommunityEvent } from '../../utils/communityEvents'

const props = defineProps<{ readonly event: CommunityEvent }>()
const emit = defineEmits<{ cancelled: [result: { readonly id: string; readonly cancelled_at: string }] }>()
const { t, lang } = useI18n()
const { currentUser, awaitAuthReady } = useAuth()
const { reportTarget } = useModeration()
const { cancelMemberEvent } = useMemberEventWrites()
const working = ref(false)
let mounted = true
onUnmounted(() => { mounted = false })
const labels = { copy: 'events.cta.copyLink', report: 'events.menu.report', cancel: 'events.menu.cancel' } as const
type Action = keyof typeof labels

function showFailure(error: unknown) {
  const key = memberEventErrorKey(error)
  uni.showToast({ title: key ? t(key) : friendlyErrorMessage(error, lang.value === 'zh' ? 'zh' : 'en') || t('error.actionFailed'), icon: 'none' })
}
function report(row: CommunityEvent, token: AccountRequestToken) {
  const target = row.discussion_post_id
  if (!target) return
  const current = () => mounted && props.event.id === row.id && isAccountRequestCurrent(token)
  const reasons = [t('report.reasonSpam'), t('report.reasonProhibited'), t('report.reasonMisleading'), t('report.reasonOther')]
  uni.showActionSheet({
    itemList: reasons,
    success: async ({ tapIndex }) => {
      const reason = reasons[tapIndex]
      if (!current() || reason === undefined) return
      working.value = true
      try {
        await reportTarget('post', target, reason)
        if (current()) uni.showToast({ title: t('report.thanksCommunity'), icon: 'none', duration: 2500 })
      } catch (error) {
        if (!(error instanceof Error) && !(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')) throw error
        if (current()) showFailure(error)
      } finally {
        working.value = false
      }
    },
  })
}
function cancel(row: CommunityEvent, token: AccountRequestToken) {
  const current = () => mounted && props.event.id === row.id && isAccountRequestCurrent(token)
  uni.showModal({
    content: t('events.cancelConfirm'), confirmText: t('events.cancel.confirm'), cancelText: t('events.cancel.keep'),
    success: async ({ confirm }) => {
      if (!confirm || !current()) return
      working.value = true
      try {
        const result = await cancelMemberEvent(row.id)
        if (current()) emit('cancelled', result)
      } catch (error) {
        if (!(error instanceof Error)) throw error
        if (current()) showFailure(error)
      } finally {
        working.value = false
      }
    },
  })
}
async function open() {
  if (working.value) return
  await awaitAuthReady()
  if (!mounted) return
  const row = props.event
  const user = currentUser.value
  const token = user ? captureAccountRequest(user.id) : null
  const owner = row.source_type === 'member' && user?.id === row.organizer_user_id
  const state = eventState(row, Date.now())
  const actions: readonly Action[] = [
    'copy',
    ...(row.source_type === 'member' && user && !owner && row.discussion_post_id ? ['report'] as const : []),
    ...(owner && state !== 'cancelled' && state !== 'ended' ? ['cancel'] as const : []),
  ]
  uni.showActionSheet({
    itemList: actions.map(action => t(labels[action])),
    success: ({ tapIndex }) => {
      if (!mounted || props.event.id !== row.id) return
      const action = actions[tapIndex]
      if (action === undefined) return
      switch (action) {
        case 'copy': {
          let origin = BASE_URL
          // #ifdef H5
          origin = window.location.origin
          // #endif
          uni.setClipboardData({
            data: `${origin}/#/pages/event/detail/index?id=${encodeURIComponent(row.id)}`,
            showToast: false,
            success: () => uni.showToast({ title: t('events.linkCopied'), icon: 'none' }),
            fail: () => uni.showToast({ title: t('error.actionFailed'), icon: 'none' }),
          })
          break
        }
        case 'report':
          if (token && isAccountRequestCurrent(token)) report(row, token)
          break
        case 'cancel':
          if (token && isAccountRequestCurrent(token)) cancel(row, token)
          break
        default: {
          const impossible: never = action
          throw new TypeError(`Unknown event menu action: ${impossible}`)
        }
      }
    },
  })
}
</script>

<style scoped>
.ed-more.u-btn { width: 44px; min-width: 44px; padding: 0; flex: none; background: transparent; color: var(--ink-soft); }
</style>
