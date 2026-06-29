<template>
  <view class="admin">
    <view class="admin-header">
      <text class="admin-title">{{ t('admin.title') }}</text>
      <view v-if="unlocked && currentAdmin" class="admin-whoami">
        <text class="admin-whoami-label">{{ currentAdmin.label }}</text>
        <text v-if="currentAdmin.detail" class="admin-whoami-detail">{{ currentAdmin.detail }}</text>
      </view>
      <view class="admin-lang" role="button" :aria-label="t('a11y.langToggle')" @click="toggleLang">
        <text>{{ lang === 'zh' ? 'EN' : '中' }}</text>
      </view>
      <view v-if="unlocked" class="admin-logout" @click="onLogout">{{ t('admin.signOut') }}</view>
    </view>

    <view v-if="!unlocked" class="gate">
      <text class="gate-label">{{ t('admin.gateLabel') }}</text>
      <input
        v-model="keyInput"
        type="password"
        :placeholder="'ADMIN_API_KEY'"
        class="gate-input"
        confirm-type="done"
        @confirm="onUnlock"
      />
      <view :class="['gate-btn', { disabled: !keyInput || checking }]" @click="onUnlock">
        <text>{{ checking ? t('admin.checking') : t('admin.unlock') }}</text>
      </view>
      <text v-if="gateError" class="gate-error">{{ gateError }}</text>
      <text class="gate-hint">{{ t('admin.gateHint') }}</text>
    </view>

    <view v-else class="dash">
      <view class="stats-row">
        <view class="stat">
          <text class="stat-n">{{ stats?.active_suspensions ?? '—' }}</text>
          <text class="stat-l">{{ t('admin.statActiveBans') }}</text>
        </view>
        <view class="stat">
          <text class="stat-n">{{ stats?.pending_reports ?? '—' }}</text>
          <text class="stat-l">{{ t('admin.statPendingReports') }}</text>
        </view>
        <view class="stat">
          <text class="stat-n">{{ stats?.pending_appeals ?? '—' }}</text>
          <text class="stat-l">{{ t('admin.statOpenAppeals') }}</text>
        </view>
        <view class="stat">
          <text class="stat-n">{{ stats?.shadow_banned ?? '—' }}</text>
          <text class="stat-l">{{ t('admin.statShadowBanned') }}</text>
        </view>
      </view>

      <view class="tabs">
        <view
          v-for="tab in tabList"
          :key="tab.id"
          :class="['tab', { active: activeTab === tab.id }]"
          @click="setTab(tab.id)"
        >
          <text>{{ t(tab.labelKey) }}</text>
        </view>
      </view>

      <view v-if="loading" class="dash-loading">
        <text>{{ t('admin.loading') }}</text>
      </view>

      <view v-else-if="activeTab === 'reports'" class="list u-stagger">
        <view v-if="reportGroups.length === 0" class="empty"><text>{{ t('admin.emptyReports') }}</text></view>
        <view v-for="g in reportGroups" :key="g.target_type + ':' + g.target_id" class="card">
          <view class="card-head">
            <text class="card-title">{{ g.target_type }} · {{ g.last_reason }}</text>
            <text class="pill pill-count">{{ t('admin.reportGroupCount', { reports: g.report_count, people: g.reporter_count }) }}</text>
          </view>
          <text class="card-meta">{{ t('admin.reportGroupMeta', { pending: g.pending_count, name: g.last_reporter_nickname || '—' }) }}</text>
          <text v-if="g.last_note" class="card-note">“{{ g.last_note }}”</text>
          <text class="card-time">{{ t('admin.reportGroupAge', { time: fmtTime(g.first_created_at) }) }}</text>
          <view class="card-actions">
            <view class="mini-btn" @click="openReportById(g.last_report_id)">{{ t('admin.open') }}</view>
            <view v-if="g.pending_count > 0" class="mini-btn primary" @click="resolveTargetReports(g, 'resolved')">{{ t('admin.resolveAll') }}</view>
            <view v-if="g.pending_count > 0" class="mini-btn danger" @click="resolveTargetReports(g, 'dismissed')">{{ t('admin.dismissAll') }}</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'suspensions'" class="list">
        <view class="search-row">
          <input
            v-model="suspensionQuery"
            class="search-input"
            :placeholder="t('admin.suspFilterPh')"
          />
          <text v-if="suspensionQuery" class="search-clear" @click="suspensionQuery = ''">{{ t('admin.clear') }}</text>
        </view>
        <view v-if="filteredSuspensions.length === 0" class="empty">
          <text>{{ suspensionQuery ? t('admin.noMatches') : t('admin.emptySuspensions') }}</text>
        </view>
        <view v-for="s in filteredSuspensions" :key="s.id" class="card u-rise">
          <view class="card-head">
            <image :src="s.profile_avatar_url || defaultAvatarSrc" :alt="s.profile_nickname || 'avatar'" class="mini-avatar" mode="aspectFill" />
            <text class="card-title">{{ s.profile_nickname || s.profile_id }}</text>
            <text :class="['pill', 'level-' + s.level]">L{{ s.level }}</text>
            <text v-if="s.lifted_at" class="pill pill-lifted">{{ t('admin.pillLifted') }}</text>
            <text v-else-if="isExpired(s.ends_at)" class="pill pill-expired">{{ t('admin.pillExpired') }}</text>
            <text v-else class="pill pill-active">{{ t('admin.pillActive') }}</text>
          </view>
          <text class="card-meta">{{ s.reason }}</text>
          <text class="card-time">
            {{ t('admin.startedEnds', { start: fmtTime(s.started_at), end: s.ends_at ? fmtTime(s.ends_at) : t('admin.permanent') }) }}
          </text>
          <text class="card-audit">
            {{ t('admin.issuedByName', { name: s.issued_by_nickname || t('admin.system') }) }}<text v-if="s.lifted_by_nickname"> · {{ t('admin.liftedByInline', { name: s.lifted_by_nickname }) }}</text>
          </text>
          <text v-if="s.has_appeal" class="card-appeal-flag">{{ t('admin.appealFiled') }}</text>
          <view class="card-actions">
            <view class="mini-btn" @click="openSuspension(s)">{{ t('admin.open') }}</view>
            <view class="mini-btn" @click="openUser(s.profile_id)">{{ t('admin.openProfile') }}</view>
            <view v-if="!s.lifted_at" class="mini-btn primary" @click="onLiftSuspension(s)">{{ t('admin.lift') }}</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'appeals'" class="list u-stagger">
        <view v-if="appeals.length === 0" class="empty"><text>{{ t('admin.emptyAppeals') }}</text></view>
        <view v-for="a in appeals" :key="a.id" class="card">
          <view class="card-head">
            <image :src="a.profile_avatar_url || defaultAvatarSrc" :alt="a.profile_nickname || 'avatar'" class="mini-avatar" mode="aspectFill" />
            <text class="card-title">{{ a.profile_nickname || a.profile_id }}</text>
            <text :class="['pill', 'level-' + a.level]">L{{ a.level }}</text>
          </view>
          <text class="card-meta">{{ t('admin.appealOriginal', { reason: a.reason }) }}</text>
          <text class="card-appeal">“{{ a.appeal_note }}”</text>
          <text class="card-time">
            {{ t('admin.filedEnds', { filed: fmtTime(a.created_at), end: a.ends_at ? fmtTime(a.ends_at) : t('admin.permanent') }) }}
          </text>
          <view class="card-actions">
            <view class="mini-btn primary" @click="onLiftSuspension(a)">{{ t('admin.liftAccept') }}</view>
            <view class="mini-btn" @click="openSuspension(a)">{{ t('admin.details') }}</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'warnings'" class="list u-stagger">
        <view v-if="warnings.length === 0" class="empty"><text>{{ t('admin.emptyWarnings') }}</text></view>
        <view v-for="w in warnings" :key="w.profile_id" class="card">
          <view class="card-head">
            <image :src="w.avatar_url || defaultAvatarSrc" :alt="w.nickname || 'avatar'" class="mini-avatar" mode="aspectFill" />
            <text class="card-title">{{ w.nickname || w.profile_id }}</text>
            <text class="pill pill-trust">{{ t('admin.trust', { score: w.trust_score }) }}</text>
            <text v-if="w.shadow_banned" class="pill pill-shadow">{{ t('admin.pillShadow') }}</text>
            <text v-if="w.suspension_level > 0" :class="['pill', 'level-' + w.suspension_level]">L{{ w.suspension_level }}</text>
          </view>
          <text class="card-meta">{{ t('admin.warningsCount', { n: w.warning_count }) }}</text>
          <view class="card-actions">
            <view class="mini-btn" @click="openUser(w.profile_id)">{{ t('admin.openProfile') }}</view>
            <view class="mini-btn" @click="onBanPrompt(w.profile_id, w.nickname)">{{ t('admin.applyBan') }}</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'audit'" class="list u-stagger">
        <view v-if="auditLog.length === 0" class="empty"><text>{{ t('admin.emptyAudit') }}</text></view>
        <view v-for="r in auditLog" :key="r.id" class="audit-row">
          <text :class="['audit-kind', 'kind-' + r.event_kind]">{{ r.event_kind }}</text>
          <text class="audit-msg">{{ fmtAuditEvent(r) }}</text>
          <text class="audit-time">{{ fmtTime(r.created_at) }}</text>
        </view>
      </view>
    </view>

    <view v-if="detailOpen" class="detail-mask" @click="detailOpen = false"></view>
    <view :class="['detail-sheet', { open: detailOpen }]">
      <view class="detail-head">
        <text class="detail-title">{{ detailTitle }}</text>
          <view class="detail-close" role="button" :aria-label="t('a11y.close')" @click="detailOpen = false"><text>×</text></view>
      </view>
      <scroll-view class="detail-body" scroll-y>
        <view v-if="detailLoading" class="empty"><text>{{ t('admin.loading') }}</text></view>
        <view v-else-if="detailKind === 'report' && detailRow">
          <text class="d-row"><text class="d-key">{{ t('admin.dReporter') }}</text>{{ detailRow.reporter_nickname }} ({{ detailRow.reporter_email || '—' }})</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dTarget') }}</text>{{ detailRow.target_type }} {{ detailRow.target_id }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dAuthor') }}</text>{{ detailRow.target_user_nickname || detailRow.target_user_id || '—' }}</text>
          <text v-if="detailRow.target_preview" class="d-row d-preview">“{{ detailRow.target_preview }}”</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dReason') }}</text>{{ detailRow.reason }}</text>
          <text v-if="detailRow.note" class="d-row"><text class="d-key">{{ t('admin.dNote') }}</text>{{ detailRow.note }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dStatus') }}</text>{{ detailRow.status }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dFiled') }}</text>{{ fmtTime(detailRow.created_at) }}</text>
          <view class="d-actions">
            <view v-if="canOpenTarget(detailRow)" class="mini-btn" @click="openTarget(detailRow)">{{ t('admin.openTarget') }}</view>
            <view v-if="canTakedown(detailRow)" class="mini-btn danger" @click="onTakedownContent(detailRow)">{{ t('admin.takedownContent') }}</view>
            <view v-if="detailRow.target_user_id" class="mini-btn" @click="openUser(detailRow.target_user_id)">{{ t('admin.openAuthorProfile') }}</view>
            <view v-if="detailRow.target_user_id" class="mini-btn danger" @click="onBanPrompt(detailRow.target_user_id, detailRow.target_user_nickname)">{{ t('admin.banAuthor') }}</view>
          </view>
        </view>
        <view v-else-if="detailKind === 'suspension' && detailRow">
          <text class="d-row"><text class="d-key">{{ t('admin.dUser') }}</text>{{ detailRow.profile_nickname }} ({{ detailRow.profile_email || '—' }})</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dLevel') }}</text>L{{ detailRow.level }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dCategory') }}</text>{{ detailRow.category }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dReason') }}</text>{{ detailRow.reason }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dIssuedBy') }}</text>{{ detailRow.issued_by_nickname || t('admin.system') }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dStarted') }}</text>{{ fmtTime(detailRow.started_at) }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dEnds') }}</text>{{ detailRow.ends_at ? fmtTime(detailRow.ends_at) : t('admin.permanent') }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dTrust') }}</text>{{ detailRow.profile_trust_score }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dWarnings') }}</text>{{ detailRow.profile_warning_count }}</text>
          <text v-if="detailRow.appeal_note" class="d-row d-appeal">{{ t('admin.dAppeal') }}“{{ detailRow.appeal_note }}”</text>
          <text v-if="detailRow.lifted_at" class="d-row">
            <text class="d-key">{{ t('admin.dLifted') }}</text>{{ fmtTime(detailRow.lifted_at) }} {{ t('admin.byName', { name: detailRow.lifted_by_nickname || t('admin.system') }) }} ({{ detailRow.lift_reason || '—' }})
          </text>
          <view class="d-actions">
            <view class="mini-btn" @click="openUser(detailRow.profile_id)">{{ t('admin.openProfile') }}</view>
            <view v-if="!detailRow.lifted_at" class="mini-btn primary" @click="onLiftSuspension(detailRow)">{{ t('admin.lift') }}</view>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { platformFetch } from '../../composables/useSupabase'
import { BASE_URL } from '../../config/runtime'
import { useTheme } from '../../composables/useTheme'
import { useI18n } from '../../composables/useI18n'

const { t, lang, toggleLang } = useI18n()

type TabId = 'reports' | 'suspensions' | 'appeals' | 'warnings' | 'audit'

interface ReportRow {
  id: string; reporter_id: string; reporter_nickname: string
  target_type: string; target_id: string
  reason: string; note: string; status: string; created_at: string
}
interface ReportGroup {
  target_type: string; target_id: string
  report_count: number; pending_count: number; reporter_count: number
  last_reason: string; last_note: string; last_reporter_nickname: string; last_status: string
  first_created_at: string; last_created_at: string; last_report_id: string
}
interface SuspensionRow {
  id: string; profile_id: string; profile_nickname: string; profile_avatar_url: string
  level: number; reason: string; category: string
  started_at: string; ends_at: string | null; lifted_at: string | null
  has_appeal: boolean; appeal_note: string | null; created_at: string
  issued_by: string | null; issued_by_nickname: string | null
  lifted_by: string | null; lifted_by_nickname: string | null
}
interface AppealRow extends SuspensionRow { /* same shape */ }
interface WarningRow {
  profile_id: string; nickname: string; avatar_url: string
  trust_score: number; warning_count: number; shadow_banned: boolean
  suspension_level: number; suspended_until: string | null
}
interface StatsRow {
  active_suspensions: number; pending_reports: number
  pending_appeals: number; shadow_banned: number
}

const { isDark } = useTheme()
const defaultAvatarSrc = computed(() =>
  isDark.value ? '/static/default-avatar-dark.svg' : '/static/default-avatar.svg'
)

const STORAGE_KEY = 'admin_api_key_v1'
const adminKey = ref('')
const keyInput = ref('')
const unlocked = ref(false)
const checking = ref(false)
const gateError = ref('')

/*
 * Logged-in-admin display in the dashboard header.
 *
 * Source: GET /api/admin?resource=whoami after successful unlock.
 * Per-admin tokens (migration 036) carry an admin_name + admin_email
 * from when they were minted; the legacy shared-key path returns nulls
 * because there's no identity attached to the shared key. Display rules:
 *   1. profiles.nickname (passed as admin_name) — preferred
 *   2. email prefix (before the @) — fallback when name missing
 *   3. literal '管理员' / 'Admin' — when both missing (legacy key)
 */
interface WhoAmI {
  admin_id: string | null
  admin_name: string | null
  admin_email: string | null
  source: string | null
}
const whoami = ref<WhoAmI | null>(null)
const currentAdmin = computed(() => {
  if (!whoami.value) return null
  const name = whoami.value.admin_name?.trim() || ''
  const email = whoami.value.admin_email?.trim() || ''
  if (name) {
    return { label: name, detail: email || null }
  }
  if (email) {
    const prefix = email.split('@')[0]
    return { label: prefix, detail: email }
  }
  return { label: t('admin.legacyAdmin'), detail: t('admin.legacyKey') }
})

const tabList: Array<{ id: TabId; labelKey: string }> = [
  { id: 'reports',     labelKey: 'admin.tabReports' },
  { id: 'suspensions', labelKey: 'admin.tabSuspensions' },
  { id: 'appeals',     labelKey: 'admin.tabAppeals' },
  { id: 'warnings',    labelKey: 'admin.tabWarnings' },
  { id: 'audit',       labelKey: 'admin.tabAudit' },
]
const activeTab = ref<TabId>('reports')

interface AuditRow {
  id: number
  event_kind: string
  actor_id: string | null
  actor_nickname: string | null
  target_id: string | null
  target_nickname: string | null
  details: Record<string, any>
  created_at: string
}

const stats = ref<StatsRow | null>(null)
const loading = ref(false)
const reports = ref<ReportRow[]>([])
const reportGroups = ref<ReportGroup[]>([])
const suspensions = ref<SuspensionRow[]>([])
const auditLog = ref<AuditRow[]>([])
const suspensionQuery = ref('')
const filteredSuspensions = computed(() => {
  const q = suspensionQuery.value.trim().toLowerCase()
  if (!q) return suspensions.value
  return suspensions.value.filter((s) => {
    const nick = (s.profile_nickname || '').toLowerCase()
    const reason = (s.reason || '').toLowerCase()
    return nick.includes(q) || reason.includes(q) || s.profile_id.toLowerCase().startsWith(q)
  })
})
const appeals = ref<AppealRow[]>([])
const warnings = ref<WarningRow[]>([])

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailKind = ref<'report' | 'suspension' | ''>('')
const detailRow = ref<any>(null)
const detailTitle = computed(() =>
  detailKind.value === 'report' ? t('admin.reportDetail') :
  detailKind.value === 'suspension' ? t('admin.suspensionDetail') : '')

function apiBase(): string {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin + '/api/admin'
  }
  // #endif
  return `${BASE_URL}/api/admin`
}

async function apiGet<T>(params: Record<string, string>): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const r = await platformFetch(`${apiBase()}?${qs}`, {
    method: 'GET',
    headers: { 'x-admin-key': adminKey.value },
  })
  if (r.status === 401) { onLogout(); throw new Error('unauthorized') }
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json?.error || `http_${r.status}`)
  return json.data as T
}

async function apiPost<T>(body: Record<string, any>): Promise<T> {
  const r = await platformFetch(apiBase(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey.value,
    },
    body: JSON.stringify(body),
  })
  if (r.status === 401) { onLogout(); throw new Error('unauthorized') }
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json?.error || `http_${r.status}`)
  return json as T
}

async function onUnlock() {
  if (!keyInput.value || checking.value) return
  checking.value = true
  gateError.value = ''
  adminKey.value = keyInput.value.trim()
  try {
    await apiGet<StatsRow>({ resource: 'stats' })
    uni.setStorageSync(STORAGE_KEY, adminKey.value)
    unlocked.value = true
    keyInput.value = ''
    await loadWhoAmI()
    await loadTab(activeTab.value)
    await loadStats()
  } catch (err: any) {
    gateError.value = err?.message === 'unauthorized'
      ? t('admin.errWrongKey')
      : (err?.message || t('admin.errUnlockFailed'))
    adminKey.value = ''
  } finally {
    checking.value = false
  }
}

async function loadWhoAmI() {
  try {
    whoami.value = await apiGet<WhoAmI>({ resource: 'whoami' })
  } catch {
    /* whoami is non-critical — failing to fetch shouldn't block the dashboard */
    whoami.value = null
  }
}

function onLogout() {
  adminKey.value = ''
  unlocked.value = false
  whoami.value = null
  stats.value = null
  reports.value = []
  reportGroups.value = []
  suspensions.value = []
  appeals.value = []
  warnings.value = []
  try { uni.removeStorageSync(STORAGE_KEY) } catch {}
}

async function loadStats() {
  try {
    stats.value = await apiGet<StatsRow>({ resource: 'stats' })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  }
}

async function loadTab(tab: TabId) {
  loading.value = true
  try {
    if (tab === 'reports') {
      reportGroups.value = await apiGet<ReportGroup[]>({ resource: 'reports_grouped', limit: '100' })
    } else if (tab === 'suspensions') {
      suspensions.value = await apiGet<SuspensionRow[]>({ resource: 'suspensions', limit: '100' })
    } else if (tab === 'appeals') {
      appeals.value = await apiGet<AppealRow[]>({ resource: 'appeals', limit: '100' })
    } else if (tab === 'warnings') {
      warnings.value = await apiGet<WarningRow[]>({ resource: 'warnings', limit: '100' })
    } else if (tab === 'audit') {
      auditLog.value = await apiGet<AuditRow[]>({ resource: 'audit', limit: '200' })
    }
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  } finally {
    loading.value = false
  }
}

function fmtAuditEvent(r: AuditRow): string {
  const actor = r.actor_nickname || (r.actor_id ? r.actor_id.slice(0, 8) : t('admin.system'))
  const target = r.target_nickname || (r.target_id ? r.target_id.slice(0, 8) : '—')
  switch (r.event_kind) {
    case 'ban_applied':
      return t('admin.auditBanApplied', { actor, target, level: r.details?.level ?? '', reason: r.details?.reason || '' })
    case 'suspension_lifted':
      return t('admin.auditLifted', { actor, target, reason: r.details?.reason || '' })
    case 'report_status_changed':
      return t('admin.auditReportStatus', { actor, id: r.target_id?.slice(0, 8) || '', from: r.details?.from ?? '', to: r.details?.to ?? '' })
    case 'content_takedown':
      return t('admin.auditTakedown', { actor, type: r.details?.target_type ?? '', target: r.target_id?.slice(0, 8) || '' })
    case 'actor_blocked':
      return t('admin.auditActorBlocked', { actor, table: r.details?.table ?? '', level: r.details?.level ?? '' })
    case 'admin_login':
      return t('admin.auditLogin')
    case 'admin_unauthorized':
      return t('admin.auditUnauthorized')
    default:
      return t('admin.auditDefault', { kind: r.event_kind, actor })
  }
}

async function setTab(id: TabId) {
  activeTab.value = id
  await loadTab(id)
}


async function openReportById(id: string) {
  detailKind.value = 'report'
  detailRow.value = null
  detailLoading.value = true
  detailOpen.value = true
  try {
    detailRow.value = await apiGet<any>({ resource: 'report', id })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  } finally {
    detailLoading.value = false
  }
}
function openReport(r: ReportRow) { return openReportById(r.id) }

/* gaps-2: close ALL pending sibling reports on a target in one action,
   behind a confirm (it can touch many rows). */
function resolveTargetReports(g: ReportGroup, status: 'resolved' | 'dismissed') {
  uni.showModal({
    title: status === 'resolved' ? t('admin.resolveAllConfirmTitle') : t('admin.dismissAllConfirmTitle'),
    content: t('admin.resolveAllConfirmBody', { n: g.pending_count }),
    confirmText: status === 'resolved' ? t('admin.resolve') : t('admin.dismiss'),
    success: async (r) => {
      if (!r.confirm) return
      try {
        await apiPost({
          action: 'resolve_target_reports',
          target_type: g.target_type,
          target_id: g.target_id,
          status,
        })
        uni.showToast({ title: t('admin.toastUpdated'), icon: 'success' })
        await loadTab('reports')
        await loadStats()
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('admin.toastUpdateFailed'), icon: 'none' })
      }
    },
  })
}

async function openSuspension(s: SuspensionRow | AppealRow) {
  detailKind.value = 'suspension'
  detailRow.value = null
  detailLoading.value = true
  detailOpen.value = true
  try {
    detailRow.value = await apiGet<any>({ resource: 'suspension', id: s.id })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  } finally {
    detailLoading.value = false
  }
}

/* Open-target navigation from report detail. Map each target_type to the
   page that renders it in the consumer app. comment + message have no
   dedicated viewer, so we degrade gracefully: comments jump to the parent
   post page, messages are labelled not-viewable (admin can still see the
   preview in the report detail sheet). */
function canOpenTarget(row: any): boolean {
  if (!row) return false
  if (row.target_type === 'item' || row.target_type === 'post') return !!row.target_id
  if (row.target_type === 'user') return !!row.target_id
  if (row.target_type === 'comment') return !!row.target_user_id
  return false
}

function openTarget(row: any) {
  detailOpen.value = false
  if (row.target_type === 'item') {
    uni.navigateTo({ url: `/pages/detail/index?id=${row.target_id}` })
  } else if (row.target_type === 'post') {
    uni.navigateTo({ url: `/pages/post/index?id=${row.target_id}` })
  } else if (row.target_type === 'user') {
    uni.navigateTo({ url: `/pages/seller/index?id=${row.target_id}` })
  } else if (row.target_type === 'comment' && row.target_user_id) {
    uni.showToast({
      title: t('admin.commentNoPage'),
      icon: 'none',
      duration: 2000,
    })
    uni.navigateTo({ url: `/pages/seller/index?id=${row.target_user_id}` })
  } else {
    uni.showToast({ title: t('admin.cannotOpenTarget'), icon: 'none' })
  }
}

/* Per-content takedown (gaps-1). Only item/post have a status soft-hide today
   (comments need a schema change — deferred), so the button is gated to those.
   Destructive → behind a confirm, like ban/lift. */
function canTakedown(row: any): boolean {
  return !!row && !!row.target_id && (row.target_type === 'item' || row.target_type === 'post' || row.target_type === 'comment')
}

function onTakedownContent(row: any) {
  uni.showModal({
    title: t('admin.takedownConfirmTitle'),
    content: t('admin.takedownConfirmBody'),
    confirmText: t('admin.takedownConfirm'),
    confirmColor: '#c0392b',
    success: async (r) => {
      if (!r.confirm) return
      try {
        await apiPost({
          action: 'takedown_content',
          target_type: row.target_type,
          target_id: row.target_id,
          reason: 'admin takedown',
        })
        uni.showToast({ title: t('admin.toastTakedownDone'), icon: 'success' })
        detailOpen.value = false
        await loadTab(activeTab.value)
        await loadStats()
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('admin.toastTakedownFailed'), icon: 'none' })
      }
    },
  })
}

function openUser(userId: string) {
  if (!userId) return
  detailOpen.value = false
  uni.navigateTo({ url: `/pages/seller/index?id=${userId}` })
}

function onLiftSuspension(s: { id: string }) {
  uni.showModal({
    title: t('admin.liftConfirmTitle'),
    editable: true,
    placeholderText: t('admin.liftReasonPh'),
    success: async (r) => {
      if (!r.confirm) return
      const reason = (r.content || '').trim() || t('admin.adminReview')
      try {
        await apiPost({ action: 'lift_suspension', suspension_id: s.id, reason })
        uni.showToast({ title: t('admin.toastLifted'), icon: 'success' })
        detailOpen.value = false
        await loadTab(activeTab.value)
        await loadStats()
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('admin.toastLiftFailed'), icon: 'none' })
      }
    },
  })
}

function onBanPrompt(targetId: string, nickname?: string) {
  uni.showActionSheet({
    itemList: [
      t('admin.banL1'),
      t('admin.banL2'),
      t('admin.banL3'),
      t('admin.banL4'),
      t('admin.banL5'),
    ],
    success: (a) => {
      const level = a.tapIndex + 1
      uni.showModal({
        title: t('admin.banConfirmTitle', { name: nickname || targetId }),
        editable: true,
        placeholderText: t('admin.banReasonPh'),
        success: async (r) => {
          if (!r.confirm) return
          const reason = (r.content || '').trim()
          if (!reason) {
            uni.showToast({ title: t('admin.reasonRequired'), icon: 'none' })
            return
          }
          try {
            await apiPost({
              action: 'apply_ban',
              target_id: targetId,
              level,
              reason,
              category: 'admin',
            })
            uni.showToast({ title: t('admin.toastBanApplied'), icon: 'success' })
            detailOpen.value = false
            await loadTab(activeTab.value)
            await loadStats()
          } catch (err: any) {
            uni.showToast({ title: err?.message || t('admin.toastBanFailed'), icon: 'none' })
          }
        },
      })
    },
  })
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function isExpired(endsAt: string | null): boolean {
  if (!endsAt) return false
  const t = new Date(endsAt).getTime()
  return !isNaN(t) && t < Date.now()
}

onMounted(async () => {
  let saved = ''
  try { saved = uni.getStorageSync(STORAGE_KEY) || '' } catch {}
  if (saved) {
    adminKey.value = saved
    try {
      await apiGet<StatsRow>({ resource: 'stats' })
      unlocked.value = true
      await loadWhoAmI()
      await loadTab(activeTab.value)
      await loadStats()
    } catch {
      onLogout()
    }
  }
})
</script>

<style lang="scss" scoped>
.admin {
  min-height: 100vh; background: var(--bg-subtle);
  padding: 20px 16px 40px; max-width: 960px; margin: 0 auto;
  font-family: var(--font-hei);
}
.admin-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 18px;
  gap: 12px;
}
.admin-title { font-size: 22px; font-weight: 700; color: var(--text-primary); flex-shrink: 0; }
.admin-whoami {
  flex: 1 1 auto; min-width: 0;
  display: flex; flex-direction: column; align-items: flex-end;
  text-align: right;
  margin-right: 4px;
}
.admin-whoami-label {
  font-size: 13px; font-weight: 600;
  color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;
}
.admin-whoami-detail {
  font-size: 11px; color: var(--text-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;
}
.admin-logout {
  font-size: 13px; color: var(--accent-danger); cursor: pointer;
  padding: 6px 10px; border-radius: 6px; flex-shrink: 0;
  &:active { background: var(--danger-soft); }
}
.admin-lang {
  font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer;
  padding: 6px 10px; border-radius: 6px; flex-shrink: 0;
  &:active { background: var(--bg-subtle); }
}

.gate {
  display: flex; flex-direction: column; gap: 12px;
  max-width: 360px; margin: 80px auto 0; padding: 22px;
  background: var(--bg-elev-1); border-radius: 14px; box-shadow: var(--shadow-soft);
}
.gate-label { font-size: 13px; color: var(--text-secondary); }
.gate-input {
  width: 100%; height: 42px; padding: 0 14px;
  background: var(--bg-subtle); border-radius: 8px; font-size: 15px; color: var(--text-primary);
  box-sizing: border-box;
}
.gate-btn {
  height: 42px; border-radius: 8px; background: var(--accent-primary);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  text { color: #fff; font-size: 15px; font-weight: 600; }
  &.disabled { opacity: 0.4; pointer-events: none; }
  &:active { opacity: 0.85; }
}
.gate-error { font-size: 12px; color: var(--accent-danger); text-align: center; }
.gate-hint { font-size: 11px; color: var(--text-muted); line-height: 1.5; margin-top: 4px; }

.dash { display: flex; flex-direction: column; gap: 16px; }
.stats-row { display: flex; gap: 10px; flex-wrap: wrap; }
.stat {
  flex: 1; min-width: 140px;
  padding: 14px 16px; background: var(--bg-elev-1); border-radius: 12px;
  display: flex; flex-direction: column; gap: 4px;
  box-shadow: var(--shadow-soft);
}
.stat-n { font-size: 22px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.stat-l { font-size: 12px; color: var(--text-secondary); }

.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tab {
  padding: 8px 14px; border-radius: 18px;
  background: var(--bg-elev-1); cursor: pointer;
  text { font-size: 13px; color: var(--text-secondary); font-weight: 500; }
  &.active { background: var(--accent-primary); text { color: #fff; } }
}

.dash-loading { padding: 40px 0; text-align: center; color: var(--text-muted); }

.list { display: flex; flex-direction: column; gap: 10px; }
.empty { padding: 40px 0; text-align: center; color: var(--text-faint); font-size: 13px; }

.card {
  padding: 14px; background: var(--bg-elev-1); border-radius: 10px;
  display: flex; flex-direction: column; gap: 6px;
}
.card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mini-avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--bg-inset); flex-shrink: 0; }
.card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.card-meta { font-size: 13px; color: var(--text-secondary); }
.card-note { font-size: 13px; color: var(--text-primary); font-style: italic; }
.card-appeal { font-size: 13px; color: var(--text-primary); background: var(--warning-soft); padding: 8px 10px; border-radius: 6px; border-left: 3px solid var(--accent-warn); }
.card-appeal-flag { font-size: 11px; color: var(--accent-warn); font-weight: 600; }
.card-time { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.card-audit { font-size: 11px; color: var(--text-muted); }
.audit-name { color: var(--text-secondary); font-weight: 600; }
.card-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

.search-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: var(--bg-elev-1); border-radius: 10px;
  margin-bottom: 4px;
}
.search-input {
  flex: 1; height: 28px; padding: 0 8px;
  background: var(--bg-subtle); border-radius: 6px;
  font-size: 13px; color: var(--text-primary);
}
.search-clear {
  font-size: 12px; color: var(--text-secondary); cursor: pointer;
  padding: 4px 8px;
  &:active { opacity: 0.6; }
}

.audit-row {
  display: flex; gap: 10px; align-items: baseline;
  padding: 10px 12px; background: var(--bg-elev-1); border-radius: 8px;
  font-size: 12px;
}
.audit-kind {
  flex-shrink: 0; font-size: 10px; font-weight: 700;
  padding: 2px 6px; border-radius: 10px;
  letter-spacing: 0.3px;
  background: var(--bg-subtle); color: var(--text-secondary);
}
.kind-ban_applied           { background: var(--danger-soft); color: var(--accent-danger); }
.kind-suspension_lifted     { background: var(--success-soft); color: var(--accent-good); }
.kind-report_status_changed { background: var(--campus-blue-soft); color: var(--campus-blue); }
.kind-actor_blocked         { background: var(--warning-soft); color: var(--accent-warn); }
.kind-admin_login           { background: var(--bg-subtle); color: var(--text-muted); }
.kind-admin_unauthorized    { background: var(--accent-primary); color: #fff; }
.audit-msg { flex: 1; color: var(--text-primary); word-break: break-all; }
.audit-time {
  flex-shrink: 0; font-size: 10px; color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.mini-btn {
  padding: 6px 12px; border-radius: 6px;
  background: var(--bg-subtle); cursor: pointer;
  font-size: 12px; color: var(--text-primary); font-weight: 500;
  &:active { background: var(--bg-inset); }
  &.primary { background: var(--accent-primary); color: #fff; }
  &.primary:active { opacity: 0.85; }
  &.danger { background: var(--danger-soft); color: var(--accent-danger); }
  &.danger:active { background: var(--danger-soft); }
}

.pill {
  padding: 2px 8px; border-radius: 10px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.3px;
}
.pill-pending    { background: var(--warning-soft); color: var(--accent-warn); }
.pill-reviewed   { background: var(--campus-blue-soft); color: var(--campus-blue); }
.pill-resolved   { background: var(--success-soft); color: var(--accent-good); }
.pill-dismissed  { background: var(--bg-subtle); color: var(--text-muted); }
.pill-active     { background: var(--danger-soft); color: var(--accent-danger); }
.pill-lifted     { background: var(--success-soft); color: var(--accent-good); }
.pill-expired    { background: var(--bg-subtle); color: var(--text-muted); }
.pill-shadow     { background: var(--accent-primary); color: #fff; }
.pill-trust      { background: var(--bg-subtle); color: var(--text-secondary); }
.pill-count      { background: var(--campus-blue-soft); color: var(--campus-blue); }
.level-0, .level-1 { background: var(--warning-soft); color: var(--accent-warn); }
.level-2, .level-3 { background: var(--danger-soft); color: var(--accent-danger); }
.level-4, .level-5 { background: var(--accent-primary); color: #fff; }

.detail-mask {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(0,0,0,0.35);
}
.detail-sheet {
  position: fixed; left: 50%; bottom: 0;
  transform: translate(-50%, 100%);
  width: 100%; max-width: 600px;
  max-height: 80vh; background: var(--bg-elev-1);
  border-radius: 16px 16px 0 0; z-index: 901;
  transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
  display: flex; flex-direction: column;
  &.open { transform: translate(-50%, 0); }
}
.detail-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; border-bottom: 0.5px solid var(--line-hair);
}
.detail-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.detail-close {
  width: 28px; height: 28px; border-radius: 50%; background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  text { font-size: 16px; color: var(--text-secondary); line-height: 1; }
  &:active { background: var(--bg-inset); }
}
.detail-body { flex: 1; padding: 16px 18px 30px; }
.d-row { display: block; font-size: 13px; color: var(--text-primary); line-height: 1.6; margin-bottom: 6px; }
.d-key { color: var(--text-secondary); font-weight: 600; }
.d-preview { background: var(--bg-subtle); padding: 8px 10px; border-radius: 6px; margin: 8px 0; font-style: italic; }
.d-appeal { background: var(--warning-soft); padding: 10px; border-radius: 6px; border-left: 3px solid var(--accent-warn); margin: 10px 0; }
.d-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
</style>
