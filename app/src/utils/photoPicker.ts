/** Native photo-picker errors must not look like a successful, empty pick. */
export function photoPickerErrorKey(error: unknown): string | null {
  const detail = error && typeof error === 'object' ? error as { errMsg?: unknown; message?: unknown } : null
  const message = String(detail?.errMsg || detail?.message || '')
  if (/cancel/i.test(message)) return null
  if (/privacy|authorize|authori[sz]ation|permission|auth deny|access denied/i.test(message)) return 'photoPicker.permission'
  return 'photoPicker.failed'
}
