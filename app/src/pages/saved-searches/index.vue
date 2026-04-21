<template>
  <view class="page">
    <view class="header">
      <view class="back-btn" @click="goBack"><view class="back-arrow"></view></view>
      <text class="header-title">{{ t('savedSearch.title') }}</text>
    </view>

    <view class="hint">
      <text>{{ t('savedSearch.hint') }}</text>
    </view>

    <scroll-view class="list" scroll-y>
      <view v-if="items.length === 0" class="empty">
        <text class="empty-icon">🔔</text>
        <text class="empty-text">{{ t('savedSearch.empty') }}</text>
      </view>
      <view v-else>
        <view v-for="s in items" :key="s.id" class="ss-card">
          <view class="ss-main">
            <text class="ss-kw">{{ s.keyword }}</text>
            <view class="ss-meta">
              <text v-if="s.category" class="ss-chip">{{ t('cat.' + s.category) }}</text>
              <text v-if="s.price_min || s.price_max" class="ss-chip">
                ${{ s.price_min || 0 }}–${{ s.price_max || '∞' }}
              </text>
            </view>
          </view>
          <view class="ss-del" @click="onDelete(s.id)">
            <view class="trash-ico"></view>
          </view>
        </view>
      </view>
    </scroll-view>

    <view class="fab" @click="showForm = true">
      <text class="fab-plus">+</text>
    </view>

    <view v-if="showForm" class="sheet-mask" @click="showForm = false"></view>
    <view :class="['form-sheet', { open: showForm }]">
      <view class="fs-header">
        <text class="fs-cancel" @click="showForm = false">{{ t('plaza.cancel') }}</text>
        <text class="fs-title">{{ t('savedSearch.new') }}</text>
        <text
          :class="['fs-save', { disabled: !form.keyword.trim() || submitting }]"
          @click="onSubmit"
        >{{ t('editProfile.save') }}</text>
      </view>
      <view class="fs-body">
        <view class="fs-row">
          <text class="fs-label">{{ t('savedSearch.keyword') }}</text>
          <input
            v-model="form.keyword"
            :placeholder="t('savedSearch.keywordPh')"
            class="fs-input"
            maxlength="60"
          />
        </view>
        <view class="fs-row">
          <text class="fs-label">{{ t('filter.category') || t('publish.category') }}</text>
          <view class="fs-cats">
            <view
              v-for="c in categoryKeys"
              :key="c || 'any'"
              :class="['fs-chip', { active: form.category === c }]"
              @click="form.category = c as any"
            >
              <text>{{ c ? t('cat.' + c) : t('cat.all') }}</text>
            </view>
          </view>
        </view>
        <view class="fs-row fs-row-price">
          <text class="fs-label">{{ t('filter.price') }}</text>
          <view class="fs-price-wrap">
            <input v-model="form.priceMin" type="number" placeholder="Min" class="fs-price-input" />
            <text class="fs-dash">–</text>
            <input v-model="form.priceMax" type="number" placeholder="Max" class="fs-price-input" />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../composables/useAuth'
import { useSavedSearch } from '../../composables/useSavedSearch'
import { friendlyErrorMessage } from '../../utils'
import type { ItemCategory } from '../../types'

const { t, lang } = useI18n()
const { currentUser } = useAuth()
const { items, fetchMine, create, remove } = useSavedSearch()

const showForm = ref(false)
const submitting = ref(false)
const form = ref<{ keyword: string; category: ItemCategory | null; priceMin: string; priceMax: string }>({
  keyword: '',
  category: null,
  priceMin: '',
  priceMax: '',
})

const categoryKeys: (ItemCategory | null)[] = [null, 'electronics', 'furniture', 'books', 'clothing', 'housing', 'daily', 'vehicles', 'food', 'currency_exchange', 'other']

onMounted(async () => {
  if (!currentUser.value) {
    uni.showToast({ title: t('profile.signInHint'), icon: 'none' })
    return
  }
  try { await fetchMine() } catch {}
})

async function onSubmit() {
  if (!form.value.keyword.trim() || submitting.value) return
  submitting.value = true
  try {
    await create({
      keyword: form.value.keyword,
      category: form.value.category,
      priceMin: form.value.priceMin ? Number(form.value.priceMin) : null,
      priceMax: form.value.priceMax ? Number(form.value.priceMax) : null,
    })
    showForm.value = false
    form.value = { keyword: '', category: null, priceMin: '', priceMax: '' }
    uni.showToast({ title: t('savedSearch.created'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({
      title: friendlyErrorMessage(err, lang.value as 'en' | 'zh'),
      icon: 'none',
      duration: 2500,
    })
  } finally {
    submitting.value = false
  }
}

async function onDelete(id: string) {
  uni.showModal({
    title: t('savedSearch.deleteConfirm'),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await remove(id)
        uni.showToast({ title: t('profile.deleted'), icon: 'success' })
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('error.actionFailed'), icon: 'none' })
      }
    },
  })
}

function goBack() { uni.navigateBack() }
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: var(--bg-subtle); max-width: 480px; margin: 0 auto; }

.header {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: var(--bg-elev-1); border-bottom: 0.5px solid var(--line-hair);
}
.back-btn { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.back-arrow { width: 9px; height: 9px; border-left: 2px solid var(--accent-primary); border-bottom: 2px solid var(--accent-primary); transform: rotate(45deg); margin-left: 4px; }
.header-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }

.hint {
  padding: 10px 16px; font-size: 12px; color: var(--text-secondary, #5a5a63);
  background: var(--bg-elev-2); border-bottom: 0.5px solid rgba(0,0,0,0.04);
}
.list { padding: 8px 12px 100px; }
.empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 80px 40px; gap: 12px; text-align: center;
}
.empty-icon { font-size: 48px; }
.empty-text { font-size: 14px; color: var(--text-muted); line-height: 1.5; }

.ss-card {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-elev-1); border-radius: 10px;
  padding: 12px 14px; margin-bottom: 8px;
}
.ss-main { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.ss-kw { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.ss-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.ss-chip {
  font-size: 11px; padding: 3px 8px;
  background: var(--bg-subtle); color: var(--text-secondary, #5a5a63);
  border-radius: 10px;
}
.ss-del {
  width: 34px; height: 34px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { background: var(--bg-subtle); }
}
.trash-ico {
  width: 14px; height: 16px; border: 1.5px solid var(--text-muted); border-radius: 1px;
  position: relative;
  &::before {
    content: ''; position: absolute; top: -4px; left: -2px; right: -2px;
    height: 2px; background: var(--text-muted); border-radius: 1px;
  }
}

.fab {
  position: fixed; right: 20px; bottom: calc(20px + env(safe-area-inset-bottom));
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent-primary); color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 18px rgba(0,0,0,0.18);
  cursor: pointer; z-index: 10;
  &:active { transform: scale(0.96); }
}
.fab-plus { color: #fff; font-size: 28px; line-height: 1; }

.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000;
}
.form-sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1001;
  background: var(--bg-elev-1); border-radius: 18px 18px 0 0;
  transform: translateY(100%); transition: transform 0.26s ease;
  padding-bottom: env(safe-area-inset-bottom);
  &.open { transform: translateY(0); }
}
.fs-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 0.5px solid var(--line-hair);
}
.fs-cancel, .fs-save { font-size: 14px; cursor: pointer; color: var(--text-secondary, #5a5a63); }
.fs-save { color: #1a7aff; font-weight: 600; &.disabled { color: var(--text-faint); pointer-events: none; } }
.fs-title { font-size: 15px; font-weight: 600; }
.fs-body { padding: 12px 16px 20px; }
.fs-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.fs-label { font-size: 12px; color: var(--text-secondary, #5a5a63); }
.fs-input {
  padding: 10px 12px; border-radius: 8px;
  background: var(--bg-subtle); font-size: 14px;
}
.fs-cats { display: flex; flex-wrap: wrap; gap: 6px; }
.fs-chip {
  padding: 5px 12px; border-radius: 14px; font-size: 12px;
  background: var(--bg-subtle); color: var(--text-secondary, #5a5a63);
  cursor: pointer;
  &.active { background: var(--accent-primary); color: #fff; }
}
.fs-row-price { }
.fs-price-wrap { display: flex; align-items: center; gap: 8px; }
.fs-price-input {
  flex: 1; padding: 10px 12px; border-radius: 8px;
  background: var(--bg-subtle); font-size: 14px;
}
.fs-dash { color: var(--text-faint); }
</style>
