<template>
  <view class="admin">
    <view class="admin-header">
      <text class="admin-title">Moderation Dashboard</text>
      <view v-if="unlocked && currentAdmin" class="admin-whoami">
        <text class="admin-whoami-label">{{ currentAdmin.label }}</text>
        <text v-if="currentAdmin.detail" class="admin-whoami-detail">{{ currentAdmin.detail }}</text>
      </view>
      <view v-if="unlocked" class="admin-logout" @click="onLogout">Sign out</view>
    </view>

    <view v-if="!unlocked" class="gate">
      <text class="gate-label">Enter admin API key</text>
      <input
        v-model="keyInput"
        type="password"
        :placeholder="'ADMIN_API_KEY'"
        class="gate-input"
        confirm-type="done"
        @confirm="onUnlock"
      />
      <view :class="['gate-btn', { disabled: !keyInput || checking }]" @click="onUnlock">
        <text>{{ checking ? 'Checking…' : 'Unlock' }}</text>
      </view>
      <text v-if="gateError" class="gate-error">{{ gateError }}</text>
      <text class="gate-hint">
        Paste your personal admin token (iam_admin_…), minted via
        scripts/admin-token-mint.mjs. It is stored in localStorage only —
        it never touches the Supabase user session.
      </text>
    </view>

    <view v-else class="dash">
      <view class="stats-row">
        <view class="stat">
          <text class="stat-n">{{ stats?.active_suspensions ?? '—' }}</text>
          <text class="stat-l">Active bans</text>
        </view>
        <view class="stat">
          <text class="stat-n">{{ stats?.pending_reports ?? '—' }}</text>
          <text class="stat-l">Pending reports</text>
        </view>
        <view class="stat">
          <text class="stat-n">{{ stats?.pending_appeals ?? '—' }}</text>
          <text class="stat-l">Open appeals</text>
        </view>
        <view class="stat">
          <text class="stat-n">{{ stats?.shadow_banned ?? '—' }}</text>
          <text class="stat-l">Shadow-banned</text>
        </view>
      </view>

      <view class="tabs">
        <view
          v-for="tab in tabList"
          :key="tab.id"
          :class="['tab', { active: activeTab === tab.id }]"
          @click="setTab(tab.id)"
        >
          <text>{{ tab.label }}</text>
        </view>
      </view>

      <view v-if="loading" class="dash-loading">
        <text>Loading…</text>
      </view>

      <view v-else-if="activeTab === 'reports'" class="list">
        <view v-if="reports.length === 0" class="empty"><text>No reports to show.</text></view>
        <view v-for="r in reports" :key="r.id" class="card">
          <view class="card-head">
            <text class="card-title">{{ r.target_type }} · {{ r.reason }}</text>
            <text :class="['pill', 'pill-' + r.status]">{{ r.status }}</text>
          </view>
          <text class="card-meta">by {{ r.reporter_nickname || r.reporter_id }}</text>
          <text v-if="r.note" class="card-note">“{{ r.note }}”</text>
          <text class="card-time">{{ fmtTime(r.created_at) }}</text>
          <view class="card-actions">
            <view class="mini-btn" @click="openReport(r)">Open</view>
            <view v-if="r.status === 'pending'" class="mini-btn" @click="updateReport(r.id, 'reviewed')">Mark reviewed</view>
            <view v-if="r.status !== 'resolved'" class="mini-btn primary" @click="updateReport(r.id, 'resolved')">Resolve</view>
            <view v-if="r.status !== 'dismissed'" class="mini-btn danger" @click="updateReport(r.id, 'dismissed')">Dismiss</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'suspensions'" class="list">
        <view class="search-row">
          <input
            v-model="suspensionQuery"
            class="search-input"
            placeholder="Filter by nickname, reason, or id prefix"
          />
          <text v-if="suspensionQuery" class="search-clear" @click="suspensionQuery = ''">Clear</text>
        </view>
        <view v-if="filteredSuspensions.length === 0" class="empty">
          <text>{{ suspensionQuery ? 'No matches.' : 'No suspensions.' }}</text>
        </view>
        <view v-for="s in filteredSuspensions" :key="s.id" class="card">
          <view class="card-head">
            <image :src="s.profile_avatar_url || defaultAvatarSrc" class="mini-avatar" mode="aspectFill" />
            <text class="card-title">{{ s.profile_nickname || s.profile_id }}</text>
            <text :class="['pill', 'level-' + s.level]">L{{ s.level }}</text>
            <text v-if="s.lifted_at" class="pill pill-lifted">lifted</text>
            <text v-else-if="isExpired(s.ends_at)" class="pill pill-expired">expired</text>
            <text v-else class="pill pill-active">active</text>
          </view>
          <text class="card-meta">{{ s.reason }}</text>
          <text class="card-time">
            Started {{ fmtTime(s.started_at) }} · Ends {{ s.ends_at ? fmtTime(s.ends_at) : 'permanent' }}
          </text>
          <text class="card-audit">
            Issued by <text class="audit-name">{{ s.issued_by_nickname || 'system' }}</text>
            <text v-if="s.lifted_by_nickname"> · Lifted by <text class="audit-name">{{ s.lifted_by_nickname }}</text></text>
          </text>
          <text v-if="s.has_appeal" class="card-appeal-flag">Appeal filed</text>
          <view class="card-actions">
            <view class="mini-btn" @click="openSuspension(s)">Open</view>
            <view class="mini-btn" @click="openUser(s.profile_id)">Open profile</view>
            <view v-if="!s.lifted_at" class="mini-btn primary" @click="onLiftSuspension(s)">Lift</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'appeals'" class="list">
        <view v-if="appeals.length === 0" class="empty"><text>No pending appeals.</text></view>
        <view v-for="a in appeals" :key="a.id" class="card">
          <view class="card-head">
            <image :src="a.profile_avatar_url || defaultAvatarSrc" class="mini-avatar" mode="aspectFill" />
            <text class="card-title">{{ a.profile_nickname || a.profile_id }}</text>
            <text :class="['pill', 'level-' + a.level]">L{{ a.level }}</text>
          </view>
          <text class="card-meta">Original: {{ a.reason }}</text>
          <text class="card-appeal">“{{ a.appeal_note }}”</text>
          <text class="card-time">
            Filed {{ fmtTime(a.created_at) }} · Ends {{ a.ends_at ? fmtTime(a.ends_at) : 'permanent' }}
          </text>
          <view class="card-actions">
            <view class="mini-btn primary" @click="onLiftSuspension(a)">Lift (accept appeal)</view>
            <view class="mini-btn" @click="openSuspension(a)">Details</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'warnings'" class="list">
        <view v-if="warnings.length === 0" class="empty"><text>No flagged profiles.</text></view>
        <view v-for="w in warnings" :key="w.profile_id" class="card">
          <view class="card-head">
            <image :src="w.avatar_url || defaultAvatarSrc" class="mini-avatar" mode="aspectFill" />
            <text class="card-title">{{ w.nickname || w.profile_id }}</text>
            <text class="pill pill-trust">Trust {{ w.trust_score }}</text>
            <text v-if="w.shadow_banned" class="pill pill-shadow">shadow</text>
            <text v-if="w.suspension_level > 0" :class="['pill', 'level-' + w.suspension_level]">L{{ w.suspension_level }}</text>
          </view>
          <text class="card-meta">Warnings: {{ w.warning_count }}</text>
          <view class="card-actions">
            <view class="mini-btn" @click="openUser(w.profile_id)">Open profile</view>
            <view class="mini-btn" @click="onBanPrompt(w.profile_id, w.nickname)">Apply ban</view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'audit'" class="list">
        <view v-if="auditLog.length === 0" class="empty"><text>No audit events yet.</text></view>
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
          <view class="detail-close" role="button" aria-label="Close" @click="detailOpen = false"><text>×</text></view>
      </view>
      <scroll-view class="detail-body" scroll-y>
        <view v-if="detailLoading" class="empty"><text>Loading…</text></view>
        <view v-else-if="detailKind === 'report' && detailRow">
          <text class="d-row"><text class="d-key">Reporter: </text>{{ detailRow.reporter_nickname }} ({{ detailRow.reporter_email || '—' }})</text>
          <text class="d-row"><text class="d-key">Target: </text>{{ detailRow.target_type }} {{ detailRow.target_id }}</text>
          <text class="d-row"><text class="d-key">Author: </text>{{ detailRow.target_user_nickname || detailRow.target_user_id || '—' }}</text>
          <text v-if="detailRow.target_preview" class="d-row d-preview">“{{ detailRow.target_preview }}”</text>
          <text class="d-row"><text class="d-key">Reason: </text>{{ detailRow.reason }}</text>
          <text v-if="detailRow.note" class="d-row"><text class="d-key">Note: </text>{{ detailRow.note }}</text>
          <text class="d-row"><text class="d-key">Status: </text>{{ detailRow.status }}</text>
          <text class="d-row"><text class="d-key">Filed: </text>{{ fmtTime(detailRow.created_at) }}</text>
          <view class="d-actions">
            <view v-if="canOpenTarget(detailRow)" class="mini-btn" @click="openTarget(detailRow)">Open target</view>
            <view v-if="detailRow.target_user_id" class="mini-btn" @click="openUser(detailRow.target_user_id)">Open author profile</view>
            <view v-if="detailRow.target_user_id" class="mini-btn danger" @click="onBanPrompt(detailRow.target_user_id, detailRow.target_user_nickname)">Apply ban to author</view>
          </view>
        </view>
        <view v-else-if="detailKind === 'suspension' && detailRow">
          <text class="d-row"><text class="d-key">User: </text>{{ detailRow.profile_nickname }} ({{ detailRow.profile_email || '—' }})</text>
          <text class="d-row"><text class="d-key">Level: </text>L{{ detailRow.level }}</text>
          <text class="d-row"><text class="d-key">Category: </text>{{ detailRow.category }}</text>
          <text class="d-row"><text class="d-key">Reason: </text>{{ detailRow.reason }}</text>
          <text class="d-row"><text class="d-key">Issued by: </text>{{ detailRow.issued_by_nickname || 'system' }}</text>
          <text class="d-row"><text class="d-key">Started: </text>{{ fmtTime(detailRow.started_at) }}</text>
          <text class="d-row"><text class="d-key">Ends: </text>{{ detailRow.ends_at ? fmtTime(detailRow.ends_at) : 'permanent' }}</text>
          <text class="d-row"><text class="d-key">Trust score: </text>{{ detailRow.profile_trust_score }}</text>
          <text class="d-row"><text class="d-key">Warnings: </text>{{ detailRow.profile_warning_count }}</text>
          <text v-if="detailRow.appeal_note" class="d-row d-appeal">Appeal: “{{ detailRow.appeal_note }}”</text>
          <text v-if="detailRow.lifted_at" class="d-row">
            <text class="d-key">Lifted: </text>{{ fmtTime(detailRow.lifted_at) }} by {{ detailRow.lifted_by_nickname || 'system' }} ({{ detailRow.lift_reason || '—' }})
          </text>
          <view class="d-actions">
            <view class="mini-btn" @click="openUser(detailRow.profile_id)">Open profile</view>
            <view v-if="!detailRow.lifted_at" class="mini-btn primary" @click="onLiftSuspension(detailRow)">Lift</view>
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

type TabId = 'reports' | 'suspensions' | 'appeals' | 'warnings' | 'audit'

interface ReportRow {
  id: string; reporter_id: string; reporter_nickname: string
  target_type: string; target_id: string
  reason: string; note: string; status: string; created_at: string
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
  return { label: 'Admin', detail: '(legacy shared key)' }
})

const tabList: Array<{ id: TabId; label: string }> = [
  { id: 'reports',     label: 'Reports' },
  { id: 'suspensions', label: 'Suspensions' },
  { id: 'appeals',     label: 'Appeals' },
  { id: 'warnings',    label: 'Flagged' },
  { id: 'audit',       label: 'Audit log' },
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
  detailKind.value === 'report' ? 'Report detail' :
  detailKind.value === 'suspension' ? 'Suspension detail' : '')

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
      ? 'Wrong key.'
      : (err?.message || 'Unlock failed.')
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
  suspensions.value = []
  appeals.value = []
  warnings.value = []
  try { uni.removeStorageSync(STORAGE_KEY) } catch {}
}

async function loadStats() {
  try { stats.value = await apiGet<StatsRow>({ resource: 'stats' }) } catch {}
}

async function loadTab(tab: TabId) {
  loading.value = true
  try {
    if (tab === 'reports') {
      reports.value = await apiGet<ReportRow[]>({ resource: 'reports', limit: '100' })
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
    uni.showToast({ title: err?.message || 'Load failed', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function fmtAuditEvent(r: AuditRow): string {
  const actor = r.actor_nickname || (r.actor_id ? r.actor_id.slice(0, 8) : 'system')
  const target = r.target_nickname || (r.target_id ? r.target_id.slice(0, 8) : '—')
  switch (r.event_kind) {
    case 'ban_applied':
      return `${actor} banned ${target} (L${r.details?.level}): ${r.details?.reason || ''}`
    case 'suspension_lifted':
      return `${actor} lifted suspension on ${target}: ${r.details?.reason || ''}`
    case 'report_status_changed':
      return `${actor} changed report ${r.target_id?.slice(0, 8)} status: ${r.details?.from} → ${r.details?.to}`
    case 'actor_blocked':
      return `${actor} blocked from ${r.details?.table} (L${r.details?.level})`
    case 'admin_login':
      return `Admin login`
    case 'admin_unauthorized':
      return `Unauthorized admin access attempt`
    default:
      return `${r.event_kind} by ${actor}`
  }
}

async function setTab(id: TabId) {
  activeTab.value = id
  await loadTab(id)
}

async function updateReport(id: string, status: string) {
  try {
    await apiPost({ action: 'update_report_status', report_id: id, status })
    uni.showToast({ title: 'Updated', icon: 'success' })
    await loadTab('reports')
    await loadStats()
  } catch (err: any) {
    uni.showToast({ title: err?.message || 'Update failed', icon: 'none' })
  }
}

async function openReport(r: ReportRow) {
  detailKind.value = 'report'
  detailRow.value = null
  detailLoading.value = true
  detailOpen.value = true
  try {
    detailRow.value = await apiGet<any>({ resource: 'report', id: r.id })
  } catch (err: any) {
    uni.showToast({ title: err?.message || 'Load failed', icon: 'none' })
  } finally {
    detailLoading.value = false
  }
}

async function openSuspension(s: SuspensionRow | AppealRow) {
  detailKind.value = 'suspension'
  detailRow.value = null
  detailLoading.value = true
  detailOpen.value = true
  try {
    detailRow.value = await apiGet<any>({ resource: 'suspension', id: s.id })
  } catch (err: any) {
    uni.showToast({ title: err?.message || 'Load failed', icon: 'none' })
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
      title: 'Comment has no standalone page — opening author',
      icon: 'none',
      duration: 2000,
    })
    uni.navigateTo({ url: `/pages/seller/index?id=${row.target_user_id}` })
  } else {
    uni.showToast({ title: 'Cannot open this target type', icon: 'none' })
  }
}

function openUser(userId: string) {
  if (!userId) return
  detailOpen.value = false
  uni.navigateTo({ url: `/pages/seller/index?id=${userId}` })
}

function onLiftSuspension(s: { id: string }) {
  uni.showModal({
    title: 'Lift suspension?',
    editable: true,
    placeholderText: 'Lift reason',
    success: async (r) => {
      if (!r.confirm) return
      const reason = (r.content || '').trim() || 'Admin review'
      try {
        await apiPost({ action: 'lift_suspension', suspension_id: s.id, reason })
        uni.showToast({ title: 'Lifted', icon: 'success' })
        detailOpen.value = false
        await loadTab(activeTab.value)
        await loadStats()
      } catch (err: any) {
        uni.showToast({ title: err?.message || 'Lift failed', icon: 'none' })
      }
    },
  })
}

function onBanPrompt(targetId: string, nickname?: string) {
  uni.showActionSheet({
    itemList: [
      'L1: Warning (no time limit)',
      'L2: 72 hour suspension',
      'L3: 7 day suspension',
      'L4: 30 day suspension',
      'L5: Permanent',
    ],
    success: (a) => {
      const level = a.tapIndex + 1
      uni.showModal({
        title: `Ban ${nickname || targetId}?`,
        editable: true,
        placeholderText: 'Reason (required, shown to user on appeal)',
        success: async (r) => {
          if (!r.confirm) return
          const reason = (r.content || '').trim()
          if (!reason) {
            uni.showToast({ title: 'Reason required', icon: 'none' })
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
            uni.showToast({ title: 'Ban applied', icon: 'success' })
            detailOpen.value = false
            await loadTab(activeTab.value)
            await loadStats()
          } catch (err: any) {
            uni.showToast({ title: err?.message || 'Ban failed', icon: 'none' })
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
