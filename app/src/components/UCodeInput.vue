<template>
  <input
    class="u-code-input"
    :value="modelValue"
    type="number"
    :maxlength="6"
    :placeholder="placeholder"
    :focus="autofocus"
    @input="onInput"
  />
</template>

<script setup lang="ts">
/*
 * UCodeInput — a single numeric input for a 6-digit email OTP (QA6 #1).
 *
 * Deliberately a plain uni <input>, not per-cell boxes: a single field has
 * no DOM focus juggling (document/clipboard/ref.focus()), so it compiles and
 * behaves identically on H5 and mp-weixin. Non-digits are stripped and the
 * value is capped at 6 in the handler (type="number"'s maxlength is advisory
 * on some platforms). Shared by reset-password (and reusable for signup-
 * confirm later).
 */
defineProps<{ modelValue: string; placeholder?: string; autofocus?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function onInput(e: any) {
  const raw = String(e?.detail?.value ?? '')
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  emit('update:modelValue', digits)
}
</script>

<style scoped>
.u-code-input {
  width: 100%; height: 52px;
  background: var(--bg-elev-2); border-radius: 12px;
  padding: 0 16px;
  font-size: 22px; font-weight: 700; letter-spacing: 10px;
  text-align: center;
  color: var(--text-primary);
  border: 1px solid transparent;
}
.u-code-input:focus { border-color: var(--line-soft); background: var(--bg-elev-1); }
</style>
