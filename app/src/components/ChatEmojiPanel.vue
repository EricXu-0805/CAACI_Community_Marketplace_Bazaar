<template>
  <view v-if="open" class="emoji-panel">
    <view class="ep-tabs" role="tablist">
      <text
        v-for="g in groups"
        :key="g.key"
        :class="['ep-tab', { active: activeKey === g.key }]"
        role="tab"
        :tabindex="activeKey === g.key ? 0 : -1"
        :aria-selected="activeKey === g.key"
        :aria-label="g.label"
        :title="g.label"
        @click="activeKey = g.key"
        @keydown="onTabKeydown($event, g.key)"
      >{{ g.label }}</text>
    </view>
    <scroll-view scroll-y class="ep-grid-wrap">
      <!--
        Essentials group (P3): self-drawn stickers. Tapping one SENDS a
        standalone sticker message immediately (WeChat sticker-pack
        semantics) — it does not insert into the text input like the
        unicode groups below do.
      -->
      <view v-if="activeKey === 'stickers'" class="ep-grid ep-grid-stickers">
        <view
          v-for="s in STICKER_ORDER"
          :key="s"
          class="ep-cell ep-cell-sticker"
          role="button"
          :aria-label="stickerAriaLabel(s)"
          :title="stickerAriaLabel(s)"
          @click="emit('pickSticker', s)"
        >
          <USticker :name="s" :size="38" />
        </view>
      </view>
      <view v-else class="ep-grid">
        <view
          v-for="(e, i) in activeGroup.emojis"
          :key="g_key(e, i)"
          class="ep-cell"
          role="button"
          :aria-label="e"
          :title="e"
          @click="pick(e)"
        >
          <text class="ep-emoji">{{ e }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n'
import USticker from './USticker.vue'
import { STICKER_ORDER, type StickerName } from './stickers/registry'
import {
  readAccountPrivateStorage,
  registerAccountPrivateStateHydrate,
  registerAccountPrivateStateReset,
  writeAccountPrivateStorage,
} from '../api/accountLocalPrivacy'

const { t } = useI18n()

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'pick', emoji: string): void
  (e: 'pickSticker', name: StickerName): void
}>()

const RECENT_KEY = 'chat_emoji_recent'
const RECENT_MAX = 16

function loadRecent(): string[] {
  try {
    const stored = readAccountPrivateStorage<unknown>(RECENT_KEY, [])
    if (!stored.allowed) return []
    const raw = typeof stored.value === 'string'
      ? JSON.parse(stored.value)
      : stored.value
    if (Array.isArray(raw)) return raw.filter(x => typeof x === 'string').slice(0, RECENT_MAX)
  } catch {}
  return []
}
function saveRecent(list: string[]) {
  writeAccountPrivateStorage(RECENT_KEY, list.slice(0, RECENT_MAX))
}

const recent = ref<string[]>(loadRecent())
const stopRecentReset = registerAccountPrivateStateReset(() => { recent.value = [] })
const stopRecentHydrate = registerAccountPrivateStateHydrate(() => { recent.value = loadRecent() })

onUnmounted(() => {
  stopRecentReset()
  stopRecentHydrate()
})

const GROUPS = [
  {
    key: 'smileys',
    labelKey: 'chat.emojiGroupSmileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😗', '☺️', '😚', '😙', '🥲', '😋', '😛',
      '😜', '🤪', '😝', '🤑', '🤗', '🫡', '🤔', '🤭',
      '🤫', '🤥', '😐', '😑', '😶', '🫥', '😏', '😒',
      '🙄', '😬', '😌', '😔', '😪', '🤤', '😴', '😷',
      '🤒', '🤕', '🤧', '🥵', '🥶', '🥴', '😵', '🤯',
      '🤠', '🥳', '🥸', '😎', '🤓', '🧐',
    ],
  },
  {
    key: 'feelings',
    labelKey: 'chat.emojiGroupFeelings',
    emojis: [
      '😢', '😭', '😤', '😠', '😡', '🤬', '😈', '👿',
      '💀', '☠️', '💩', '🤡', '👻', '👽', '🙀',
      '💔', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤',
      '🤍', '🤎', '💖', '💕', '💞', '💓', '💗', '💘',
      '💝', '💟',
    ],
  },
  {
    key: 'gestures',
    labelKey: 'chat.emojiGroupGestures',
    emojis: [
      '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🫰',
      '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️',
      '✋', '🤚', '🖐', '🖖', '👋', '🤝', '🙏', '✊',
      '👊', '🤛', '🤜', '💪', '🫶', '👐', '🙌', '👏',
    ],
  },
  {
    key: 'objects',
    labelKey: 'chat.emojiGroupObjects',
    emojis: [
      '🎓', '📚', '📖', '✏️', '📝', '📎', '📌', '🔑',
      '💡', '🔔', '📱', '💻', '⌨️', '🖱️', '🖥️', '🎧',
      '🎤', '📷', '🎬', '🔋', '🔌', '🛒', '🎁', '💰',
      '💵', '💳', '🏷️', '📦', '🗝️', '🔒', '🔓', '🧳',
    ],
  },
  {
    key: 'life',
    labelKey: 'chat.emojiGroupLife',
    emojis: [
      '🍜', '🍱', '🍙', '🍣', '🍤', '🍚', '🍛', '🍲',
      '🥟', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯',
      '🥗', '🍝', '🍞', '🧀', '🥞', '🧇', '🍦', '🍰',
      '🎂', '🍪', '🍩', '☕', '🍵', '🧋', '🧃', '🧉',
      '🍺', '🍻', '🥂', '🍷', '🍸', '🏠', '🏡', '🏢',
      '🚗', '🚙', '🚕', '🚌', '🚎', '🚑', '🚒', '🚲',
      '🛴', '🛵', '🏍', '✈️', '🚆', '🚇',
    ],
  },
  {
    key: 'signs',
    labelKey: 'chat.emojiGroupSigns',
    emojis: [
      '✅', '❌', '⭕', '❗', '❓', '💯', '✨', '🎉',
      '🎊', '🔥', '💢', '💫', '💥', '⚡', '🌈', '☀️',
      '⛅', '☁️', '🌧', '⛈', '❄️', '☃️', '⛄', '🌊',
      '🔔', '🔕', '🔞', '🆕', '🆒', '🆗', '🆙', '🔄',
      '➡️', '⬅️', '⬆️', '⬇️', '🔁', '🔂', '▶️', '⏸',
    ],
  },
]

const activeKey = ref<string>('stickers')

const groups = computed(() => {
  const base = GROUPS.map(g => ({
    key: g.key,
    label: t(g.labelKey),
    emojis: g.emojis,
  }))
  const head = [{ key: 'stickers', label: t('chat.emojiGroupStickers'), emojis: [] as string[] }]
  if (recent.value.length > 0) {
    head.push({ key: 'recent', label: t('chat.emojiGroupRecent'), emojis: recent.value })
  }
  return [...head, ...base]
})

const activeGroup = computed(() => {
  return groups.value.find(g => g.key === activeKey.value) || groups.value[0]
})

watch(() => props.open, (v) => {
  if (v) recent.value = loadRecent()
})

function pick(emoji: string) {
  const next = [emoji, ...recent.value.filter(x => x !== emoji)].slice(0, RECENT_MAX)
  recent.value = next
  saveRecent(next)
  emit('pick', emoji)
}

function onTabKeydown(event: KeyboardEvent, key: string) {
  const keys = groups.value.map(group => group.key)
  const index = keys.indexOf(key)
  if (index < 0) return

  let nextIndex = index
  if (event.key === 'ArrowRight') nextIndex = (index + 1) % keys.length
  else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + keys.length) % keys.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = keys.length - 1
  else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault()
    activeKey.value = key
    return
  } else return

  event.preventDefault()
  activeKey.value = keys[nextIndex]
  const tabList = (event.currentTarget as HTMLElement | null)?.parentElement
  const tabs = tabList?.querySelectorAll<HTMLElement>('[role="tab"]')
  tabs?.[nextIndex]?.focus()
}

function g_key(e: string, i: number) {
  return `${e}_${i}`
}

function stickerAriaLabel(name: StickerName): string {
  return `${t('chat.sticker')}: ${name.replace(/-/g, ' ')}`
}
</script>

<style lang="scss" scoped>
.emoji-panel {
  background: var(--bg-elev-1);
  border-top: 0.5px solid var(--line-hair);
  max-height: 280px;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom);
  max-width: 480px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}
.ep-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 4px;
  overflow-x: auto;
  white-space: nowrap;
  border-bottom: 0.5px solid var(--line-hair);
}
.ep-tab {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 14px;
  background: var(--bg-subtle);
  cursor: pointer;
  flex-shrink: 0;
  &.active {
    background: var(--ink);
    color: var(--ink-inverse);
    font-weight: 600;
  }
  &:active { opacity: 0.75; }
}
.ep-grid-wrap {
  flex: 1;
  min-height: 180px;
  max-height: 220px;
}
.ep-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  padding: 8px 10px 12px;
}
.ep-grid-stickers {
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}
.ep-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  &:active { background: var(--bg-subtle); }
}
.ep-cell-sticker {
  height: 52px;
}
.ep-emoji { font-size: 22px; line-height: 1; }
</style>
