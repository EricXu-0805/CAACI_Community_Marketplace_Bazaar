<template>
  <view class="page has-sidebar" :class="mpThemeClass" :style="mpChrome">
    <!-- #ifndef H5 -->
    <AppToast />
    <!-- #endif -->
    <AppSidebar current="publish" />

    <!-- Mobile Header -->
    <view v-if="publishReady" class="page-header u-glass u-glass--hair-b">
      <text class="ph-title">{{ t('publish.title') }}</text>
    </view>

    <view v-if="!publishReady" class="auth-check" role="status" aria-live="polite">
      <view class="auth-check-spinner"></view>
      <text class="auth-check-text">{{ t('login.wait') }}</text>
    </view>

    <view v-if="publishReady" class="form">
      <!-- 出售 / 求购 — a wanted post (migration 054) relaxes price + condition. -->
      <view class="listing-type-seg" role="group" :aria-label="t('publish.title')">
        <view
          :class="['lt-seg', 'u-press', { on: form.listingType === 'sell' }]"
          role="button"
          :aria-label="t('publish.typeSell')"
          :aria-pressed="form.listingType === 'sell' ? 'true' : 'false'"
          @click="form.listingType = 'sell'"
        >
          <text class="lt-seg-label">{{ t('publish.typeSell') }}</text>
        </view>
        <view
          :class="['lt-seg', 'u-press', { on: form.listingType === 'wanted' }]"
          role="button"
          :aria-label="t('publish.typeWanted')"
          :aria-pressed="form.listingType === 'wanted' ? 'true' : 'false'"
          @click="form.listingType = 'wanted'"
        >
          <text class="lt-seg-label">{{ t('publish.typeWanted') }}</text>
        </view>
      </view>

      <view class="image-section">
        <view class="image-list">
          <view v-for="(img, i) in imageList" :key="i" class="image-item">
            <image :src="img" alt="Photo" mode="aspectFill" class="preview-image" />
            <view class="remove-btn" role="button" :aria-label="t('a11y.delete')" @click="removeImage(i)">
              <UIcon name="close" size="xs" color="#FFFFFF" aria-hidden="true" />
            </view>
            <view v-if="i === 0" class="cover-tag">
              <text class="cover-tag-label">{{ t('publish.cover') }}</text>
            </view>
          </view>
          <view v-if="imageList.length < 9" class="image-add" role="button" :aria-label="t('publish.addPhoto')" @click="chooseImage">
            <UIcon name="plus" size="sm" color="text-faint" />
            <text class="add-text">{{ t('publish.addPhoto') }}</text>
            <text class="add-count">{{ imageList.length }}/9</text>
          </view>
        </view>
        <text class="image-tip">{{ imageList.length >= 9 ? t('publish.imageMaxReached') : t('publish.imageOptional') }}</text>
      </view>

      <!-- Upload progress -->
      <view v-if="uploadProgress" class="upload-bar">
        <view class="upload-fill" :style="{ width: uploadProgress + '%' }"></view>
        <text class="upload-text">{{ t('publish.uploading') }} {{ uploadProgress }}%</text>
      </view>

      <view class="form-group">
        <input v-model="form.title" :placeholder="form.listingType === 'wanted' ? t('publish.wantedTitlePlaceholder') : t('publish.titlePlaceholder')" :aria-label="form.listingType === 'wanted' ? t('publish.wantedTitlePlaceholder') : t('publish.titlePlaceholder')" maxlength="50" class="form-input title-input" @focus="onFieldFocus" @blur="onFieldBlur" />
        <text class="char-count">{{ form.title.length }}/50</text>
      </view>

      <view class="form-group">
        <textarea v-model="form.description" :placeholder="t('publish.descPlaceholder')" :aria-label="t('publish.descPlaceholder')" maxlength="500" class="form-textarea" @focus="onFieldFocus" @blur="onFieldBlur" />
        <text class="char-count">{{ form.description.length }}/500</text>
      </view>

      <view class="form-group row">
        <text class="label">{{ form.listingType === 'wanted' ? t('publish.budget') : t('publish.price') }}</text>
        <view class="price-input">
          <text class="currency">$</text>
          <input v-model="form.price" type="digit" :placeholder="form.listingType === 'wanted' ? t('publish.budgetPlaceholder') : '0.00'" :aria-label="form.listingType === 'wanted' ? t('publish.budget') : t('publish.price')" class="form-input" @focus="onFieldFocus" @blur="onFieldBlur" />
        </view>
      </view>

      <view v-if="avgPrice > 0 && form.category && form.listingType !== 'wanted'" class="price-hint">
        <text>{{ t('publish.avgPrice') }}: ${{ avgPrice }}</text>
      </view>

      <!-- Category: inline pill selector -->
      <view class="form-group">
        <view
          class="field-header"
          role="button"
          :aria-label="t('publish.category')"
          :aria-expanded="showCat ? 'true' : 'false'"
          aria-controls="publish-category-options"
          @click="showCat = !showCat"
        >
          <text class="label">{{ t('publish.category') }}</text>
          <text :class="['field-value', { placeholder: !form.category }]">
            {{ form.category ? t('cat.' + form.category) : t('publish.categorySelect') }}
          </text>
          <view :class="['chevron', { open: showCat }]"><UIcon name="chevron-right" size="xs" color="text-faint" /></view>
        </view>
        <view v-if="showCat" id="publish-category-options" class="pill-grid">
          <view
            v-for="cat in categoryKeys"
            :key="cat"
            :class="['sel-pill', { active: form.category === cat }]"
            role="button"
            :aria-label="t('cat.' + cat)"
            :aria-pressed="form.category === cat ? 'true' : 'false'"
            @click="onCategoryTap(cat)"
          >
            <text>{{ t('cat.' + cat) }}</text>
            <UIcon v-if="form.category === cat" class="sel-pill-clear" name="close" size="xs" color="currentColor" aria-hidden="true" />
          </view>
        </view>
      </view>

      <!-- Condition: inline pill selector (sell only — N/A for a wanted post) -->
      <view v-if="form.listingType !== 'wanted'" class="form-group">
        <view
          class="field-header"
          role="button"
          :aria-label="t('publish.condition')"
          :aria-expanded="showCond ? 'true' : 'false'"
          aria-controls="publish-condition-options"
          @click="showCond = !showCond"
        >
          <text class="label">{{ t('publish.condition') }}</text>
          <text :class="['field-value', { placeholder: !form.condition }]">
            {{ form.condition ? t('condition.' + form.condition) : t('publish.conditionSelect') }}
          </text>
          <view :class="['chevron', { open: showCond }]"><UIcon name="chevron-right" size="xs" color="text-faint" /></view>
        </view>
        <view v-if="showCond" id="publish-condition-options" class="pill-grid">
          <view
            v-for="cond in conditionKeys"
            :key="cond"
            :class="['sel-pill cond-pill', { active: form.condition === cond }]"
            role="button"
            :aria-label="t('condition.' + cond)"
            :aria-pressed="form.condition === cond ? 'true' : 'false'"
            @click="onConditionTap(cond)"
          >
            <text class="cp-name">{{ t('condition.' + cond) }}</text>
            <text class="cp-hint">{{ t('condition.' + cond + '_hint') }}</text>
            <UIcon v-if="form.condition === cond" class="sel-pill-clear" name="close" size="xs" color="currentColor" aria-hidden="true" />
          </view>
        </view>
      </view>

      <view class="form-group row">
        <text class="label">{{ t('publish.location') }}</text>
        <input v-model="form.location" :placeholder="t('publish.locationPlaceholder')" :aria-label="t('publish.location')" class="form-input flex-input" @focus="onFieldFocus" @blur="onFieldBlur" />
      </view>

      <scroll-view scroll-x class="spot-row">
        <view
          v-for="spot in CAMPUS_SPOTS"
          :key="spot.id"
          class="spot-chip"
          :class="{ active: form.location === spotLabel(spot) }"
          role="button"
          :aria-label="spotLabel(spot)"
          :aria-pressed="form.location === spotLabel(spot) ? 'true' : 'false'"
          @click="onSpotChipTap(spot)"
        >
          {{ spotLabel(spot) }}
        </view>
      </scroll-view>

      <!-- #ifdef H5 -->
      <!-- H5-only: on mp this button would need uni.getLocation, whose
           console 接口申请 is category-gated (individual subjects are
           effectively never approved) — so the mp build drops the button
           (manual location input + spot chips remain) and the manifest
           declares no location APIs at all, keeping that whole review
           risk class off the table. -->
      <view
        class="locate-btn"
        :class="{ 'locate-btn--detecting': detectingLoc }"
        role="button"
        :aria-label="t('a11y.detectLocation')"
        :aria-busy="detectingLoc ? 'true' : 'false'"
        @click="!detectingLoc && onDetectLocation()"
      >
        <view v-if="detectingLoc" class="locate-btn-spinner"></view>
        <image v-else class="locate-btn-icon" src="/static/locate.svg" alt="" mode="aspectFit" />
        <text class="locate-btn-text">{{ detectingLoc ? t('publish.detectingLocation') : t('publish.useCurrentLocation') }}</text>
      </view>
      <OsmAttribution />
      <!-- #endif -->

      <view
        class="form-group row toggle-row"
        role="button"
        :aria-label="t('publish.obo')"
        :aria-pressed="form.negotiable ? 'true' : 'false'"
        @click="form.negotiable = !form.negotiable"
      >
        <text class="label">{{ t('publish.obo') }}</text>
        <text class="toggle-hint">{{ t('publish.oboHint') }}</text>
        <view :class="['toggle', { on: form.negotiable }]">
          <view class="toggle-knob"></view>
        </view>
      </view>
    </view>

    <view v-show="publishReady && !typing" class="submit-bar">
      <UButton size="lg" block :loading="submitting" @click="onSubmit">
        {{ t('publish.submit') }}
      </UButton>
    </view>

    <CustomTabBar v-if="publishReady" current="publish" :hidden="typing" />

    <PermissionDeniedModal
      v-if="publishReady"
      :visible="permissionModalVisible"
      @close="permissionModalVisible = false"
    />
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
// #ifndef H5
import AppToast from '../../components/AppToast.vue'
// #endif
import { ref, reactive, computed, onUnmounted } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { watch } from 'vue'
import { useAuth } from '../../composables/useAuth'
import { useSupabase } from '../../composables/useSupabase'
import { useI18n } from '../../composables/useI18n'
import { useCampusSpots, type CampusSpot } from '../../composables/useCampusSpots'
import { useLocation } from '../../composables/useLocation'
import { useItems, type UploadAccountToken } from '../../composables/useItems'
import { useTranslate } from '../../composables/useTranslate'
import { mutationCommitState, mutationOutcomeError, shouldCompensateMutationFailure } from '../../api/mutationCommit'
import { friendlyErrorMessage, PUBLISHABLE_CATEGORIES } from '../../utils'
import { DIALOG_INK, DIALOG_WARN } from '../../utils/dialogColors'
import { captureException } from '../../utils/sentry'
import type { ItemCategory, ItemCondition } from '../../types'
import AppSidebar from '../../components/AppSidebar.vue'
import CustomTabBar from '../../components/CustomTabBar.vue'
import PermissionDeniedModal from '../../components/PermissionDeniedModal.vue'
import UIcon from '../../components/UIcon.vue'
import OsmAttribution from '../../components/OsmAttribution.vue'
import UButton from '../../components/UButton.vue'
import {
  captureAccountRequest,
  isAccountRequestCurrent,
  onAccountTransition,
  type AccountRequestToken,
} from '../../composables/accountScope'
import {
  readAccountPrivateStorage,
  removeAccountPrivateStorage,
  writeAccountPrivateStorage,
} from '../../api/accountLocalPrivacy'

const { t, lang } = useI18n()
const { CAMPUS_SPOTS } = useCampusSpots()

function spotLabel(spot: CampusSpot) {
  return lang.value === 'zh' ? spot.zh : spot.en
}
const { detectLocation, detecting: detectingLoc } = useLocation()
const { currentUser, requireAuth, awaitAuthReady } = useAuth()
const { createItem, updateItem, fetchItem, uploadImagesWithDims, removeOwnedItemImages, fetchItems } = useItems()
const { translateItemContent } = useTranslate()

/*
 * Fire-and-forget bilingual filler.
 *
 * Publish UX must not block on translation — the endpoint can be cold
 * (8s) and we already pay 5-10s for moderation. So we insert the row
 * with only the source-language entry in title_i18n, pop the success
 * toast immediately, and THEN ask the translator to fill the other
 * locale(s) and patch the row via updateItem. If the network drops or
 * the endpoint returns garbage, the i18n map stays partial and the
 * reader-side fallback (`map[lang] ?? original`) simply shows the
 * author's original text in whatever language they typed it in — not
 * a regression from the pre-migration state.
 */
async function scheduleBilingualFill(
  itemId: string,
  title: string,
  description: string,
  sourceLang: string,
  expectedUpdatedAt: string,
  accountToken: UploadAccountToken,
) {
  try {
    if (!title && !description) return
    const { title_i18n, description_i18n } = await translateItemContent({
      title,
      description,
      sourceLang: sourceLang as any,
    })
    const titleKeys = Object.keys(title_i18n)
    const descKeys = Object.keys(description_i18n)
    // Nothing new — author-only map already in DB.
    if (titleKeys.length <= 1 && descKeys.length <= 1) return

    await updateItem(itemId, {
      title_i18n: Object.keys(title_i18n).length ? title_i18n : null,
      description_i18n: Object.keys(description_i18n).length ? description_i18n : null,
    }, { expectedUpdatedAt, accountToken })
  } catch (err) {
    console.warn('[publish] bilingual fill skipped')
  }
}

const { supabase } = useSupabase()
const avgPrice = ref(0)
let avgPriceRequestId = 0

const categoryKeys: ItemCategory[] = PUBLISHABLE_CATEGORIES
const conditionKeys = ['new', 'like_new', 'good', 'fair', 'defective']

const imageList = ref<string[]>([])
const showCat = ref(false)
const showCond = ref(false)
const submitting = ref(false)
let submitEntryLocked = false
const uploadProgress = ref(0)
const publishReady = ref(false)

/*
 * While a text field has focus on a PHONE viewport, hide the fixed
 * submit bar + tab bar. With the keyboard open both bars land right
 * above it (H5 interactive-widget shrinks the layout viewport; mp's
 * adjust-position pushes the page) and wedge the form into a sliver —
 * Eric device report 07-13. Desktop has no on-screen keyboard, so ≥768px
 * viewports keep the bars. 120ms blur grace stops the bars flashing
 * when focus hops between fields.
 */
const typing = ref(false)
let typingT: ReturnType<typeof setTimeout> | null = null
function isPhoneViewport(): boolean {
  // #ifdef H5
  return typeof window !== 'undefined' && window.innerWidth < 768
  // #endif
  // #ifndef H5
  return true
  // #endif
}
function onFieldFocus() {
  if (!isPhoneViewport()) return
  if (typingT) clearTimeout(typingT)
  typing.value = true
}
function onFieldBlur() {
  if (typingT) clearTimeout(typingT)
  typingT = setTimeout(() => { typing.value = false }, 120)
}

const form = reactive({
  title: '',
  description: '',
  price: '',
  category: '' as ItemCategory | '',
  condition: '' as ItemCondition | '',
  location: '',
  negotiable: false,
  listingType: 'sell' as 'sell' | 'wanted',
})

/*
 * Phase 1b: permission_denied now opens a modal (LocationPermission
 * DeniedModal) instead of a fleeting toast. The modal teaches users
 * the Settings path; other failure reasons stay as toast since
 * they're either retryable or environmental.
 */
const permissionModalVisible = ref(false)

/*
 * Tag toggle handlers: tapping the currently-active pill clears the
 * selection (form.category / form.condition becomes ''). This is what
 * lets users escape the "I picked a category by mistake, now the form
 * is permanently dirty" trap. The pill's active style adds a × hint
 * (see .sel-pill.active::after in the scoped styles) to advertise
 * that re-tapping unselects. Sheet auto-closes on either path so the
 * user immediately sees the field returning to its placeholder state.
 */
function onCategoryTap(cat: ItemCategory) {
  form.category = form.category === cat ? '' : cat
  showCat.value = false
}
function onConditionTap(cond: string) {
  form.condition = (form.condition === cond ? '' : cond) as ItemCondition | ''
  showCond.value = false
}

/*
 * Edit-mode entry was split into pages/publish/edit.vue (registered as
 * a non-tabbar subpage in pages.json). This file is now exclusively the
 * tabbar "Post" entry for new-listing creation; an onLoad here would
 * only ever see options without an edit id and is not needed.
 */

watch(() => form.category, async (cat) => {
  const requestId = ++avgPriceRequestId
  if (!cat) { avgPrice.value = 0; return }
  const { data } = await supabase.from('items').select('price').eq('category', cat).eq('status', 'active').limit(50)
  if (requestId !== avgPriceRequestId) return
  if (data && data.length > 0) {
    avgPrice.value = Math.round(data.reduce((s: number, i: any) => s + Number(i.price), 0) / data.length)
  } else { avgPrice.value = 0 }
})

const MAX_IMAGES_PUBLISH = 9

/* ---------- Draft save ----------
   Persist in-progress form data to local storage so users don't lose
   work when they accidentally tap a tabbar icon mid-compose. Scoped to
   new-item mode only (edit mode has a live item row already). */
const DRAFT_KEY = 'publish_draft_v1'

const isDirty = computed(() => {
  return (
    form.title.trim().length > 0 ||
    form.description.trim().length > 0 ||
    form.price.trim().length > 0 ||
    form.category !== '' ||
    form.condition !== '' ||
    form.location.trim().length > 0 ||
    form.negotiable !== false ||
    form.listingType !== 'sell' ||
    imageList.value.length > 0
  )
})

function saveDraft() {
  writeAccountPrivateStorage(DRAFT_KEY, {
    form: { ...form },
    images: [...imageList.value],
    savedAt: Date.now(),
  })
}

function clearDraft() {
  removeAccountPrivateStorage(DRAFT_KEY)
}

type PublishDraft = { form: Record<string, any>; images: string[]; savedAt: number }

function loadDraft(): PublishDraft | null {
  try {
    const stored = readAccountPrivateStorage<unknown>(DRAFT_KEY, null)
    if (!stored.allowed) return null
    const raw = stored.value
    if (!raw || typeof raw !== 'object') return null
    return raw as PublishDraft
  } catch { return null }
}

function applyDraft(draft: { form: any; images: string[] }) {
  Object.assign(form, draft.form)
  imageList.value = [...(draft.images || [])]
  uni.showToast({ title: t('publish.draftRestored'), icon: 'none' })
}

/*
 * Reset all form state to defaults — used after the user picks "Save"
 * or "Discard" in the draft prompt. Critical: without this reset the
 * form stays dirty after the prompt closes, which means the recursive
 * uni.switchTab() inside promptSaveDraft's onDecided callback would
 * trigger the SAME tab guard, the SAME prompt, and uni.showModal's
 * single-instance lock would swallow the second modal silently — user
 * sees "stuck on publish, second tap does nothing". Resetting first
 * makes isDirty=false, so the recursive switchTab passes through the
 * guard cleanly.
 */
function resetForm() {
  form.title = ''
  form.description = ''
  form.price = ''
  form.category = ''
  form.condition = ''
  form.location = ''
  form.negotiable = false
  form.listingType = 'sell'
  showCat.value = false
  showCond.value = false
  imageList.value = []
}

function promptSaveDraft(onDecided: () => void) {
  const promptShowVersion = publishShowVersion
  const promptAccountToken = publishPageAccountToken
  uni.showModal({
    title: t('publish.draftPromptTitle'),
    content: t('publish.draftPromptBody'),
    confirmText: t('publish.draftSave'),
    cancelText: t('publish.draftDiscard'),
    confirmColor: DIALOG_INK,
    success: (r) => {
      if (
        promptShowVersion !== publishShowVersion
        || !promptAccountToken
        || !isAccountRequestCurrent(promptAccountToken)
      ) {
        pendingTabUrl = ''
        return
      }
      if (r.confirm) {
        saveDraft()
        resetForm()
        uni.showToast({ title: t('publish.draftSaved'), icon: 'none' })
      } else if (r.cancel) {
        clearDraft()
        resetForm()
      } else {
        // Modal dismissed without a clear confirm/cancel (rare on H5
        // but possible on mp). Don't navigate — leave the form alone
        // and let the user try again. Equivalent to fail() below.
        pendingTabUrl = ''
        return
      }
      onDecided()
    },
    /*
     * Modal failed to show at all (very rare — usually means uni runtime
     * is in a degraded state). Don't auto-navigate; clear the pending
     * URL so the next tab tap starts fresh instead of silently jumping.
     */
    fail: () => { pendingTabUrl = '' },
  })
}

/* Tabbar uses uni.switchTab, which bypasses navigation guards. The
   official escape hatch is uni.addInterceptor('switchTab'). Scope the
   interceptor to this page's lifetime so other pages don't inherit it. */
let switchTabInterceptor: { invoke: (args: any) => boolean } | null = null
let pendingTabUrl = ''
const removeScopedInterceptor = uni.removeInterceptor as unknown as (
  method: string,
  interceptor: { invoke: (args: any) => boolean },
) => void

function installTabGuard() {
  if (switchTabInterceptor) return
  switchTabInterceptor = {
    invoke(args: { url: string }) {
      /* Staying on the publish tab itself shouldn't trigger the prompt. */
      if (args.url && args.url.includes('/pages/publish/index')) return true
      if (!isDirty.value) return true
      pendingTabUrl = args.url
      promptSaveDraft(() => {
        if (pendingTabUrl) {
          const url = pendingTabUrl
          pendingTabUrl = ''
          uni.switchTab({ url })
        }
      })
      return false
    },
  }
  uni.addInterceptor('switchTab', switchTabInterceptor)
}

function removeTabGuard() {
  if (switchTabInterceptor) {
    // Passing only the method removes every interceptor registered for that
    // navigation API, including App.vue's consent/suspension gate. Remove this
    // page's exact handler so the global fail-closed gate remains installed.
    removeScopedInterceptor('switchTab', switchTabInterceptor)
    switchTabInterceptor = null
  }
}

let publishShowVersion = 0
let publishPageAccountToken: AccountRequestToken | null = null
let publishVisible = false
let publishOperationEpoch = 0
let publishPageMounted = true

function resetPublishMemoryState() {
  publishShowVersion += 1
  publishOperationEpoch += 1
  publishReady.value = false
  publishPageAccountToken = null
  submitEntryLocked = false
  submitting.value = false
  uploadProgress.value = 0
  permissionModalVisible.value = false
  pendingTabUrl = ''
  avgPriceRequestId += 1
  avgPrice.value = 0
  if (typingT) {
    clearTimeout(typingT)
    typingT = null
  }
  typing.value = false
  removeTabGuard()
  resetForm()
}

const stopAccountTransitionListener = onAccountTransition((transition) => {
  // This runs inside transitionAccount(), before useAuth publishes the next
  // profile. Hide and erase A's mounted refs synchronously, then only re-open
  // the still-visible tab after B/anonymous auth and durable storage ownership
  // have settled.
  resetPublishMemoryState()
  if (publishVisible && transition.userId) {
    void Promise.resolve().then(() => {
      if (publishPageMounted && publishVisible) return preparePublishPage()
    })
  }
})

async function preparePublishPage() {
  const showVersion = ++publishShowVersion
  publishReady.value = false
  removeTabGuard()

  // A null profile during app startup is not proof of an anonymous session.
  // Wait for the shared auth handshake before deciding whether to open login,
  // and keep the editable form hidden until that decision is authoritative.
  const state = await awaitAuthReady()
  if (showVersion !== publishShowVersion) return
  if (state !== 'authenticated') {
    requireAuth()
    return
  }
  if (!requireAuth() || !currentUser.value) return

  const nextAccountToken = captureAccountRequest(currentUser.value.id)
  if (
    publishPageAccountToken
    && (
      publishPageAccountToken.userId !== nextAccountToken.userId
      || publishPageAccountToken.generation !== nextAccountToken.generation
    )
  ) {
    // The tab instance survives account switches; never submit the previous
    // account's in-memory form under the new session. accountLocalPrivacy owns
    // persistent A -> B cleanup; this page only clears mounted refs here.
    resetForm()
  }
  publishPageAccountToken = nextAccountToken

  publishReady.value = true
  const draft = loadDraft()
  if (draft && !isDirty.value) {
    const draftShowVersion = showVersion
    const draftAccountToken = nextAccountToken
    uni.showModal({
      title: t('publish.draftRestoreTitle'),
      content: t('publish.draftRestoreBody'),
      confirmText: t('publish.draftRestore'),
      cancelText: t('publish.draftDiscard'),
      confirmColor: DIALOG_INK,
      success: (r) => {
        if (
          draftShowVersion !== publishShowVersion
          || !isAccountRequestCurrent(draftAccountToken)
        ) return
        if (r.confirm) applyDraft(draft)
        else if (r.cancel) clearDraft()
      },
    })
  }
  installTabGuard()
}

function leavePublishPage() {
  publishShowVersion += 1
  publishReady.value = false
  removeTabGuard()
}

function destroyPublishPage() {
  if (!publishPageMounted) return
  publishPageMounted = false
  publishVisible = false
  // Preserve a deliberately saved local draft, but synchronously erase the
  // mounted page's private refs and invalidate in-flight submit/navigation.
  publishShowVersion += 1
  publishOperationEpoch += 1
  publishReady.value = false
  publishPageAccountToken = null
  submitEntryLocked = false
  submitting.value = false
  uploadProgress.value = 0
  permissionModalVisible.value = false
  pendingTabUrl = ''
  avgPriceRequestId += 1
  avgPrice.value = 0
  if (typingT) {
    clearTimeout(typingT)
    typingT = null
  }
  typing.value = false
  removeTabGuard()
  resetForm()
  stopAccountTransitionListener()
}

onShow(() => {
  if (!publishPageMounted) return
  publishVisible = true
  void preparePublishPage()
})

onHide(() => {
  publishVisible = false
  leavePublishPage()
})
onUnload(() => {
  destroyPublishPage()
})
onUnmounted(destroyPublishPage)

function chooseImage() {
  const pickerAccountToken = publishPageAccountToken
  if (!pickerAccountToken || !isAccountRequestCurrent(pickerAccountToken)) return
  const remaining = MAX_IMAGES_PUBLISH - imageList.value.length
  if (remaining <= 0) {
    uni.showToast({ title: t('publish.imageMaxReached'), icon: 'none' })
    return
  }
  uni.chooseImage({
    count: remaining,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      if (
        !publishReady.value
        || publishPageAccountToken !== pickerAccountToken
        || !isAccountRequestCurrent(pickerAccountToken)
      ) return
      /* On H5 the `count` hint is advisory — the underlying <input
         type="file" multiple> lets users pick unlimited files. Enforce
         the cap here and surface it to the user (WeChat-style) instead
         of silently truncating. */
      const picked = Array.isArray(res.tempFilePaths)
        ? res.tempFilePaths
        : res.tempFilePaths ? [res.tempFilePaths] : []
      const accepted = picked.slice(0, remaining)
      const dropped = picked.length - accepted.length
      imageList.value.push(...accepted)
      if (dropped > 0) {
        uni.showToast({
          title: t('publish.imageDropped').replace('{n}', String(dropped)),
          icon: 'none',
          duration: 2500,
        })
      }
    },
  })
}

function removeImage(index: number) {
  imageList.value.splice(index, 1)
}

async function onDetectLocation() {
  const locationAccountToken = publishPageAccountToken
  if (!locationAccountToken || !isAccountRequestCurrent(locationAccountToken)) return
  const result = await detectLocation()
  if (
    !publishReady.value
    || publishPageAccountToken !== locationAccountToken
    || !isAccountRequestCurrent(locationAccountToken)
  ) return
  if (!result.ok) {
    console.warn('[publish] location detect failed')
    /*
     * Phase 1b dispatch: permission_denied → modal (teach the
     * Settings path), other reasons → toast (retryable or rare
     * environmental). The publish.gpsPermissionDenied i18n key
     * stays in the cluster for forward-compat / fallback even
     * though it's no longer routed through the toast path here.
     */
    if (result.reason === 'permission_denied') {
      permissionModalVisible.value = true
      return
    }
    const reasonKey: Record<string, string> = {
      permission_prompt_dismissed: 'publish.gpsPermissionDismissed',
      position_unavailable: 'publish.gpsUnavailable',
      timeout: 'publish.gpsTimeout',
      geocode_failed: 'publish.gpsGeocodeFailed',
      unsupported: 'publish.gpsUnsupported',
    }
    uni.showToast({
      title: t(reasonKey[result.reason] || 'publish.gpsUnknownError'),
      icon: 'none',
      duration: 2500,
    })
    return
  }
  form.location = result.location
}

function onSpotChipTap(spot: CampusSpot) {
  const label = spotLabel(spot)
  form.location = label
}

async function onSubmit() {
  // Acquire before the first await (including auth readiness and the high-price
  // confirmation modal). Two rapid taps must never enter parallel upload or
  // create flows while the visible submitting state is still false.
  if (submitEntryLocked) return
  submitEntryLocked = true
  const operationEpoch = ++publishOperationEpoch
  const operationShowVersion = publishShowVersion
  const entryAccountToken = publishPageAccountToken
  const operationStillCurrent = () => (
    operationEpoch === publishOperationEpoch
    && operationShowVersion === publishShowVersion
    && publishPageMounted
    && publishVisible
    && publishReady.value
    && entryAccountToken !== null
    && publishPageAccountToken === entryAccountToken
    && isAccountRequestCurrent(entryAccountToken)
  )
  try {
  await awaitAuthReady()
  if (!operationStillCurrent()) return
  if (!requireAuth()) return
  // Required-field hard blocks — order matches form visual top-to-bottom flow
  if (!form.title.trim()) { uni.showToast({ title: t('publish.needTitle'), icon: 'none' }); return }
  // A wanted post relaxes price (budget optional → 0) and condition (N/A).
  const rawPrice = form.price.trim()
  const price = rawPrice === '' && form.listingType === 'wanted'
    ? 0
    : /^\d+(?:\.\d{1,2})?$/.test(rawPrice)
      ? Number(rawPrice)
      : Number.NaN
  if (!Number.isFinite(price) || price < 0) { uni.showToast({ title: t('publish.needPrice'), icon: 'none' }); return }
  if (!form.category) { uni.showToast({ title: t('publish.needCategory'), icon: 'none' }); return }
  if (form.listingType !== 'wanted' && !form.condition) { uni.showToast({ title: t('publish.needCondition'), icon: 'none' }); return }
  // Soft gating — price advisory uses modal confirm so user must ack but can continue.
  // 100,000 is a soft ceiling; 99% of trips above it are unit/decimal mistakes,
  // and user actively confirming is cheap insurance.
  if (price > 100000) {
    const confirmed = await new Promise<boolean>((resolve) => {
      uni.showModal({
        title: t('publish.priceTooHigh'),
        content: t('publish.priceTooHighBody'),
        confirmText: t('publish.priceTooHighConfirm'),
        cancelText: t('publish.priceTooHighCancel'),
        confirmColor: DIALOG_WARN,
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed || !operationStillCurrent()) return
  }

  if (!operationStillCurrent() || !entryAccountToken) {
    uni.showToast({ title: t('publish.fail'), icon: 'none' })
    return
  }
  const submitAccountToken = entryAccountToken

  submitting.value = true
  uploadProgress.value = 0
  let uploadedForCleanup: string[] = []
  let uploadAccountToken: UploadAccountToken | null = null
  let itemCreated = false
  try {
    const existing: string[] = []
    const toUpload: string[] = []
    for (const img of imageList.value) {
      if (img.startsWith('http')) existing.push(img)
      else toUpload.push(img)
    }
    let uploaded: string[] = []
    let uploadedDims: Array<{ w: number; h: number }> = []
    if (toUpload.length > 0) {
      try {
        const res = await uploadImagesWithDims(toUpload, {
          entryPoint: 'publish',
          accountToken: submitAccountToken,
        })
        uploaded = res.urls
        uploadedForCleanup = [...res.urls]
        uploadedDims = res.dims
        uploadAccountToken = res.accountToken
        if (
          res.accountToken.userId !== submitAccountToken.userId
          || res.accountToken.generation !== submitAccountToken.generation
          || !isAccountRequestCurrent(submitAccountToken)
        ) {
          throw mutationOutcomeError(new Error('Account changed during item upload'), 'not_committed')
        }
      } catch (upErr: any) {
        if (upErr?.heic === true) throw new Error(t('heic.unsupported'))
        throw new Error(upErr?.message || t('publish.uploadFailed'))
      }
      uploadProgress.value = 100
      if (uploaded.length === 0) {
        throw new Error(t('publish.uploadFailed'))
      }
      /* Diagnostic: surface partial upload failures that would otherwise be
         swallowed. uploadImagesWithDims() catches per-file errors and skips
         them, so uploaded.length < toUpload.length means some images were lost. */
      if (uploaded.length < toUpload.length) {
        if (!operationStillCurrent()) {
          throw mutationOutcomeError(new Error('Account changed during item upload'), 'not_committed')
        }
        uni.showToast({
          title: t('publish.imagesUploaded', { done: uploaded.length, total: toUpload.length }),
          icon: 'none',
          duration: 4000,
        })
      }
    }

    const images = [...existing, ...uploaded]
    /*
     * image_dimensions covers ONLY the newly uploaded images in this
     * call; pre-existing URLs (edit flow) don't get dimensions because
     * we can't reliably measure arbitrary remote URLs client-side. The
     * frontend still falls back to @load for those, so leaving their
     * slots absent is correct. We use `null` pads rather than zeros so
     * consumers can distinguish "unknown" from "0×0".
     */
    const existingDims: Array<{ w: number; h: number } | null> = existing.map(() => null)
    const finalDims = [...existingDims, ...uploadedDims].filter(
      (d): d is { w: number; h: number } => !!d && d.w > 0 && d.h > 0,
    )

    const trimmedTitle = form.title.trim()
    const trimmedDesc = form.description.trim()
    // Author-language is today's UI locale. Settings is the only place a
    // user can change it, so this is a correct proxy for "what language
    // did they think in while writing this listing".
    const sourceLang = lang.value

    const payload = {
      title: trimmedTitle,
      description: trimmedDesc,
      // Wanted posts: empty budget → 0 (reads as "open budget"); condition is
      // N/A so fall back to the column default so the NOT NULL insert succeeds.
      price,
      category: form.category as ItemCategory,
      condition: (form.condition || 'good') as ItemCondition,
      listing_type: form.listingType,
      location: form.location || '',
      images,
      image_dimensions: finalDims,
      // Seed the i18n maps with the original text in the source lang.
      // The async translation pass below adds the other language(s).
      title_i18n: trimmedTitle ? { [sourceLang]: trimmedTitle } : null,
      description_i18n: trimmedDesc ? { [sourceLang]: trimmedDesc } : null,
      source_lang: sourceLang,
      negotiable: form.negotiable,
    }

    const newItem = await createItem(payload, {
      accountToken: submitAccountToken,
    })
    if (!operationStillCurrent()) {
      throw mutationOutcomeError(new Error('Account changed after item create'), 'committed')
    }
    itemCreated = true
    uploadProgress.value = 0
    resetForm()
    clearDraft()
    uni.showToast({ title: t('publish.success'), icon: 'success' })
    scheduleBilingualFill(
      newItem.id,
      trimmedTitle,
      trimmedDesc,
      sourceLang,
      newItem.updated_at,
      submitAccountToken,
    )
    setTimeout(() => {
      if (operationStillCurrent()) {
        uni.navigateTo({ url: `/pages/detail/index?id=${newItem.id}` })
      }
    }, 1000)
  } catch (error: any) {
    if (!itemCreated && shouldCompensateMutationFailure(error) && uploadedForCleanup.length > 0) {
      try {
        await removeOwnedItemImages(uploadedForCleanup, {
          ownerUserId: uploadAccountToken?.userId,
          telemetrySource: 'publish.upload_cleanup',
        })
      } catch (cleanupError) {
        captureException(cleanupError, { tags: { source: 'publish.upload_cleanup' }, level: 'warning' })
      }
    } else if (!itemCreated && mutationCommitState(error) === 'unknown' && uploadedForCleanup.length > 0) {
      // The request may have committed before its response was lost. Deleting
      // now could break the authoritative row, so retain for reconciliation/GC.
      captureException(error, {
        tags: { source: 'publish.create_commit_unknown', orphan_risk: 'true' },
        extra: { objectCount: uploadedForCleanup.length },
        level: 'warning',
      })
    }
    if (!operationStillCurrent()) return
    // Backend createItem/updateItem in useItems.ts throw 'Invalid price' when
    // input.price > 1,000,000 (the hard cap, defense-in-depth above the 100k
    // soft ceiling enforced by the modal earlier in onSubmit). Translate to a
    // user-friendly toast that names the actual limit so users know what to do
    // — the raw 'Invalid price' string is too terse and doesn't tell the user
    // whether they hit a min, max, or some other constraint.
    if (error?.message === 'Invalid price') {
      uni.showToast({ title: t('publish.priceExceedsLimit'), icon: 'none', duration: 3000 })
      return
    }
    captureException(error, { tags: { source: 'publish.create' }, level: 'error' })
    uni.showToast({
      title: friendlyErrorMessage(error, lang.value as 'en' | 'zh') || t('publish.fail'),
      icon: 'none',
      duration: 3000,
    })
  } finally {
    if (operationEpoch === publishOperationEpoch) {
      submitting.value = false
      uploadProgress.value = 0
    }
  }
  } finally {
    if (operationEpoch === publishOperationEpoch) submitEntryLocked = false
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh; background: var(--bg-subtle);
  /* Clear the solid submit footer (70px) sitting flush on the 62px tab bar +
     ~14px breathing, plus safe-area so the last field isn't hidden on notch
     devices. */
  padding-bottom: calc(146px + env(safe-area-inset-bottom, 0px)); max-width: 480px; margin: 0 auto;
}

.auth-check {
  min-height: calc(100vh - 146px);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; color: var(--text-subtle);
}
.auth-check-spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--line-soft); border-top-color: var(--accent-primary);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
.auth-check-text { font-size: 13px; color: var(--text-subtle); }

/* ========== Header ========== */
.page-header {
  padding: 11px 16px;
  padding-top: calc(11px + var(--mp-status-bar, env(safe-area-inset-top, 0px)));
  /* fill + blur + bottom hairline come from .u-glass + .u-glass--hair-b */
  position: sticky; top: 0; z-index: 50;
}
.ph-title { font-size: 17px; font-weight: 700; color: var(--text-primary); }

/* P1 §1.6: soften page-title color in dark — see commentary in
 * profile/index.vue. Pure cream-on-charcoal hits ~14:1 contrast on
 * the deepened dark canvas; --ink-strong (0.92α) drops to ~12:1
 * while staying above AA. Light unchanged. */
/* #ifdef H5 */
[data-theme="dark"] .ph-title { color: var(--ink-strong); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .ph-title { color: var(--ink-strong); }
}
/* #endif */

@media (min-width: 768px) { .page-header { display: none; } }

/* ========== Form ========== */
.form { background: var(--bg-elev-1); }
/* 出售 / 求购 segmented toggle at the top of the form. */
.listing-type-seg {
  display: flex; gap: 8px; padding: 14px 16px 0;
}
.lt-seg {
  flex: 1; height: 38px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-md);
  background: var(--surface-alt); cursor: pointer;
  .lt-seg-label { font-size: 14px; font-weight: 600; color: var(--ink-quiet); }
  &.on {
    background: var(--brand-soft);
    .lt-seg-label { color: var(--brand-deep); }
  }
}
.image-section { padding: 16px; }
.image-list { display: flex; flex-wrap: wrap; gap: 9px; }
.image-item { position: relative; width: 96px; height: 96px; }
.preview-image { width: 100%; height: 100%; border-radius: 9px; object-fit: cover; }
.remove-btn {
  position: absolute; top: -5px; right: -5px;
  width: 32px; height: 32px; background: rgba(0,0,0,0.62); backdrop-filter: blur(4px);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.cover-tag {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(4px);
  border-radius: 0 0 9px 9px; text-align: center; padding: 2px 0;
  .cover-tag-label { font-size: 10px; color: #fff; font-weight: 500; }
}
.image-add {
  width: 96px; height: 96px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px; cursor: pointer;
  transition: background var(--dur-1, 120ms) var(--ease-std, ease);
  &:active { background: var(--paper-2); }
}
.add-text { font-size: 11px; color: var(--text-subtle); }
.add-count { font-size: 10px; color: var(--text-subtle); margin-top: 2px; font-variant-numeric: tabular-nums; }
.image-tip { font-size: 12px; color: var(--text-subtle); margin-top: 12px; display: block; line-height: 1.5; }

/* ========== Upload Progress ========== */
.upload-bar {
  position: relative; height: 28px; margin: 0 16px 8px;
  background: var(--bg-subtle); border-radius: 6px; overflow: hidden;
}
.upload-fill {
  position: absolute; top: 0; bottom: 0; left: 0;
  background: var(--line-hair);
  transition: width 0.3s ease;
}
.upload-text {
  position: relative; z-index: 1;
  font-size: 12px; color: var(--text-secondary); font-weight: 500;
  line-height: 28px; padding-left: 10px;
}

/* ========== Form Groups ========== */
.form-group {
  padding: 13px 16px;
  border-bottom: 0.5px solid var(--line-hair);
  &.row { display: flex; align-items: center; }
}
/* Labels need a min-width so short Chinese labels (分类 / 成色 / 价格) line
   up vertically across rows, but a fixed width breaks longer English labels
   (Category / Condition / Location). min-width + flex-shrink: 0 + padding-right
   gives both: ZH locks to the 64px floor, EN grows past it without wrapping. */
.label { font-size: 15px; color: var(--text-primary); min-width: 64px; flex-shrink: 0; font-weight: 500; padding-right: 8px; }
.form-input { font-size: 15px; width: 100%; color: var(--text-primary); }
.title-input { font-size: 17px; font-weight: 600; }
.form-textarea { width: 100%; height: 110px; font-size: 15px; line-height: 1.6; color: var(--text-primary); overflow-y: auto; word-break: normal; overflow-wrap: break-word; }
.price-input {
  display: flex; align-items: center; flex: 1;
  .currency { font-size: 17px; color: var(--text-primary); font-weight: 700; margin-right: 4px; }
}
.flex-input { flex: 1; }
.char-count { display: block; text-align: right; font-size: 11px; color: var(--text-subtle); margin-top: 4px; }
.price-hint { padding: 0 16px 8px; font-size: 12px; color: var(--text-muted); }

.field-header {
  display: flex; align-items: center; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.field-value {
  flex: 1; text-align: right; font-size: 15px; color: var(--text-primary);
  &.placeholder { color: var(--text-subtle); }
}
.chevron {
  display: flex; margin-left: 8px;
  transition: transform 0.2s;
  &.open { transform: rotate(90deg); }
}

.pill-grid {
  display: flex; flex-wrap: wrap; gap: 8px;
  padding-top: 12px; animation: fadeIn 0.15s ease;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.sel-pill {
  padding: 7px 14px; border-radius: 8px; font-size: 13px;
  background: var(--bg-subtle); color: var(--text-secondary); cursor: pointer;
  transition: all 0.12s; font-weight: 500;
  position: relative;
  &.active {
    background: var(--accent-primary); color: #fff;
    padding-right: 26px;
  }
  &:active { transform: scale(0.96); }
}
.sel-pill-clear { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); opacity: 0.72; }
.cond-pill {
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  padding: 8px 14px;
  min-width: 112px;
}
.cp-name { font-size: 13px; font-weight: 600; }
.cp-hint { font-size: 10px; opacity: 0.7; line-height: 1.25; }
.cond-pill.active .cp-hint { color: rgba(255,255,255,0.8); }

/* ========== Location ========== */
.spot-row {
  white-space: nowrap;
  padding: 0 0 8px 0;
  margin-top: 4px;
}
.spot-chip {
  display: inline-block;
  padding: 6px 12px;
  margin-right: 8px;
  background: var(--bg-subtle);
  color: var(--text-primary);
  font-size: 13px;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.15s;
  &:active { background: var(--bg-inset); }
  &.active { background: var(--accent-primary); color: #fff; }
}
.locate-btn {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 12px 14px;
  /* Align this secondary action with the 16px form gutter. A full-bleed
     outlined control looked accidentally clipped on narrow Safari screens. */
  margin: 10px 16px 0;
  background: var(--bg-subtle);
  border: 1px solid var(--border-strong, var(--bg-inset));
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;

  &:active {
    background: var(--bg-inset);
  }

  &--detecting {
    pointer-events: none;
    opacity: 0.75;
  }
}

.locate-btn-icon {
  width: 18px;
  height: 18px;
  display: block;
  flex-shrink: 0;
}

.locate-btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--bg-inset);
  border-top-color: var(--text-secondary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.locate-btn-text {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ========== Toggle ========== */
.toggle-row { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.toggle-hint { flex: 1; font-size: 13px; color: var(--text-subtle); text-align: right; margin-right: 10px; }
.toggle {
  width: 44px; height: 26px; border-radius: 13px;
  background: var(--border-strong);
  position: relative; transition: background var(--dur-2, 220ms) var(--ease-std, ease);
  flex-shrink: 0;
  &.on { background: var(--success); }
}
.toggle-knob {
  width: 22px; height: 22px; border-radius: 50%; background: var(--bg-elev-1);
  position: absolute; top: 2px; left: 2px; transition: transform 0.25s;
  box-shadow: var(--shadow-soft);
}
.toggle.on .toggle-knob { transform: translateX(18px); }

/* ========== Submit ========== */
.submit-bar {
  /* QA6 r4 (#9后续/leak): was a translucent .u-glass bar floating 8px above the
     tab bar — the lower form fields (Location, campus chips, "use current
     location") bled THROUGH the 60% glass and PEEKED through the 8px gap. Now a
     SOLID, opaque footer sitting flush on top of the solid 62px tab bar (no gap,
     no translucency) so nothing leaks. A top hairline keeps the two bars
     visually distinct; the 9px padding keeps the red CTA off the nav row. */
  position: fixed; bottom: calc(62px + env(safe-area-inset-bottom, 0px));
  left: 50%; transform: translateX(-50%);
  width: 100%; max-width: 480px; padding: 9px 16px;
  background: var(--surface);
  border-top: 0.5px solid var(--border-hair);
  z-index: 40;
}
@media (min-width: 768px) {
  /* Center the fixed submit bar under the 720px form column: span the
     area right of the rail, then margin:auto caps it at the form width. */
  .submit-bar { bottom: 0; left: var(--sidebar-w); right: 0; width: auto; max-width: 720px; margin-left: auto; margin-right: auto; transform: none; }
  /* The base .page rule centers a 480px column for phone; on desktop the
     .has-sidebar rail already reserves the left edge via padding-left, so
     let the page fill the remaining column and center the form instead. */
  .page { max-width: none; margin: 0; }
  .form { max-width: 720px; margin-left: auto; margin-right: auto; }
}
</style>
