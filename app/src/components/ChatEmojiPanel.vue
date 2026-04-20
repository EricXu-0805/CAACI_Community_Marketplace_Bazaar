<template>
  <view v-if="open" class="emoji-panel">
    <view class="ep-tabs">
      <text
        v-for="g in groups"
        :key="g.key"
        :class="['ep-tab', { active: activeKey === g.key }]"
        @click="activeKey = g.key"
      >{{ g.label }}</text>
    </view>
    <scroll-view scroll-y class="ep-grid-wrap">
      <view class="ep-grid">
        <view
          v-for="(e, i) in activeGroup.emojis"
          :key="g_key(e, i)"
          class="ep-cell"
          @click="pick(e)"
        >
          <text class="ep-emoji">{{ e }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'pick', emoji: string): void }>()

const RECENT_KEY = 'chat_emoji_recent'
const RECENT_MAX = 16

function loadRecent(): string[] {
  try {
    const raw = uni.getStorageSync(RECENT_KEY)
    if (Array.isArray(raw)) return raw.filter(x => typeof x === 'string').slice(0, RECENT_MAX)
    if (typeof raw === 'string' && raw) return JSON.parse(raw) as string[]
  } catch {}
  return []
}
function saveRecent(list: string[]) {
  try { uni.setStorageSync(RECENT_KEY, list.slice(0, RECENT_MAX)) } catch {}
}

const recent = ref<string[]>(loadRecent())

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

const activeKey = ref<string>('smileys')

const groups = computed(() => {
  const base = GROUPS.map(g => ({
    key: g.key,
    label: t(g.labelKey),
    emojis: g.emojis,
  }))
  if (recent.value.length > 0) {
    return [
      { key: 'recent', label: t('chat.emojiGroupRecent'), emojis: recent.value },
      ...base,
    ]
  }
  return base
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

function g_key(e: string, i: number) {
  return `${e}_${i}`
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
  border-bottom: 0.5px solid rgba(0,0,0,0.04);
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
    background: #1a1a1a;
    color: #fff;
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
.ep-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  &:active { background: var(--bg-subtle); }
}
.ep-emoji { font-size: 22px; line-height: 1; }
</style>
