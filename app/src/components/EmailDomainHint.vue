<template>
  <button v-if="suggestion" class="email-domain-hint" :disabled="disabled" @click="acceptSuggestion">
    {{ t('login.emailDomainSuggestion', { email: suggestion }) }}
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { suggestEmailDomain } from '../utils/emailDomainHint'

const props = defineProps<{ email: string; disabled?: boolean }>()
const emit = defineEmits<{ accept: [email: string] }>()
const { t } = useI18n()
const suggestion = computed(() => suggestEmailDomain(props.email))

function acceptSuggestion() {
  if (!props.disabled && suggestion.value) emit('accept', suggestion.value)
}
</script>

<style scoped>
.email-domain-hint {
  display: block;
  width: 100%;
  min-height: 44px;
  margin: 4px 0 0;
  padding: 8px 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  overflow-wrap: anywhere;
  white-space: normal;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.email-domain-hint::after { border: 0; }
</style>
