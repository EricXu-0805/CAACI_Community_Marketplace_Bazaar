<template>
  <view class="admin">
    <view class="admin-header">
      <text class="admin-title">{{ t('admin.title') }}</text>
      <view v-if="unlocked && currentAdmin" class="admin-whoami">
        <text class="admin-whoami-label">{{ currentAdmin.label }}</text>
        <text v-if="currentAdmin.detail" class="admin-whoami-detail">{{ currentAdmin.detail }}</text>
      </view>
      <view v-if="unlocked" class="admin-refresh" role="button" :aria-label="t('admin.refresh')" :class="{ spinning: loading }" @click="refreshAll">
        <text>↻</text>
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
        :placeholder="'iam_admin_…'"
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
        <view class="stat">
          <text :class="['stat-n', { 'stat-warn': (stats?.oldest_pending_hours ?? 0) >= 48 }]">{{ stats?.oldest_pending_hours != null ? stats.oldest_pending_hours + 'h' : '—' }}</text>
          <text class="stat-l">{{ t('admin.statOldestPending') }}</text>
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
        <view class="filter-row">
          <view :class="['chip', { active: reportPendingOnly }]" @click="setReportFilter(true)">{{ t('admin.reportFilterPending') }}</view>
          <view :class="['chip', { active: !reportPendingOnly }]" @click="setReportFilter(false)">{{ t('admin.reportFilterAll') }}</view>
        </view>
        <view v-if="reportGroups.length === 0" class="empty"><text>{{ t('admin.emptyReports') }}</text></view>
        <template v-else>
          <view class="bulk-bar">
            <view class="mini-btn" @click="toggleSelectMode">{{ selectMode ? t('admin.bulkCancel') : t('admin.bulkSelect') }}</view>
            <template v-if="selectMode && selectedKeys.length">
              <text class="bulk-count">{{ t('admin.bulkSelected', { n: selectedKeys.length }) }}</text>
              <view class="mini-btn primary" @click="bulkResolve('resolved')">{{ t('admin.resolveSelected') }}</view>
              <view class="mini-btn danger" @click="bulkResolve('dismissed')">{{ t('admin.dismissSelected') }}</view>
            </template>
          </view>
          <view
            v-for="g in reportGroups"
            :key="g.target_type + ':' + g.target_id"
            :class="['card', { 'card-selected': isSelected(g) }]"
            @click="selectMode && toggleSelect(g)"
          >
            <view class="card-head">
              <text v-if="selectMode" :class="['select-box', { disabled: g.pending_count <= 0 }]">{{ isSelected(g) ? '☑' : '☐' }}</text>
              <text class="card-title">{{ g.target_type }} · {{ g.last_reason }}</text>
              <text class="pill pill-count">{{ t('admin.reportGroupCount', { reports: g.report_count, people: g.reporter_count }) }}</text>
            </view>
            <text class="card-meta">{{ t('admin.reportGroupMeta', { pending: g.pending_count, name: g.last_reporter_nickname || '—' }) }}</text>
            <text v-if="g.last_note" class="card-note">“{{ g.last_note }}”</text>
            <text class="card-time">{{ t('admin.reportGroupAge', { time: fmtTime(g.first_created_at) }) }}</text>
            <view v-if="!selectMode" class="card-actions">
              <view class="mini-btn" @click="openReportById(g.last_report_id)">{{ t('admin.open') }}</view>
              <view v-if="g.pending_count > 0" class="mini-btn primary" @click="resolveTargetReports(g, 'resolved')">{{ t('admin.resolveAll') }}</view>
              <view v-if="g.pending_count > 0" class="mini-btn danger" @click="resolveTargetReports(g, 'dismissed')">{{ t('admin.dismissAll') }}</view>
            </view>
          </view>
          <view v-if="reportHasMore" class="load-more" @click="loadMoreReports">
            <text>{{ reportLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
          </view>
        </template>
      </view>

      <view v-else-if="activeTab === 'users'" class="list">
        <view class="search-row">
          <input
            v-model="userQuery"
            class="search-input"
            :placeholder="t('admin.userSearchPh')"
            confirm-type="search"
            @confirm="searchUsers"
          />
          <view :class="['mini-btn', 'primary', { disabled: !userQuery.trim() || userSearching }]" @click="searchUsers">
            {{ userSearching ? t('admin.checking') : t('admin.search') }}
          </view>
        </view>
        <view v-if="!userSearched" class="empty"><text>{{ t('admin.userSearchHint') }}</text></view>
        <view v-else-if="userResults.length === 0" class="empty"><text>{{ t('admin.userNoResults') }}</text></view>
        <view v-for="u in userResults" :key="u.id" class="card u-rise">
          <view class="card-head">
            <image :src="u.avatar_url || defaultAvatarSrc" :alt="u.nickname || 'avatar'" class="mini-avatar" mode="aspectFill" />
            <text class="card-title">{{ u.nickname || u.id }}</text>
            <text v-if="u.suspension_level > 0" :class="['pill', 'level-' + u.suspension_level]">L{{ u.suspension_level }}</text>
            <text v-if="u.shadow_banned" class="pill pill-shadow">{{ t('admin.pillShadow') }}</text>
          </view>
          <text class="card-meta">{{ u.email || '—' }}</text>
          <text class="card-time">{{ t('admin.userTrustLine', { trust: u.trust_score, warns: u.warning_count }) }}</text>
          <view class="card-actions">
            <view class="mini-btn" @click="openUser(u.id)">{{ t('admin.openProfile') }}</view>
            <view class="mini-btn" @click="loadLinked(u.id)">{{ linkedFor === u.id ? t('admin.linkedHide') : t('admin.linkedShow') }}</view>
            <view class="mini-btn danger" @click="onBanPrompt(u.id, u.nickname)">{{ t('admin.banUser') }}</view>
          </view>
          <view v-if="linkedFor === u.id" class="linked-box">
            <text v-if="linkedLoading" class="linked-empty">{{ t('admin.loading') }}</text>
            <text v-else-if="linkedAccounts.length === 0" class="linked-empty">{{ t('admin.linkedNone') }}</text>
            <view v-else v-for="la in linkedAccounts" :key="la.id" class="linked-row">
              <text class="linked-name">{{ la.nickname || la.id }}</text>
              <text v-if="la.suspension_level > 0" :class="['pill', 'level-' + la.suspension_level]">L{{ la.suspension_level }}</text>
              <text v-if="la.shadow_banned" class="pill pill-shadow">{{ t('admin.pillShadow') }}</text>
              <text class="linked-meta">{{ t('admin.linkedMeta', { devices: la.shared_devices, time: fmtTime(la.last_seen) }) }}</text>
              <view class="mini-btn danger" @click="onBanPrompt(la.id, la.nickname)">{{ t('admin.banUser') }}</view>
            </view>
          </view>
        </view>
      </view>

      <view v-else-if="activeTab === 'plaza'" class="list">
        <!-- Banner manager -->
        <text class="plaza-sec-title">{{ t('admin.plazaBanners') }}</text>
        <view v-for="b in banners" :key="b.id" class="card">
          <view class="card-head">
            <image :src="b.image_url" class="banner-thumb" mode="aspectFill" />
            <view class="banner-head-info">
              <text class="card-title">{{ b.title_zh || b.title_en || b.title || '—' }}</text>
              <text class="card-meta">P{{ b.priority }}<template v-if="b.start_at || b.end_at"> · {{ fmtTime(b.start_at) }} → {{ b.end_at ? fmtTime(b.end_at) : '∞' }}</template></text>
            </view>
            <view class="banner-pills">
              <text v-if="b.is_default" class="pill pill-default">{{ t('admin.bannerDefaultBadge') }}</text>
              <text :class="['pill', b.active ? 'pill-on' : 'pill-expired']">{{ b.active ? t('admin.bannerOn') : t('admin.bannerOff') }}</text>
            </view>
          </view>
          <view class="card-actions">
            <view class="mini-btn" @click="toggleBannerActive(b)">{{ b.active ? t('admin.bannerDisable') : t('admin.bannerEnable') }}</view>
            <view class="mini-btn" @click="editBanner(b)">{{ t('admin.bannerEdit') }}</view>
            <view class="mini-btn danger" @click="deleteBanner(b)">{{ t('admin.bannerDelete') }}</view>
          </view>
        </view>

        <!-- Banner create / edit form -->
        <view class="card banner-form">
          <text class="card-title">{{ bannerForm.id ? t('admin.bannerEditTitle') : t('admin.bannerNewTitle') }}</text>
          <view class="bf-img-row">
            <image v-if="bannerForm.image_url" :src="bannerForm.image_url" class="bf-preview" mode="aspectFill" />
            <view class="mini-btn primary" @click="onPickBannerImage">
              {{ bannerUploading ? t('admin.checking') : t('admin.bannerPickImage') }}
            </view>
          </view>
          <input v-model="bannerForm.title_zh" class="bf-input" :placeholder="t('admin.bannerTitleZhPh')" />
          <input v-model="bannerForm.title_en" class="bf-input" :placeholder="t('admin.bannerTitleEnPh')" />
          <input v-model="bannerForm.target_url" class="bf-input" :placeholder="t('admin.bannerTargetPh')" />
          <input v-model="bannerForm.priority" type="number" class="bf-input" :placeholder="t('admin.bannerPriorityPh')" />
          <view class="bf-sched">
            <view class="bf-sched-cell">
              <text class="bf-label">{{ t('admin.bannerStartLabel') }}</text>
              <view class="bf-sched-pick">
                <picker class="bf-picker" mode="date" :value="bannerForm.start_at" @change="bannerForm.start_at = $event.detail.value">
                  <view class="bf-input bf-pick"><text>{{ bannerForm.start_at || t('admin.bannerPickDate') }}</text></view>
                </picker>
                <text v-if="bannerForm.start_at" class="bf-clear" @click="bannerForm.start_at = ''">{{ t('admin.bannerClear') }}</text>
              </view>
            </view>
            <view class="bf-sched-cell">
              <text class="bf-label">{{ t('admin.bannerEndLabel') }}</text>
              <view class="bf-sched-pick">
                <picker class="bf-picker" mode="date" :value="bannerForm.end_at" @change="bannerForm.end_at = $event.detail.value">
                  <view class="bf-input bf-pick"><text>{{ bannerForm.end_at || t('admin.bannerPickDate') }}</text></view>
                </picker>
                <text v-if="bannerForm.end_at" class="bf-clear" @click="bannerForm.end_at = ''">{{ t('admin.bannerClear') }}</text>
              </view>
            </view>
          </view>
          <view class="bf-default-row" @click="bannerForm.is_default = !bannerForm.is_default">
            <view :class="['bf-check', { on: bannerForm.is_default }]"><text v-if="bannerForm.is_default" class="bf-check-tick">✓</text></view>
            <view class="bf-default-txt">
              <text class="bf-default-label">{{ t('admin.bannerDefault') }}</text>
              <text class="bf-default-hint">{{ t('admin.bannerDefaultHint') }}</text>
            </view>
          </view>
          <view class="card-actions">
            <view :class="['mini-btn', 'primary', { disabled: bannerSaving || !bannerForm.image_url }]" @click="saveBanner">
              {{ bannerSaving ? t('admin.checking') : t('admin.bannerSave') }}
            </view>
            <view v-if="bannerForm.id" class="mini-btn" @click="resetBannerForm">{{ t('admin.bulkCancel') }}</view>
          </view>
        </view>

        <!-- Pin manager -->
        <text class="plaza-sec-title">{{ t('admin.plazaPins') }}</text>
        <view v-if="plazaPosts.length === 0" class="empty"><text>{{ t('admin.plazaNoPosts') }}</text></view>
        <view v-for="p in plazaPosts" :key="p.id" class="card">
          <view class="card-head">
            <image v-if="p.thumbnail" :src="p.thumbnail" class="banner-thumb" mode="aspectFill" />
            <view class="banner-head-info">
              <text class="card-title">{{ p.author_nickname || p.author_id }}</text>
              <text class="card-meta">{{ p.content }}</text>
            </view>
            <text v-if="p.is_pinned" class="pill pill-pinned">{{ t('admin.pillPinned') }}</text>
          </view>
          <text class="card-time">{{ fmtTime(p.created_at) }} · ❤️{{ p.like_count }} 💬{{ p.comment_count }}</text>
          <view class="card-actions">
            <view :class="['mini-btn', p.is_pinned ? 'danger' : 'primary']" @click="togglePin(p)">
              {{ p.is_pinned ? t('admin.unpinPost') : t('admin.pinPost') }}
            </view>
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
          <image v-if="detailRow.target_image" :src="detailRow.target_image" class="d-thumb" mode="aspectFill" @click="previewThumb(detailRow.target_image)" />
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

type TabId = 'reports' | 'users' | 'plaza' | 'suspensions' | 'appeals' | 'warnings' | 'audit'

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
  oldest_pending_hours: number | null
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
  { id: 'users',       labelKey: 'admin.tabUsers' },
  { id: 'plaza',       labelKey: 'admin.tabPlaza' },
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
const reportPendingOnly = ref(true)
const reportHasMore = ref(false)
const reportLoadingMore = ref(false)
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

interface UserRow {
  id: string; nickname: string; email: string | null; avatar_url: string | null
  trust_score: number; warning_count: number
  suspension_level: number; suspended_until: string | null; shadow_banned: boolean
  created_at: string
}
const userQuery = ref('')
const userResults = ref<UserRow[]>([])
const userSearched = ref(false)
const userSearching = ref(false)

async function searchUsers() {
  const q = userQuery.value.trim()
  if (!q) return
  userSearching.value = true
  try {
    userResults.value = await apiGet<UserRow[]>({ resource: 'search_users', q, limit: '50' })
    userSearched.value = true
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  } finally {
    userSearching.value = false
  }
}

interface LinkedRow {
  id: string; nickname: string; email: string | null; avatar_url: string | null
  suspension_level: number; shadow_banned: boolean
  shared_devices: number; last_seen: string | null
}
const linkedFor = ref<string | null>(null)
const linkedAccounts = ref<LinkedRow[]>([])
const linkedLoading = ref(false)

/* ---------- plaza tab (QA8 #7 admin half): pins + banners ---------- */
interface PlazaPostRow {
  id: string; content: string; author_nickname: string | null; author_id: string
  is_pinned: boolean; is_official: boolean
  like_count: number; comment_count: number
  thumbnail: string | null; created_at: string
}
interface BannerRow {
  id: string; image_url: string; target_url: string | null
  title: string | null; title_en: string | null; title_zh: string | null
  priority: number; active: boolean; is_default: boolean
  start_at: string | null; end_at: string | null; created_at: string
}
const plazaPosts = ref<PlazaPostRow[]>([])
const banners = ref<BannerRow[]>([])
const bannerSaving = ref(false)
const bannerUploading = ref(false)
const emptyBannerForm = () => ({ id: '', image_url: '', title_zh: '', title_en: '', target_url: '', priority: '0', start_at: '', end_at: '', is_default: false })
const bannerForm = ref(emptyBannerForm())

async function loadPlaza() {
  const [posts, bs] = await Promise.all([
    apiGet<PlazaPostRow[]>({ resource: 'plaza_posts', limit: '50' }),
    apiGet<BannerRow[]>({ resource: 'banners' }),
  ])
  plazaPosts.value = posts
  banners.value = bs
}

async function togglePin(p: PlazaPostRow) {
  try {
    await apiPost({ action: 'set_post_pinned', post_id: p.id, pinned: !p.is_pinned })
    p.is_pinned = !p.is_pinned
    plazaPosts.value = [...plazaPosts.value].sort((a, b) =>
      Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at))
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  }
}

function editBanner(b: BannerRow) {
  bannerForm.value = {
    id: b.id, image_url: b.image_url,
    title_zh: b.title_zh || '', title_en: b.title_en || '',
    target_url: b.target_url || '', priority: String(b.priority),
    // timestamptz → date-only for the <picker mode="date"> value; round-trips
    // back through saveBanner's start/end-of-day expansion.
    start_at: b.start_at ? b.start_at.slice(0, 10) : '',
    end_at: b.end_at ? b.end_at.slice(0, 10) : '',
    is_default: !!b.is_default,
  }
}

function resetBannerForm() { bannerForm.value = emptyBannerForm() }

function onPickBannerImage() {
  // #ifdef H5
  uni.chooseImage({
    count: 1,
    success: async (res) => {
      const file = (res.tempFiles as File[] | undefined)?.[0]
      if (!file) return
      bannerUploading.value = true
      try {
        const fd = new FormData()
        fd.append('file', file)
        const r = await platformFetch(apiBase(), {
          method: 'POST',
          headers: { 'x-admin-key': adminKey.value },
          body: fd,
        })
        if (r.status === 401) { onLogout(); throw new Error('unauthorized') }
        const json = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(json?.error || `http_${r.status}`)
        bannerForm.value.image_url = json.data?.url || ''
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
      } finally {
        bannerUploading.value = false
      }
    },
  })
  // #endif
  // #ifndef H5
  uni.showToast({ title: t('admin.bannerUploadH5Only'), icon: 'none' })
  // #endif
}

async function saveBanner() {
  if (bannerSaving.value || !bannerForm.value.image_url) return
  bannerSaving.value = true
  try {
    const f = bannerForm.value
    await apiPost({
      action: 'upsert_banner',
      ...(f.id ? { id: f.id } : {}),
      image_url: f.image_url,
      title_zh: f.title_zh || null,
      title_en: f.title_en || null,
      target_url: f.target_url || null,
      priority: parseInt(f.priority, 10) || 0,
      // Day-granularity window: start-of-day → end-of-day (UTC). A few hours of
      // tz skew is immaterial for a marketing banner; empty clears the bound.
      start_at: f.start_at ? `${f.start_at}T00:00:00Z` : null,
      end_at: f.end_at ? `${f.end_at}T23:59:59Z` : null,
      is_default: f.is_default,
      ...(f.id ? {} : { active: true }),
    })
    resetBannerForm()
    banners.value = await apiGet<BannerRow[]>({ resource: 'banners' })
    uni.showToast({ title: t('admin.bannerSaved'), icon: 'success' })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  } finally {
    bannerSaving.value = false
  }
}

async function toggleBannerActive(b: BannerRow) {
  try {
    await apiPost({ action: 'upsert_banner', id: b.id, active: !b.active })
    b.active = !b.active
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  }
}

function deleteBanner(b: BannerRow) {
  uni.showModal({
    title: t('admin.bannerDelete'),
    content: t('admin.bannerDeleteBody'),
    success: async (res) => {
      if (!res.confirm) return
      try {
        await apiPost({ action: 'delete_banner', id: b.id })
        banners.value = banners.value.filter(x => x.id !== b.id)
      } catch (err: any) {
        uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
      }
    },
  })
}

async function loadLinked(userId: string) {
  if (linkedFor.value === userId) { linkedFor.value = null; return }
  linkedFor.value = userId
  linkedLoading.value = true
  linkedAccounts.value = []
  try {
    linkedAccounts.value = await apiGet<LinkedRow[]>({ resource: 'linked_accounts', profile_id: userId })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
    linkedFor.value = null
  } finally {
    linkedLoading.value = false
  }
}

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
  selectMode.value = false
  selectedKeys.value = []
  suspensions.value = []
  appeals.value = []
  warnings.value = []
  userResults.value = []
  userQuery.value = ''
  userSearched.value = false
  linkedFor.value = null
  linkedAccounts.value = []
  plazaPosts.value = []
  banners.value = []
  resetBannerForm()
  try { uni.removeStorageSync(STORAGE_KEY) } catch {}
}

async function loadStats() {
  try {
    stats.value = await apiGet<StatsRow>({ resource: 'stats' })
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  }
}

const REPORTS_PAGE = 50

async function loadReports(reset = true) {
  if (reset) {
    reportGroups.value = []
    reportHasMore.value = false
  }
  const offset = reset ? 0 : reportGroups.value.length
  const page = (await apiGet<ReportGroup[]>({
    resource: 'reports_grouped',
    limit: String(REPORTS_PAGE),
    offset: String(offset),
    pending: reportPendingOnly.value ? '1' : '0',
  })) || []
  reportGroups.value = reset ? page : reportGroups.value.concat(page)
  reportHasMore.value = page.length === REPORTS_PAGE
}

async function loadMoreReports() {
  if (reportLoadingMore.value || !reportHasMore.value) return
  reportLoadingMore.value = true
  try {
    await loadReports(false)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  } finally {
    reportLoadingMore.value = false
  }
}

async function setReportFilter(pendingOnly: boolean) {
  if (reportPendingOnly.value === pendingOnly) return
  reportPendingOnly.value = pendingOnly
  selectMode.value = false
  selectedKeys.value = []
  loading.value = true
  try {
    await loadReports(true)
  } catch (err: any) {
    uni.showToast({ title: err?.message || t('admin.toastLoadFailed'), icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function loadTab(tab: TabId) {
  loading.value = true
  try {
    if (tab === 'reports') {
      await loadReports(true)
    } else if (tab === 'plaza') {
      await loadPlaza()
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

async function refreshAll() {
  if (loading.value) return
  await Promise.all([loadTab(activeTab.value), loadStats()])
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
const selectMode = ref(false)
const selectedKeys = ref<string[]>([])
function gKey(g: ReportGroup): string { return g.target_type + ':' + g.target_id }
function isSelected(g: ReportGroup): boolean { return selectedKeys.value.includes(gKey(g)) }
function toggleSelect(g: ReportGroup) {
  if (g.pending_count <= 0) return
  const k = gKey(g)
  const i = selectedKeys.value.indexOf(k)
  if (i >= 0) selectedKeys.value.splice(i, 1)
  else selectedKeys.value.push(k)
}
function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedKeys.value = []
}

function bulkResolve(status: 'resolved' | 'dismissed') {
  const groups = reportGroups.value.filter(g => isSelected(g) && g.pending_count > 0)
  if (!groups.length) return
  const total = groups.reduce((s, g) => s + g.pending_count, 0)
  uni.showModal({
    title: status === 'resolved' ? t('admin.resolveAllConfirmTitle') : t('admin.dismissAllConfirmTitle'),
    content: t('admin.bulkConfirmBody', { groups: groups.length, n: total }),
    confirmText: status === 'resolved' ? t('admin.resolve') : t('admin.dismiss'),
    success: async (r) => {
      if (!r.confirm) return
      uni.showLoading({ title: t('admin.loading'), mask: true })
      try {
        await Promise.all(groups.map(g => apiPost({
          action: 'resolve_target_reports',
          target_type: g.target_type,
          target_id: g.target_id,
          status,
        })))
        uni.hideLoading()
        uni.showToast({ title: t('admin.toastUpdated'), icon: 'success' })
        selectMode.value = false
        selectedKeys.value = []
        await loadTab('reports')
        await loadStats()
      } catch (err: any) {
        uni.hideLoading()
        uni.showToast({ title: err?.message || t('admin.toastUpdateFailed'), icon: 'none' })
      }
    },
  })
}

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

function previewThumb(url: string) {
  if (!url) return
  uni.previewImage({ urls: [url], current: url })
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
  padding: calc(20px + var(--mp-status-bar, env(safe-area-inset-top, 0px))) 16px 40px;
  max-width: 960px; margin: 0 auto;
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
.admin-refresh {
  font-size: 17px; line-height: 1; color: var(--text-secondary); cursor: pointer;
  padding: 5px 9px; border-radius: 6px; flex-shrink: 0;
  &:active { background: var(--bg-subtle); }
  &.spinning text { display: inline-block; animation: admin-spin 0.7s linear infinite; }
}
@keyframes admin-spin { to { transform: rotate(360deg); } }
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
.stat-n.stat-warn { color: var(--accent-danger); }
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
.linked-box { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 8px; }
.linked-empty { font-size: 12px; color: var(--text-faint); }
.linked-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.linked-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.linked-meta { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.bulk-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.bulk-count { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.select-box { font-size: 16px; line-height: 1; color: var(--campus-blue); margin-right: 2px; }
.select-box.disabled { color: var(--text-faint); }
.card-selected { outline: 2px solid var(--campus-blue); outline-offset: -1px; }
.filter-row { display: flex; gap: 8px; margin-bottom: 8px; }
.plaza-sec-title { font-size: 13px; font-weight: 700; color: var(--text-secondary); margin: 8px 0 2px; }
.banner-thumb { width: 72px; height: 40px; border-radius: 6px; background: var(--bg-inset); flex-shrink: 0; }
.banner-head-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.banner-head-info .card-meta { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.banner-form { gap: 8px; }
.bf-img-row { display: flex; align-items: center; gap: 10px; }
.bf-preview { width: 120px; height: 60px; border-radius: 8px; background: var(--bg-inset); }
.bf-input {
  height: 34px; padding: 0 10px; background: var(--bg-subtle);
  border-radius: 8px; font-size: 13px; color: var(--text-primary);
}
.banner-pills { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
.bf-sched { display: flex; gap: 10px; }
.bf-sched-cell { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.bf-label { font-size: 12px; color: var(--text-secondary); }
.bf-sched-pick { display: flex; align-items: center; gap: 8px; }
.bf-picker { flex: 1; min-width: 0; }
.bf-pick { display: flex; align-items: center; }
.bf-clear { font-size: 12px; color: var(--campus-blue); flex-shrink: 0; }
.bf-default-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.bf-check {
  width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
  border: 1.5px solid var(--border-strong); background: var(--bg-subtle);
  display: flex; align-items: center; justify-content: center;
}
.bf-check.on { background: var(--accent-good); border-color: var(--accent-good); }
.bf-check-tick { color: #fff; font-size: 14px; font-weight: 700; }
.bf-default-txt { display: flex; flex-direction: column; min-width: 0; }
.bf-default-label { font-size: 13px; color: var(--text-primary); font-weight: 600; }
.bf-default-hint { font-size: 12px; color: var(--text-secondary); }
.pill-default { background: var(--campus-blue-soft); color: var(--campus-blue); }
.pill-pinned { background: var(--campus-blue-soft); color: var(--campus-blue); }
.chip {
  padding: 4px 12px; border-radius: 999px; font-size: 13px;
  background: var(--bg-elev-1); color: var(--text-secondary);
}
.chip.active { background: var(--campus-blue); color: #fff; }
.load-more { text-align: center; padding: 12px; font-size: 13px; color: var(--campus-blue); font-weight: 600; }

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
.audit-msg { flex: 1; color: var(--text-primary); word-break: normal; overflow-wrap: anywhere; }
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
  &.disabled { opacity: 0.45; pointer-events: none; }
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
/* An enabled banner is a healthy state, not a danger like an active ban —
   green, not the suspensions tab's red pill-active (QA8 audit #26). */
.pill-on         { background: var(--success-soft); color: var(--accent-good); }
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
.d-thumb { width: 120px; height: 120px; border-radius: 8px; margin: 4px 0 10px; background: var(--bg-inset); cursor: pointer; }
.d-appeal { background: var(--warning-soft); padding: 10px; border-radius: 6px; border-left: 3px solid var(--accent-warn); margin: 10px 0; }
.d-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
</style>
