<template>
  <view class="admin" :class="mpThemeClass" :style="mpChrome" @keydown="onAdminKeyboardAction">
    <view class="admin-header">
      <text class="admin-title">{{ t('admin.title') }}</text>
      <view v-if="unlocked && currentAdmin" class="admin-whoami">
        <text class="admin-whoami-label">{{ currentAdmin.label }}</text>
        <text v-if="currentAdmin.detail" class="admin-whoami-detail">{{ currentAdmin.detail }}</text>
      </view>
      <view v-if="unlocked" class="admin-refresh" role="button" :tabindex="loading ? -1 : 0" :aria-disabled="loading ? 'true' : 'false'" :aria-label="t('admin.refresh')" :class="{ spinning: loading }" @click="refreshAll">
        <view class="admin-refresh-icon" aria-hidden="true"><UIcon name="refresh" size="xs" color="currentColor" /></view>
      </view>
      <view class="admin-lang" role="button" tabindex="0" :aria-label="t('a11y.langToggle')" @click="toggleLang">
        <text>{{ lang === 'zh' ? 'EN' : '中' }}</text>
      </view>
      <view v-if="unlocked" class="admin-logout" role="button" tabindex="0" @click="onLogout()">{{ t('admin.signOut') }}</view>
    </view>

    <view v-if="!unlocked" class="gate">
      <text class="gate-label">{{ t('admin.gateLabel') }}</text>
      <input
        v-model="keyInput"
        type="password"
        :password="true"
        :placeholder="'iam_admin_…'"
        :aria-label="t('admin.gateLabel')"
        class="gate-input"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        confirm-type="done"
        @confirm="onUnlock"
        @keyup.enter.stop.prevent="onUnlock"
      />
      <view :class="['gate-btn', { disabled: !adminTokenFormatValid || checking }]" role="button" :tabindex="!adminTokenFormatValid || checking ? -1 : 0" :aria-disabled="!adminTokenFormatValid || checking ? 'true' : 'false'" @click="onUnlock">
        <text>{{ checking ? t('admin.checking') : t('admin.unlock') }}</text>
      </view>
      <text v-if="gateError" class="gate-error" role="alert">{{ gateError }}</text>
      <text class="gate-hint">{{ t('admin.gateHint') }}</text>
    </view>

    <view v-else class="dash">
      <view
        v-if="adminRecoveryVisible"
        class="admin-recovery-barrier"
        role="alert"
        aria-live="assertive"
      >
        <text class="admin-recovery-title">{{ t('admin.outcomeRecoveryTitle') }}</text>
        <text v-if="adminRecoveryUnknownCount > 0">
          {{ t('admin.outcomeRecoveryUnknown', { n: adminRecoveryUnknownCount }) }}
        </text>
        <text v-if="adminRecoveryResolvedCount > 0">
          {{ t('admin.outcomeRecoveryResolved', { n: adminRecoveryResolvedCount }) }}
        </text>
        <text v-if="adminRecoveryRequiresOwner">{{ t('admin.outcomeRecoveryOwnerRequired') }}</text>
        <text v-if="adminRecoveryError" class="admin-recovery-error">{{ t('admin.outcomeRecoveryFailed') }}</text>
        <view class="admin-recovery-actions">
          <view
            v-if="adminRecoveryUnknownCount > 0 && !adminRecoveryRequiresOwner"
            :class="['mini-btn', 'primary', { disabled: adminRecoveryBusy }]"
            role="button"
            :tabindex="adminRecoveryBusy ? -1 : 0"
            :aria-disabled="adminRecoveryBusy ? 'true' : 'false'"
            @click="retryAdminOutcomeRecovery"
          >
            {{ adminRecoveryBusy ? t('admin.outcomeRecoveryWorking') : t('admin.outcomeRecoveryRetry') }}
          </view>
          <view
            v-if="adminRecoveryUnknownCount === 0 && adminRecoveryResolvedCount > 0 && !adminRecoveryRequiresOwner"
            :class="['mini-btn', 'primary', { disabled: adminRecoveryBusy }]"
            role="button"
            :tabindex="adminRecoveryBusy ? -1 : 0"
            :aria-disabled="adminRecoveryBusy ? 'true' : 'false'"
            @click="acknowledgeAdminOutcomes"
          >
            {{ adminRecoveryBusy ? t('admin.outcomeRecoveryWorking') : t('admin.outcomeRecoveryAcknowledge') }}
          </view>
        </view>
      </view>

      <view
        v-if="ownerRecovery && ownerRecovery.status !== 'healthy'"
        :class="['owner-recovery', 'owner-recovery-compact', 'owner-recovery-' + ownerRecovery.status]"
        :role="ownerRecovery.status === 'critical' ? 'alert' : 'status'"
        aria-live="polite"
      >
        <text class="owner-recovery-title">{{ t('admin.ownerRecoveryTitle') }}</text>
        <text>{{ t('admin.ownerRecoveryCount', { n: ownerRecovery.active_owner_tokens }) }}</text>
        <text v-if="ownerRecovery.unverified_owner_tokens > 0">
          {{ t('admin.ownerRecoveryUnverified', { n: ownerRecovery.unverified_owner_tokens }) }}
        </text>
        <text v-if="ownerRecovery.expiring_owner_tokens > 0">
          {{ t('admin.ownerRecoveryExpiring', { n: ownerRecovery.expiring_owner_tokens }) }}
        </text>
        <text>{{ t('admin.ownerRecovery.' + ownerRecovery.status) }}</text>
      </view>

      <view
        v-if="canReadTokens && tokenInventoryUnavailable"
        class="owner-recovery owner-recovery-compact owner-recovery-critical"
        role="alert"
        aria-live="assertive"
      >
        <text class="owner-recovery-title">{{ t('admin.ownerRecoveryUnavailableTitle') }}</text>
        <text>{{ t('admin.ownerRecoveryUnavailableBody') }}</text>
      </view>

      <view v-if="canReadModeration" class="stats-row">
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
      <view
        v-if="canReadModeration && (statsReadState.phase === 'error' || statsReadState.stale)"
        :class="['admin-read-state', statsReadState.stale ? 'admin-read-stale' : 'admin-read-error']"
        role="alert"
        aria-live="assertive"
      >
        <view class="admin-read-copy">
          <text class="admin-read-title">{{ t('admin.statsUnavailableTitle') }}</text>
          <text>{{ statsReadState.stale ? t('admin.readStaleBody') : t('admin.readFailedBody') }}</text>
        </view>
        <view class="mini-btn primary" role="button" tabindex="0" @click="loadStats()">{{ t('home.retry') }}</view>
      </view>

      <view class="tabs" role="tablist" :aria-label="t('admin.title')">
        <view
          v-for="tab in tabList"
          :key="tab.id"
          :id="`admin-tab-${tab.id}`"
          :class="['tab', { active: activeTab === tab.id }]"
          role="tab"
          :tabindex="activeTab === tab.id ? 0 : -1"
          :aria-selected="activeTab === tab.id ? 'true' : 'false'"
          aria-controls="admin-tab-panel"
          @click="setTab(tab.id)"
          @keydown="onAdminTabKeydown($event, tab.id)"
        >
          <text>{{ t(tab.labelKey) }}</text>
        </view>
      </view>

      <view v-if="loading" class="dash-loading" role="status" aria-live="polite">
        <text>{{ t('admin.loading') }}</text>
      </view>

      <template v-else>
      <view
        v-if="activeReadState.phase === 'error' || activeReadState.stale"
        :class="['admin-read-state', activeReadState.stale ? 'admin-read-stale' : 'admin-read-error']"
        role="alert"
        aria-live="assertive"
      >
        <view class="admin-read-copy">
          <text class="admin-read-title">{{ activeReadState.stale ? t('admin.readStaleTitle') : t('admin.readFailedTitle') }}</text>
          <text>{{ activeReadState.stale ? t('admin.readStaleBody') : t('admin.readFailedBody') }}</text>
          <text v-if="activeReadState.updatedAt" class="admin-read-time">{{ t('admin.readLastUpdated', { time: fmtTime(activeReadState.updatedAt) }) }}</text>
        </view>
        <view class="mini-btn primary" role="button" tabindex="0" @click="retryActiveRead">{{ t('home.retry') }}</view>
      </view>
      <view v-else-if="activeReadState.loading" class="admin-read-state admin-read-refreshing" role="status" aria-live="polite">
        <text>{{ t('admin.refreshing') }}</text>
      </view>

      <view v-if="activeTab === 'reports'" id="admin-tab-panel" class="list u-stagger" role="tabpanel">
        <view class="filter-row" role="group" :aria-label="t('admin.reportFilterPending')">
          <view :class="['chip', { active: reportPendingOnly }]" role="button" tabindex="0" :aria-pressed="reportPendingOnly ? 'true' : 'false'" @click="setReportFilter(true)">{{ t('admin.reportFilterPending') }}</view>
          <view :class="['chip', { active: !reportPendingOnly }]" role="button" tabindex="0" :aria-pressed="!reportPendingOnly ? 'true' : 'false'" @click="setReportFilter(false)">{{ t('admin.reportFilterAll') }}</view>
        </view>
        <view v-if="activeReadState.phase === 'ready' && reportGroups.length === 0" class="empty"><text>{{ t('admin.emptyReports') }}</text></view>
        <template v-else>
          <view class="bulk-bar">
            <view class="mini-btn" role="button" tabindex="0" @click="toggleSelectMode">{{ selectMode ? t('admin.bulkCancel') : t('admin.bulkSelect') }}</view>
            <template v-if="selectMode && selectedKeys.length">
              <text class="bulk-count">{{ t('admin.bulkSelected', { n: selectedKeys.length }) }}</text>
              <view :class="['mini-btn', 'primary', { disabled: bulkResolving }]" role="button" :tabindex="bulkResolving ? -1 : 0" :aria-disabled="bulkResolving ? 'true' : 'false'" @click="bulkResolve('resolved')">{{ t('admin.resolveSelected') }}</view>
              <view :class="['mini-btn', 'danger', { disabled: bulkResolving }]" role="button" :tabindex="bulkResolving ? -1 : 0" :aria-disabled="bulkResolving ? 'true' : 'false'" @click="bulkResolve('dismissed')">{{ t('admin.dismissSelected') }}</view>
            </template>
          </view>
          <view
            v-for="g in reportGroups"
            :key="g.target_type + ':' + g.target_id"
            :class="['card', { 'card-selected': isSelected(g) }]"
            :role="selectMode && g.pending_count > 0 ? 'button' : undefined"
            :tabindex="selectMode && g.pending_count > 0 ? 0 : undefined"
            :aria-pressed="selectMode && g.pending_count > 0 ? (isSelected(g) ? 'true' : 'false') : undefined"
            @click="selectMode && toggleSelect(g)"
          >
            <view class="card-head">
              <view v-if="selectMode" :class="['select-box', { checked: isSelected(g), disabled: g.pending_count <= 0 }]">
                <UIcon v-if="isSelected(g)" name="check" size="xs" color="#fff" />
              </view>
              <text class="card-title">{{ g.target_type }} · {{ g.last_reason }}</text>
              <text class="pill pill-count">{{ t('admin.reportGroupCount', { reports: g.report_count, people: g.reporter_count }) }}</text>
            </view>
            <text class="card-meta">{{ t('admin.reportGroupMeta', { pending: g.pending_count, name: g.last_reporter_nickname || '—' }) }}</text>
            <text v-if="g.last_note" class="card-note">“{{ g.last_note }}”</text>
            <text class="card-time">{{ t('admin.reportGroupAge', { time: fmtTime(g.first_created_at) }) }}</text>
            <view v-if="!selectMode" class="card-actions">
              <view class="mini-btn" role="button" tabindex="0" @click="openReportById(g.last_report_id)">{{ t('admin.open') }}</view>
              <view v-if="g.pending_count > 0" class="mini-btn primary" role="button" tabindex="0" @click="resolveTargetReports(g, 'resolved')">{{ t('admin.resolveAll') }}</view>
              <view v-if="g.pending_count > 0" class="mini-btn danger" role="button" tabindex="0" @click="resolveTargetReports(g, 'dismissed')">{{ t('admin.dismissAll') }}</view>
            </view>
          </view>
          <view v-if="reportHasMore" class="load-more" role="button" :tabindex="reportLoadingMore ? -1 : 0" :aria-disabled="reportLoadingMore ? 'true' : 'false'" @click="loadMoreReports">
            <text>{{ reportLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
          </view>
        </template>
      </view>

      <view v-else-if="activeTab === 'users'" id="admin-tab-panel" class="list" role="tabpanel">
        <view class="search-row">
          <input
            v-model="userQuery"
            class="search-input"
            :placeholder="t('admin.userSearchPh')"
            :aria-label="t('admin.userSearchPh')"
            confirm-type="search"
            @input="onUserQueryInput"
            @confirm="searchUsers"
          />
          <view :class="['mini-btn', 'primary', { disabled: !userQuery.trim() || userSearching }]" role="button" :tabindex="!userQuery.trim() || userSearching ? -1 : 0" :aria-disabled="!userQuery.trim() || userSearching ? 'true' : 'false'" @click="searchUsers">
            {{ userSearching ? t('admin.checking') : t('admin.search') }}
          </view>
        </view>
        <view v-if="userSearchError" class="admin-read-state admin-read-error" role="alert" aria-live="assertive">
          <view class="admin-read-copy">
            <text class="admin-read-title">{{ t('admin.userSearchFailedTitle') }}</text>
            <text>{{ t('admin.userSearchFailedBody') }}</text>
          </view>
          <view class="mini-btn primary" role="button" tabindex="0" @click="searchUsers">{{ t('home.retry') }}</view>
        </view>
        <view v-else-if="!userSearched" class="empty"><text>{{ t('admin.userSearchHint') }}</text></view>
        <view v-else-if="userResults.length === 0" class="empty"><text>{{ t('admin.userNoResults') }}</text></view>
        <template v-else>
        <view v-for="u in userResults" :key="u.id" class="card u-rise">
          <view class="card-head">
            <UAvatar :src="u.avatar_url" :owner="u.id" :fallback="defaultAvatarSrc" :alt="u.nickname || 'avatar'" class="mini-avatar" lazy />
            <text class="card-title">{{ u.nickname || u.id }}</text>
            <text v-if="u.suspension_level > 0" :class="['pill', 'level-' + u.suspension_level]">L{{ u.suspension_level }}</text>
            <text v-if="u.shadow_banned" class="pill pill-shadow">{{ t('admin.pillShadow') }}</text>
          </view>
          <text class="card-meta">{{ u.email || '—' }}</text>
          <text class="card-time">{{ t('admin.userTrustLine', { trust: u.trust_score, warns: u.warning_count }) }}</text>
          <view class="card-actions">
            <view class="mini-btn" role="button" tabindex="0" @click="openUser(u.id)">{{ t('admin.openProfile') }}</view>
            <view class="mini-btn" role="button" tabindex="0" @click="loadLinked(u.id)">{{ linkedFor === u.id ? t('admin.linkedHide') : t('admin.linkedShow') }}</view>
            <view class="mini-btn danger" role="button" tabindex="0" @click="onBanPrompt(u.id, u.nickname)">{{ t('admin.banUser') }}</view>
          </view>
          <view v-if="linkedFor === u.id" class="linked-box">
            <text v-if="linkedLoading" class="linked-empty" role="status" aria-live="polite">{{ t('admin.loading') }}</text>
            <text v-else-if="linkedAccounts.length === 0" class="linked-empty">{{ t('admin.linkedNone') }}</text>
            <view v-else v-for="la in linkedAccounts" :key="la.id" class="linked-row">
              <text class="linked-name">{{ la.nickname || la.id }}</text>
              <text v-if="la.suspension_level > 0" :class="['pill', 'level-' + la.suspension_level]">L{{ la.suspension_level }}</text>
              <text v-if="la.shadow_banned" class="pill pill-shadow">{{ t('admin.pillShadow') }}</text>
              <text class="linked-meta">{{ t('admin.linkedMeta', { devices: la.shared_devices, time: fmtTime(la.last_seen) }) }}</text>
              <view class="mini-btn danger" role="button" tabindex="0" @click="onBanPrompt(la.id, la.nickname)">{{ t('admin.banUser') }}</view>
            </view>
          </view>
        </view>
        </template>
      </view>

      <view v-else-if="activeTab === 'plaza'" id="admin-tab-panel" class="list" role="tabpanel">
        <!-- Banner manager -->
        <text class="plaza-sec-title">{{ t('admin.plazaBanners') }}</text>
        <view v-for="b in banners" :key="b.id" class="card">
          <view class="card-head">
            <image :src="b.image_url" :alt="b.title_zh || b.title_en || b.title || 'banner'" class="banner-thumb" mode="aspectFill" lazy-load />
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
            <view :class="['mini-btn', { disabled: plazaWriteBusy }]" role="button" :tabindex="plazaWriteBusy ? -1 : 0" :aria-disabled="plazaWriteBusy ? 'true' : 'false'" @click="toggleBannerActive(b)">{{ b.active ? t('admin.bannerDisable') : t('admin.bannerEnable') }}</view>
            <view :class="['mini-btn', { disabled: plazaWriteBusy }]" role="button" :tabindex="plazaWriteBusy ? -1 : 0" :aria-disabled="plazaWriteBusy ? 'true' : 'false'" @click="editBanner(b)">{{ t('admin.bannerEdit') }}</view>
            <view :class="['mini-btn', 'danger', { disabled: plazaWriteBusy }]" role="button" :tabindex="plazaWriteBusy ? -1 : 0" :aria-disabled="plazaWriteBusy ? 'true' : 'false'" @click="deleteBanner(b)">{{ t('admin.bannerDelete') }}</view>
          </view>
        </view>
        <view v-if="bannerHasMore" class="load-more" role="button" :tabindex="plazaLoadingMore ? -1 : 0" :aria-disabled="plazaLoadingMore ? 'true' : 'false'" @click="loadMorePlaza('banners')">
          <text>{{ plazaLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
        </view>

        <!-- Banner create / edit form -->
        <view ref="bannerFormEl" class="card banner-form" tabindex="-1" aria-labelledby="admin-banner-form-title">
          <text id="admin-banner-form-title" class="card-title">{{ bannerForm.id ? t('admin.bannerEditTitle') : t('admin.bannerNewTitle') }}</text>
          <view class="bf-img-row">
            <image v-if="bannerForm.image_url" :src="bannerForm.image_url" :alt="t('a11y.previewImage')" class="bf-preview" mode="aspectFill" />
            <view :class="['mini-btn', 'primary', { disabled: plazaWriteBusy }]" role="button" :tabindex="plazaWriteBusy ? -1 : 0" :aria-disabled="plazaWriteBusy ? 'true' : 'false'" @click="onPickBannerImage">
              {{ bannerUploading ? t('admin.checking') : t('admin.bannerPickImage') }}
            </view>
          </view>
          <input v-model="bannerForm.title_zh" class="bf-input" :placeholder="t('admin.bannerTitleZhPh')" :aria-label="t('admin.bannerTitleZhPh')" />
          <input v-model="bannerForm.title_en" class="bf-input" :placeholder="t('admin.bannerTitleEnPh')" :aria-label="t('admin.bannerTitleEnPh')" />
          <input v-model="bannerForm.target_url" class="bf-input" :placeholder="t('admin.bannerTargetPh')" :aria-label="t('admin.bannerTargetPh')" />
          <input v-model="bannerForm.priority" type="number" class="bf-input" :placeholder="t('admin.bannerPriorityPh')" :aria-label="t('admin.bannerPriorityPh')" />
          <view class="bf-sched">
            <view class="bf-sched-cell">
              <text class="bf-label">{{ t('admin.bannerStartLabel') }}</text>
              <view class="bf-sched-pick">
                <picker
                  class="bf-picker"
                  mode="date"
                  role="button"
                  tabindex="0"
                  :aria-label="t('admin.bannerStartLabel')"
                  :value="bannerForm.start_at"
                  @change="bannerForm.start_at = $event.detail.value"
                  @keydown="onBannerPickerKeydown"
                >
                  <view class="bf-input bf-pick"><text>{{ bannerForm.start_at || t('admin.bannerPickDate') }}</text></view>
                </picker>
                <text v-if="bannerForm.start_at" class="bf-clear" role="button" tabindex="0" @click="bannerForm.start_at = ''">{{ t('admin.bannerClear') }}</text>
              </view>
            </view>
            <view class="bf-sched-cell">
              <text class="bf-label">{{ t('admin.bannerEndLabel') }}</text>
              <view class="bf-sched-pick">
                <picker
                  class="bf-picker"
                  mode="date"
                  role="button"
                  tabindex="0"
                  :aria-label="t('admin.bannerEndLabel')"
                  :value="bannerForm.end_at"
                  @change="bannerForm.end_at = $event.detail.value"
                  @keydown="onBannerPickerKeydown"
                >
                  <view class="bf-input bf-pick"><text>{{ bannerForm.end_at || t('admin.bannerPickDate') }}</text></view>
                </picker>
                <text v-if="bannerForm.end_at" class="bf-clear" role="button" tabindex="0" @click="bannerForm.end_at = ''">{{ t('admin.bannerClear') }}</text>
              </view>
            </view>
          </view>
          <view
            class="bf-default-row"
            role="checkbox"
            tabindex="0"
            :aria-checked="bannerForm.is_default ? 'true' : 'false'"
            @click="bannerForm.is_default = !bannerForm.is_default"
            @keydown.enter.prevent="bannerForm.is_default = !bannerForm.is_default"
            @keydown.space.prevent="bannerForm.is_default = !bannerForm.is_default"
          >
            <view :class="['bf-check', { on: bannerForm.is_default }]" aria-hidden="true">
              <UIcon v-if="bannerForm.is_default" name="check" size="xs" color="#FFFFFF" />
            </view>
            <view class="bf-default-txt">
              <text class="bf-default-label">{{ t('admin.bannerDefault') }}</text>
              <text class="bf-default-hint">{{ t('admin.bannerDefaultHint') }}</text>
            </view>
          </view>
          <view class="card-actions">
            <view :class="['mini-btn', 'primary', { disabled: plazaWriteBusy || !bannerForm.image_url }]" role="button" :tabindex="plazaWriteBusy || !bannerForm.image_url ? -1 : 0" :aria-disabled="plazaWriteBusy || !bannerForm.image_url ? 'true' : 'false'" @click="saveBanner">
              {{ bannerSaving ? t('admin.checking') : t('admin.bannerSave') }}
            </view>
            <view v-if="bannerForm.id" :class="['mini-btn', { disabled: plazaWriteBusy }]" role="button" :tabindex="plazaWriteBusy ? -1 : 0" :aria-disabled="plazaWriteBusy ? 'true' : 'false'" @click="cancelBannerEdit">{{ t('admin.bulkCancel') }}</view>
          </view>
        </view>

        <!-- Pin manager -->
        <text class="plaza-sec-title">{{ t('admin.plazaPins') }}</text>
        <view v-if="activeReadState.phase === 'ready' && plazaPosts.length === 0" class="empty"><text>{{ t('admin.plazaNoPosts') }}</text></view>
        <view v-for="p in plazaPosts" :key="p.id" class="card">
          <view class="card-head">
            <image v-if="p.thumbnail" :src="p.thumbnail" :alt="t('a11y.previewImage')" class="banner-thumb" mode="aspectFill" lazy-load />
            <view class="banner-head-info">
              <text class="card-title">{{ p.author_nickname || p.author_id }}</text>
              <text class="card-meta">{{ p.content }}</text>
            </view>
            <text v-if="p.is_pinned" class="pill pill-pinned">{{ t('admin.pillPinned') }}</text>
          </view>
          <view class="card-time card-stats">
            <text>{{ fmtTime(p.created_at) }}</text>
            <text>·</text>
            <view class="card-stat"><UIcon name="heart" size="xs" color="text-muted" /><text>{{ p.like_count }}</text></view>
            <view class="card-stat"><UIcon name="chat-bubble" size="xs" color="text-muted" /><text>{{ p.comment_count }}</text></view>
          </view>
          <view class="card-actions">
            <view :class="['mini-btn', p.is_pinned ? 'danger' : 'primary', { disabled: plazaWriteBusy }]" role="button" :tabindex="plazaWriteBusy ? -1 : 0" :aria-disabled="plazaWriteBusy ? 'true' : 'false'" @click="togglePin(p)">
              {{ p.is_pinned ? t('admin.unpinPost') : t('admin.pinPost') }}
            </view>
          </view>
        </view>
        <view v-if="plazaPostsHasMore" class="load-more" role="button" :tabindex="plazaLoadingMore ? -1 : 0" :aria-disabled="plazaLoadingMore ? 'true' : 'false'" @click="loadMorePlaza('posts')">
          <text>{{ plazaLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
        </view>
      </view>

      <view v-else-if="activeTab === 'suspensions'" id="admin-tab-panel" class="list" role="tabpanel">
        <view class="search-row">
          <input
            v-model="suspensionQuery"
            class="search-input"
            :placeholder="t('admin.suspFilterPh')"
            :aria-label="t('admin.suspFilterPh')"
          />
          <text v-if="suspensionQuery" class="search-clear" role="button" tabindex="0" @click="suspensionQuery = ''">{{ t('admin.clear') }}</text>
        </view>
        <view v-if="activeReadState.phase === 'ready' && filteredSuspensions.length === 0" class="empty">
          <text>{{ suspensionQuery ? t('admin.noMatches') : t('admin.emptySuspensions') }}</text>
        </view>
        <view v-for="s in filteredSuspensions" :key="s.id" class="card u-rise">
          <view class="card-head">
            <UAvatar :src="s.profile_avatar_url" :owner="s.profile_id" :fallback="defaultAvatarSrc" :alt="s.profile_nickname || 'avatar'" class="mini-avatar" lazy />
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
            <view class="mini-btn" role="button" tabindex="0" @click="openSuspension(s)">{{ t('admin.open') }}</view>
            <view class="mini-btn" role="button" tabindex="0" @click="openUser(s.profile_id)">{{ t('admin.openProfile') }}</view>
            <view v-if="!s.lifted_at && !isExpired(s.ends_at)" class="mini-btn primary" role="button" tabindex="0" @click="onLiftSuspension(s)">{{ t('admin.lift') }}</view>
          </view>
        </view>
        <view v-if="listHasMore.suspensions" class="load-more" role="button" :tabindex="listLoadingMore ? -1 : 0" :aria-disabled="listLoadingMore ? 'true' : 'false'" @click="loadMoreAdminList('suspensions')">
          <text>{{ listLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
        </view>
      </view>

      <view v-else-if="activeTab === 'appeals'" id="admin-tab-panel" class="list u-stagger" role="tabpanel">
        <view v-if="activeReadState.phase === 'ready' && appeals.length === 0" class="empty"><text>{{ t('admin.emptyAppeals') }}</text></view>
        <view v-for="a in appeals" :key="a.id" class="card">
          <view class="card-head">
            <UAvatar :src="a.profile_avatar_url" :owner="a.profile_id" :fallback="defaultAvatarSrc" :alt="a.profile_nickname || 'avatar'" class="mini-avatar" lazy />
            <text class="card-title">{{ a.profile_nickname || a.profile_id }}</text>
            <text :class="['pill', 'level-' + a.level]">L{{ a.level }}</text>
            <text v-if="isExpired(a.ends_at)" class="pill pill-expired">{{ t('admin.pillExpired') }}</text>
            <text v-else class="pill pill-active">{{ t('admin.pillActive') }}</text>
          </view>
          <text class="card-meta">{{ t('admin.appealOriginal', { reason: a.reason }) }}</text>
          <text class="card-appeal">“{{ a.appeal_note }}”</text>
          <text class="card-time">
            {{ t('admin.filedEnds', { filed: fmtTime(a.created_at), end: a.ends_at ? fmtTime(a.ends_at) : t('admin.permanent') }) }}
          </text>
          <view class="card-actions">
            <view v-if="!isExpired(a.ends_at)" class="mini-btn primary" role="button" tabindex="0" @click="onLiftSuspension(a)">{{ t('admin.liftAccept') }}</view>
            <view class="mini-btn" role="button" tabindex="0" @click="openSuspension(a)">{{ t('admin.details') }}</view>
          </view>
        </view>
        <view v-if="listHasMore.appeals" class="load-more" role="button" :tabindex="listLoadingMore ? -1 : 0" :aria-disabled="listLoadingMore ? 'true' : 'false'" @click="loadMoreAdminList('appeals')">
          <text>{{ listLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
        </view>
      </view>

      <view v-else-if="activeTab === 'warnings'" id="admin-tab-panel" class="list u-stagger" role="tabpanel">
        <view v-if="activeReadState.phase === 'ready' && warnings.length === 0" class="empty"><text>{{ t('admin.emptyWarnings') }}</text></view>
        <view v-for="w in warnings" :key="w.profile_id" class="card">
          <view class="card-head">
            <UAvatar :src="w.avatar_url" :owner="w.profile_id" :fallback="defaultAvatarSrc" :alt="w.nickname || 'avatar'" class="mini-avatar" lazy />
            <text class="card-title">{{ w.nickname || w.profile_id }}</text>
            <text class="pill pill-trust">{{ t('admin.trust', { score: w.trust_score }) }}</text>
            <text v-if="w.shadow_banned" class="pill pill-shadow">{{ t('admin.pillShadow') }}</text>
            <text v-if="w.suspension_level > 0" :class="['pill', 'level-' + w.suspension_level]">L{{ w.suspension_level }}</text>
          </view>
          <text class="card-meta">{{ t('admin.warningsCount', { n: w.warning_count }) }}</text>
          <view class="card-actions">
            <view class="mini-btn" role="button" tabindex="0" @click="openUser(w.profile_id)">{{ t('admin.openProfile') }}</view>
            <view class="mini-btn" role="button" tabindex="0" @click="onBanPrompt(w.profile_id, w.nickname)">{{ t('admin.applyBan') }}</view>
          </view>
        </view>
        <view v-if="listHasMore.warnings" class="load-more" role="button" :tabindex="listLoadingMore ? -1 : 0" :aria-disabled="listLoadingMore ? 'true' : 'false'" @click="loadMoreAdminList('warnings')">
          <text>{{ listLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
        </view>
      </view>

      <view v-else-if="activeTab === 'audit'" id="admin-tab-panel" class="list u-stagger" role="tabpanel">
        <view v-if="activeReadState.phase === 'ready' && auditLog.length === 0" class="empty"><text>{{ t('admin.emptyAudit') }}</text></view>
        <view v-for="r in auditLog" :key="r.id" class="audit-row">
          <text :class="['audit-kind', 'kind-' + r.event_kind]">{{ r.event_kind }}</text>
          <text class="audit-msg">{{ fmtAuditEvent(r) }}</text>
          <text class="audit-time">{{ fmtTime(r.created_at) }}</text>
        </view>
        <view v-if="listHasMore.audit" class="load-more" role="button" :tabindex="listLoadingMore ? -1 : 0" :aria-disabled="listLoadingMore ? 'true' : 'false'" @click="loadMoreAdminList('audit')">
          <text>{{ listLoadingMore ? t('admin.checking') : t('admin.loadMore') }}</text>
        </view>
      </view>

      <view v-else-if="activeTab === 'tokens'" id="admin-tab-panel" class="list u-stagger" role="tabpanel">
        <view
          v-if="ownerRecovery"
          :class="['owner-recovery', 'owner-recovery-' + ownerRecovery.status]"
          :role="ownerRecovery.status === 'critical' ? 'alert' : 'status'"
          aria-live="polite"
        >
          <text class="owner-recovery-title">{{ t('admin.ownerRecoveryTitle') }}</text>
          <text>{{ t('admin.ownerRecoveryCount', { n: ownerRecovery.active_owner_tokens }) }}</text>
          <text v-if="ownerRecovery.unverified_owner_tokens > 0">
            {{ t('admin.ownerRecoveryUnverified', { n: ownerRecovery.unverified_owner_tokens }) }}
          </text>
          <text v-if="ownerRecovery.expiring_owner_tokens > 0">
            {{ t('admin.ownerRecoveryExpiring', { n: ownerRecovery.expiring_owner_tokens }) }}
          </text>
          <text>
            {{ ownerRecovery.nearest_owner_expiry
              ? t('admin.ownerNearestExpiry', { time: fmtTime(ownerRecovery.nearest_owner_expiry) })
              : t('admin.ownerNoFiniteExpiry') }}
          </text>
          <text>{{ t('admin.ownerRecovery.' + ownerRecovery.status) }}</text>
        </view>
        <view v-if="activeReadState.phase === 'ready' && adminTokens.length === 0" class="empty"><text>{{ t('admin.emptyTokens') }}</text></view>
        <view v-for="token in adminTokens" :id="`admin-token-card-${token.id}`" :key="token.id" class="card">
          <view class="card-head">
            <text class="card-title">{{ token.admin_name || token.admin_id }}</text>
            <text :class="['pill', 'token-role-' + token.role]">{{ roleLabel(token.role) }}</text>
            <text :class="['pill', tokenStatus(token) === 'active' ? 'pill-active' : 'pill-expired']">
              {{ t('admin.tokenStatus.' + tokenStatus(token)) }}
            </text>
            <text
              v-if="token.role === 'owner' && tokenStatus(token) === 'active' && !token.last_used_at"
              class="pill pill-expired"
            >
              {{ t('admin.tokenStatus.unverified') }}
            </text>
          </view>
          <text class="card-meta">{{ token.admin_email || '—' }}</text>
          <view class="token-identifiers">
            <text class="token-identifier">
              <text class="token-identifier-label">{{ t('admin.tokenId') }}</text>
              <text class="token-identifier-value" selectable>{{ token.id }}</text>
            </text>
            <text class="token-identifier">
              <text class="token-identifier-label">{{ t('admin.tokenAdminId') }}</text>
              <text class="token-identifier-value" selectable>
                {{ token.admin_id || t('admin.tokenAdminDetached') }}
              </text>
            </text>
          </view>
          <text class="card-time">{{ t('admin.tokenCreated', { time: fmtTime(token.created_at) }) }}</text>
          <text class="card-time">{{ t('admin.tokenLastUsed', { time: token.last_used_at ? fmtTime(token.last_used_at) : '—' }) }}</text>
          <text class="card-time">{{ t('admin.tokenExpires', { time: token.expires_at ? fmtTime(token.expires_at) : t('admin.permanent') }) }}</text>
          <view v-if="tokenStatus(token) !== 'revoked'" class="card-actions">
            <view
              :id="`admin-token-revoke-${token.id}`"
              :class="['mini-btn', 'danger', { disabled: tokenMutationIds.includes(token.id) || !tokenActionsReady }]"
              role="button"
              :tabindex="tokenMutationIds.includes(token.id) || !tokenActionsReady ? -1 : 0"
              :aria-disabled="tokenMutationIds.includes(token.id) || !tokenActionsReady ? 'true' : 'false'"
              :aria-expanded="tokenRevokeTarget?.id === token.id ? 'true' : 'false'"
              :aria-controls="`admin-token-revoke-panel-${token.id}`"
              @click="openTokenRevoke(token, $event)"
            >
              {{ t('admin.revokeToken') }}
            </view>
          </view>
          <view
            v-if="tokenRevokeTarget?.id === token.id"
            :id="`admin-token-revoke-panel-${token.id}`"
            class="token-revoke-evidence"
            role="region"
            :aria-label="t('admin.revokeEvidenceTitle')"
            @keydown.esc.stop.prevent="cancelTokenRevoke()"
          >
            <text class="token-revoke-title">{{ t('admin.revokeEvidenceTitle') }}</text>
            <view class="token-revoke-target" :aria-label="t('admin.revokeTargetTitle')">
              <text class="token-revoke-target-title">{{ t('admin.revokeTargetTitle') }}</text>
              <text class="token-identifier">
                <text class="token-identifier-label">{{ t('admin.tokenId') }}</text>
                <text class="token-identifier-value" selectable>{{ token.id }}</text>
              </text>
              <text class="token-identifier">
                <text class="token-identifier-label">{{ t('admin.tokenAdminId') }}</text>
                <text class="token-identifier-value" selectable>
                  {{ token.admin_id || t('admin.tokenAdminDetached') }}
                </text>
              </text>
            </view>
            <text class="token-revoke-hint">
              {{ t('admin.revokeTokenBody', { name: token.admin_name || token.admin_email || token.id }) }}
            </text>
            <text class="token-revoke-hint">{{ t('admin.revokeEvidenceHint') }}</text>
            <label class="token-revoke-field">
              <text class="bf-label">{{ t('admin.revokeCaseLabel') }}</text>
              <input
                id="admin-token-revoke-case"
                v-model="tokenRevokeCaseId"
                class="bf-input"
                maxlength="200"
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                :placeholder="t('admin.revokeCasePh')"
                :aria-label="t('admin.revokeCaseLabel')"
                :aria-invalid="tokenRevokeErrorVisible && !isSafeAuditEvidence(tokenRevokeCaseId) ? 'true' : 'false'"
                :aria-describedby="tokenRevokeErrorVisible ? 'admin-token-revoke-error' : undefined"
                :focus="tokenRevokeFocusField === 'case'"
                @focus="tokenRevokeFocusField = null"
                @input="tokenRevokeErrorVisible = false; tokenRevokeFocusField = null"
              />
            </label>
            <label class="token-revoke-field">
              <text class="bf-label">{{ t('admin.revokeApprovalLabel') }}</text>
              <input
                id="admin-token-revoke-approval"
                v-model="tokenRevokeApprovalRef"
                class="bf-input"
                maxlength="200"
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                :placeholder="t('admin.revokeApprovalPh')"
                :aria-label="t('admin.revokeApprovalLabel')"
                :aria-invalid="tokenRevokeErrorVisible && !isSafeAuditEvidence(tokenRevokeApprovalRef) ? 'true' : 'false'"
                :aria-describedby="tokenRevokeErrorVisible ? 'admin-token-revoke-error' : undefined"
                :focus="tokenRevokeFocusField === 'approval'"
                @focus="tokenRevokeFocusField = null"
                @input="tokenRevokeErrorVisible = false; tokenRevokeFocusField = null"
              />
            </label>
            <text
              v-if="tokenRevokeErrorVisible"
              id="admin-token-revoke-error"
              class="token-revoke-error"
              role="alert"
            >
              {{ t('admin.revokeEvidenceRequired') }}
            </text>
            <view class="card-actions">
              <view
                :class="['mini-btn', 'danger', { disabled: tokenRevokeBusy }]"
                role="button"
                :tabindex="tokenRevokeBusy ? -1 : 0"
                :aria-disabled="tokenRevokeBusy ? 'true' : 'false'"
                @click="confirmTokenRevoke"
              >
                {{ t('admin.confirmRevokeToken') }}
              </view>
              <view
                :class="['mini-btn', { disabled: tokenRevokeBusy }]"
                role="button"
                :tabindex="tokenRevokeBusy ? -1 : 0"
                :aria-disabled="tokenRevokeBusy ? 'true' : 'false'"
                @click="cancelTokenRevoke()"
              >
                {{ t('admin.bulkCancel') }}
              </view>
            </view>
          </view>
        </view>
      </view>
      </template>
    </view>

    <view v-if="detailOpen" class="detail-mask" @click="closeDetail()"></view>
    <view
      v-if="detailOpen"
      ref="detailDialogEl"
      class="detail-sheet open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-detail-title"
      tabindex="-1"
      @keydown="onDetailDialogKeydown"
    >
      <view class="detail-head">
        <text id="admin-detail-title" class="detail-title">{{ detailTitle }}</text>
          <view class="detail-close" role="button" tabindex="0" :aria-label="t('a11y.close')" @click="closeDetail()"><UIcon name="close" size="xs" color="currentColor" /></view>
      </view>
      <scroll-view class="detail-body" scroll-y>
        <view v-if="detailLoading" class="empty"><text>{{ t('admin.loading') }}</text></view>
        <view v-else-if="detailError" class="detail-error" role="alert" aria-live="assertive">
          <text class="admin-read-title">{{ t('admin.detailLoadFailedTitle') }}</text>
          <text>{{ t('admin.detailLoadFailedBody') }}</text>
          <view class="mini-btn primary" role="button" tabindex="0" @click="retryDetail">{{ t('home.retry') }}</view>
        </view>
        <view v-else-if="detailKind === 'report' && detailRow">
          <text class="d-row"><text class="d-key">{{ t('admin.dReporter') }}</text>{{ detailRow.reporter_nickname }} ({{ detailRow.reporter_email || '—' }})</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dTarget') }}</text>{{ detailRow.target_type }} {{ detailRow.target_id }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dAuthor') }}</text>{{ detailRow.target_user_nickname || detailRow.target_user_id || '—' }}</text>
          <text v-if="detailRow.target_preview" class="d-row d-preview">“{{ detailRow.target_preview }}”</text>
          <image v-if="detailRow.target_image" :src="detailRow.target_image" :alt="t('a11y.previewImage')" class="d-thumb" mode="aspectFill" role="button" tabindex="0" @click="previewThumb(detailRow.target_image)" />
          <text class="d-row"><text class="d-key">{{ t('admin.dReason') }}</text>{{ detailRow.reason }}</text>
          <text v-if="detailRow.note" class="d-row"><text class="d-key">{{ t('admin.dNote') }}</text>{{ detailRow.note }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dStatus') }}</text>{{ detailRow.status }}</text>
          <text class="d-row"><text class="d-key">{{ t('admin.dFiled') }}</text>{{ fmtTime(detailRow.created_at) }}</text>
          <view class="d-actions">
            <view v-if="canOpenTarget(detailRow)" class="mini-btn" role="button" tabindex="0" @click="openTarget(detailRow)">{{ t('admin.openTarget') }}</view>
            <view v-if="canTakedown(detailRow)" class="mini-btn danger" role="button" tabindex="0" @click="onTakedownContent(detailRow)">{{ t('admin.takedownContent') }}</view>
            <view v-if="detailRow.target_user_id" class="mini-btn" role="button" tabindex="0" @click="openUser(detailRow.target_user_id)">{{ t('admin.openAuthorProfile') }}</view>
            <view v-if="detailRow.target_user_id" class="mini-btn danger" role="button" tabindex="0" @click="onBanPrompt(detailRow.target_user_id, detailRow.target_user_nickname)">{{ t('admin.banAuthor') }}</view>
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
            <view class="mini-btn" role="button" tabindex="0" @click="openUser(detailRow.profile_id)">{{ t('admin.openProfile') }}</view>
            <view v-if="!detailRow.lifted_at && !isExpired(detailRow.ends_at)" class="mini-btn primary" role="button" tabindex="0" @click="onLiftSuspension(detailRow)">{{ t('admin.lift') }}</view>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { mpChromeVars, mpThemeClass } from '../../composables/useMpChrome'
const mpChrome = mpChromeVars()
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { onHide, onUnload } from '@dcloudio/uni-app'
import { platformFetch } from '../../composables/useSupabase'
import { readBoundedJson } from '../../api/responseBody'
import {
  clearResolvedAdminIdempotencyEntries,
  consumeResolvedAdminIdempotencyKey,
  discardUndispatchedAdminIdempotencyEntries,
  hasOtherAdminIdempotencyUnacknowledgedOutcome,
  inspectAdminIdempotencyRecovery,
  isAdminIdempotencyResolvedOrSuperseded,
  markAdminIdempotencyDispatchStarted,
  releaseAdminIdempotencyKey,
  reserveAdminIdempotencyKey,
  withAdminIdempotencyRequestLock,
} from '../../api/adminIdempotencyJournal'
import { BASE_URL } from '../../config/runtime'
import { useTheme } from '../../composables/useTheme'
import { useI18n } from '../../composables/useI18n'
import UAvatar from '../../components/UAvatar.vue'
import UIcon from '../../components/UIcon.vue'
import { campusDateBounds, campusDateFromIso } from '../../utils/campusTime'

const { t, lang, toggleLang } = useI18n()

const MAX_ADMIN_RESPONSE_BYTES = 2 * 1024 * 1024

type AdminRole = 'operator' | 'security_admin' | 'owner'
type TabId = 'reports' | 'users' | 'plaza' | 'suspensions' | 'appeals' | 'warnings' | 'audit' | 'tokens'
type PagedAdminTab = 'suspensions' | 'appeals' | 'warnings' | 'audit'
type AdminReadPhase = 'idle' | 'ready' | 'error'

interface AdminReadState {
  phase: AdminReadPhase
  loading: boolean
  stale: boolean
  updatedAt: string | null
}

function newAdminReadState(): AdminReadState {
  return { phase: 'idle', loading: false, stale: false, updatedAt: null }
}

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

const adminKey = ref('')
const keyInput = ref('')
const unlocked = ref(false)
const checking = ref(false)
const gateError = ref('')
const ADMIN_TOKEN_PATTERN = /^iam_admin_[A-Za-z0-9_-]{43}$/
const adminTokenFormatValid = computed(() => ADMIN_TOKEN_PATTERN.test(keyInput.value.trim()))
let adminSessionEpoch = 0
let adminUnlockAttemptEpoch = 0

// Gate errors are transient UI state. Keeping a translated sentence here after
// the locale changes leaves the dashboard half translated, so dismiss it and
// let the next validation attempt render in the active language.
watch(lang, () => {
  gateError.value = ''
})

interface AdminSessionOwner {
  readonly epoch: number
  readonly key: string
}

type AdminRequestScope = 'tab-load' | 'stats' | 'reports' | 'plaza' | 'tokens' | 'search-users' | 'linked-accounts' | 'detail' | 'banner-upload'

interface AdminRequestOwner extends AdminSessionOwner {
  readonly requestScope: AdminRequestScope
  readonly requestEpoch: number
}

let adminRequestEpoch = 0
const latestAdminRequest = new Map<AdminRequestScope, number>()

class AdminSessionChangedError extends Error {
  constructor() {
    super('admin_session_changed')
    this.name = 'AdminSessionChangedError'
  }
}

function captureAdminSessionOwner(requireUnlocked = true): AdminSessionOwner | null {
  const key = adminKey.value
  if (!key || (requireUnlocked && !unlocked.value)) return null
  return { epoch: adminSessionEpoch, key }
}

function isAdminSessionOwnerCurrent(
  owner: AdminSessionOwner | null,
  requireUnlocked = true,
): owner is AdminSessionOwner {
  return !!owner
    && owner.epoch === adminSessionEpoch
    && owner.key === adminKey.value
    && (!requireUnlocked || unlocked.value)
}

function requireAdminSessionOwner(requireUnlocked = false): AdminSessionOwner {
  const owner = captureAdminSessionOwner(requireUnlocked)
  if (!owner) throw new AdminSessionChangedError()
  return owner
}

function isAdminSessionChangedError(err: unknown): boolean {
  return err instanceof AdminSessionChangedError
    || (err instanceof Error && err.message === 'admin_session_changed')
}

function beginAdminRequest(
  scope: AdminRequestScope,
  owner = captureAdminSessionOwner(),
): AdminRequestOwner | null {
  if (!isAdminSessionOwnerCurrent(owner)) return null
  const requestEpoch = ++adminRequestEpoch
  latestAdminRequest.set(scope, requestEpoch)
  return { ...owner, requestScope: scope, requestEpoch }
}

function isAdminRequestCurrent(request: AdminRequestOwner | null): request is AdminRequestOwner {
  return !!request
    && isAdminSessionOwnerCurrent(request)
    && latestAdminRequest.get(request.requestScope) === request.requestEpoch
}

function isAdminReadOwnerCurrent(owner: AdminSessionOwner | null): boolean {
  if (!owner) return false
  const candidate = owner as Partial<AdminRequestOwner>
  return typeof candidate.requestScope === 'string' && typeof candidate.requestEpoch === 'number'
    ? isAdminRequestCurrent(owner as AdminRequestOwner)
    : isAdminSessionOwnerCurrent(owner, false)
}

function invalidateAdminRequest(scope: AdminRequestScope) {
  latestAdminRequest.set(scope, ++adminRequestEpoch)
}

function invalidateAllAdminRequests() {
  adminRequestEpoch += 1
  latestAdminRequest.clear()
}

function showAdminRequestError(err: unknown, fallback: string) {
  if (isAdminSessionChangedError(err) || (err instanceof Error && err.message === 'unauthorized')) return
  const message = err instanceof Error ? err.message : ''
  const localized = message === 'admin_previous_outcome_reconciled' ? t('admin.toastPreviousOutcomeReconciled')
    : message === 'admin_outcome_unknown' ? t('admin.toastOutcomeUnknown')
    : message === 'admin_idempotency_unavailable' ? t('admin.toastOutcomeUnknown')
    : message === 'admin_reconciliation_required' ? t('admin.outcomeRecoveryBlocked')
    : message === 'admin_read_stale' ? t('admin.readWriteBlocked')
    : message === 'admin_capability_denied' ? t('admin.errCapabilityDenied')
      : message === 'admin_mutation_conflict' ? t('admin.toastMutationConflict')
        : fallback
  uni.showToast({
    title: localized,
    icon: 'none',
  })
}

function lockAdminAfterReplayedOutcome(owner: AdminSessionOwner): never {
  // A queued/restarted request has just learned the definitive result of an
  // earlier same-intent operation. Never let its caller apply that old result
  // to current UI state. Locking clears every privileged snapshot; unlock then
  // performs fresh authoritative reads before another write is possible.
  if (onLogout(owner)) {
    uni.showToast({
      title: t('admin.toastPreviousOutcomeReconciled'),
      icon: 'none',
      duration: 4000,
    })
  }
  throw new AdminSessionChangedError()
}

function lockAdminAfterUnknownOutcome(owner: AdminSessionOwner): never {
  // A later rejection cannot disprove that an earlier timed-out dispatch
  // committed. Preserve the pending journal key, clear privileged snapshots,
  // and require authoritative re-authentication before any other write.
  if (onLogout(owner)) {
    uni.showToast({
      title: t('admin.toastOutcomeUnknown'),
      icon: 'none',
      duration: 4000,
    })
  }
  throw new AdminSessionChangedError()
}

async function runAdminJournalStep<T>(
  owner: AdminSessionOwner,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    if (err instanceof Error && err.message === 'admin_idempotency_unavailable') {
      return lockAdminAfterUnknownOutcome(owner)
    }
    throw err
  }
}

function canonicalAdminMutation(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalAdminMutation).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalAdminMutation(record[key])}`,
  ).join(',')}}`
}

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
  role: AdminRole | null
  capabilities: string[]
  source: string | null
}
const whoami = ref<WhoAmI | null>(null)

function isAdminRole(value: unknown): value is AdminRole {
  return value === 'operator' || value === 'security_admin' || value === 'owner'
}

function roleLabel(role: AdminRole | string | null): string {
  if (!isAdminRole(role)) return t('admin.role.unknown')
  return t(`admin.role.${role}`)
}

const canReadModeration = computed(() => whoami.value?.role === 'operator' || whoami.value?.role === 'owner')
const canReadPlaza = computed(() => whoami.value?.role === 'owner')
const canReadTokens = computed(() => whoami.value?.role === 'security_admin' || whoami.value?.role === 'owner')
const currentAdmin = computed(() => {
  if (!whoami.value) return null
  const name = whoami.value.admin_name?.trim() || ''
  const email = whoami.value.admin_email?.trim() || ''
  const detail = [email, roleLabel(whoami.value.role)].filter(Boolean).join(' · ')
  if (name) {
    return { label: name, detail: detail || null }
  }
  if (email) {
    const prefix = email.split('@')[0]
    return { label: prefix, detail }
  }
  return { label: t('admin.legacyAdmin'), detail: roleLabel(whoami.value.role) }
})

const allTabs: Array<{ id: TabId; labelKey: string; domain: 'moderation' | 'plaza' | 'tokens' }> = [
  { id: 'reports',     labelKey: 'admin.tabReports', domain: 'moderation' },
  { id: 'users',       labelKey: 'admin.tabUsers', domain: 'moderation' },
  { id: 'plaza',       labelKey: 'admin.tabPlaza', domain: 'plaza' },
  { id: 'suspensions', labelKey: 'admin.tabSuspensions', domain: 'moderation' },
  { id: 'appeals',     labelKey: 'admin.tabAppeals', domain: 'moderation' },
  { id: 'warnings',    labelKey: 'admin.tabWarnings', domain: 'moderation' },
  { id: 'audit',       labelKey: 'admin.tabAudit', domain: 'moderation' },
  { id: 'tokens',      labelKey: 'admin.tabTokens', domain: 'tokens' },
]
const tabList = computed(() => allTabs.filter((tab) => (
  tab.domain === 'moderation' ? canReadModeration.value
    : tab.domain === 'plaza' ? canReadPlaza.value
      : canReadTokens.value
)))
const activeTab = ref<TabId>('reports')
const tabReadStates = ref<Record<TabId, AdminReadState>>({
  reports: newAdminReadState(),
  users: newAdminReadState(),
  plaza: newAdminReadState(),
  suspensions: newAdminReadState(),
  appeals: newAdminReadState(),
  warnings: newAdminReadState(),
  audit: newAdminReadState(),
  tokens: newAdminReadState(),
})
const statsReadState = ref<AdminReadState>(newAdminReadState())
const activeReadState = computed(() => tabReadStates.value[activeTab.value])
const tokenInventoryUnavailable = computed(() => {
  const state = tabReadStates.value.tokens
  return state.phase === 'error' || state.stale
})
const tokenActionsReady = computed(() => {
  const state = tabReadStates.value.tokens
  return state.phase === 'ready' && !state.stale && !state.loading
})

function updateTabReadState(tab: TabId, patch: Partial<AdminReadState>) {
  tabReadStates.value = {
    ...tabReadStates.value,
    [tab]: { ...tabReadStates.value[tab], ...patch },
  }
}

function beginTabRead(tab: TabId) {
  updateTabReadState(tab, { loading: true })
}

function completeTabRead(tab: TabId) {
  updateTabReadState(tab, {
    phase: 'ready',
    loading: false,
    stale: false,
    updatedAt: new Date().toISOString(),
  })
}

function failTabRead(tab: TabId) {
  const previous = tabReadStates.value[tab]
  updateTabReadState(tab, {
    phase: previous.phase === 'ready' ? 'ready' : 'error',
    loading: false,
    stale: previous.phase === 'ready',
  })
}

function tabReadIsAuthoritative(tab: TabId): boolean {
  const state = tabReadStates.value[tab]
  return state.phase === 'ready' && !state.stale && !state.loading
}

function retryActiveRead() {
  void refreshAll()
}

function onAdminTabKeydown(event: KeyboardEvent, current: TabId) {
  const order = tabList.value.map(tab => tab.id)
  if (!order.length) return
  if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
    event.preventDefault()
    event.stopPropagation()
    void setTab(current)
    return
  }
  let nextIndex = order.indexOf(current)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (nextIndex + 1) % order.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (nextIndex - 1 + order.length) % order.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = order.length - 1
  else return
  event.preventDefault()
  const tabListEl = (event.currentTarget as HTMLElement | null)?.parentElement
  void setTab(order[nextIndex])
  // uni-app updates the custom <uni-view> tab attributes after the Vue DOM
  // flush. Focusing in that same microtask can be overwritten by the custom
  // element upgrade/render pass, leaving selection on the next tab while the
  // visible keyboard focus ring stays on the previous one. Use the next task
  // rather than requestAnimationFrame: background/admin QA tabs may throttle
  // animation frames indefinitely, but keyboard focus must still move.
  nextTick(() => {
    setTimeout(() => {
      const targetId = `admin-tab-${order[nextIndex]}`
      const target = (
        typeof document !== 'undefined'
          ? document.getElementById(targetId)
          : null
      ) || tabListEl?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]
      if (typeof target?.focus === 'function') target.focus()
    }, 0)
  })
}

/*
 * All admin actions are custom uni-app views rather than native buttons.
 * One delegated H5 handler gives every role=button the native Enter/Space
 * contract without duplicating side effects. Disabled actions are removed
 * from the tab order and remain inert even if an event is dispatched at them.
 */
function onAdminKeyboardAction(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
  const origin = event.target as HTMLElement | null
  const root = event.currentTarget as HTMLElement | null
  const button = origin?.closest?.<HTMLElement>('[role="button"]') || null
  if (!button || !root?.contains(button)) return
  if (button.getAttribute('aria-disabled') === 'true' || button.getAttribute('tabindex') === '-1') return
  event.preventDefault()
  event.stopPropagation()
  button.click()
}

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

interface AdminTokenRow {
  id: string
  admin_id: string | null
  admin_name: string | null
  admin_email: string | null
  role: AdminRole
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

interface OwnerRecoveryHealth {
  active_owner_tokens: number
  unverified_owner_tokens: number
  expiring_owner_tokens: number
  non_expiring_owner_tokens: number
  nearest_owner_expiry: string | null
  status: 'healthy' | 'warning' | 'critical'
}

interface AdminTokenInventory {
  tokens: AdminTokenRow[]
  owner_recovery: OwnerRecoveryHealth
}

type AdminTokenStatus = 'active' | 'expired' | 'revoked'

function tokenStatus(token: AdminTokenRow): AdminTokenStatus {
  if (token.revoked_at) return 'revoked'
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) return 'expired'
  return 'active'
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
const adminTokens = ref<AdminTokenRow[]>([])
const ownerRecovery = ref<OwnerRecoveryHealth | null>(null)
const adminWritesReady = ref(false)
const adminRecoveryResolvedCount = ref(0)
const adminRecoveryUnknownCount = ref(0)
const adminRecoveryBusy = ref(false)
const adminRecoveryError = ref(false)
const adminRecoveryVisible = computed(() => (
  adminRecoveryResolvedCount.value > 0
  || adminRecoveryUnknownCount.value > 0
  || adminRecoveryError.value
))
const adminRecoveryRequiresOwner = computed(() => (
  (adminRecoveryResolvedCount.value > 0 || adminRecoveryUnknownCount.value > 0)
  && whoami.value?.role !== 'owner'
))
const tokenMutationIds = ref<string[]>([])
const tokenRevokeTarget = ref<AdminTokenRow | null>(null)
const tokenRevokeCaseId = ref('')
const tokenRevokeApprovalRef = ref('')
const tokenRevokeErrorVisible = ref(false)
const tokenRevokeFocusField = ref<'case' | 'approval' | null>(null)
let tokenRevokeOwner: AdminSessionOwner | null = null
let tokenRevokeOpener: HTMLElement | null = null
const tokenRevokeBusy = computed(() => (
  !!tokenRevokeTarget.value && tokenMutationIds.value.includes(tokenRevokeTarget.value.id)
))
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
const listHasMore = ref<Record<PagedAdminTab, boolean>>({
  suspensions: false,
  appeals: false,
  warnings: false,
  audit: false,
})
const listLoadingMore = ref(false)
let listLoadingMoreEpoch = 0
const listOffsets = ref<Record<PagedAdminTab, number>>({
  suspensions: 0,
  appeals: 0,
  warnings: 0,
  audit: 0,
})

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
const userSearchError = ref(false)
const appliedUserQuery = ref('')

function onUserQueryInput() {
  invalidateAdminRequest('search-users')
  // Superseding the request means its guarded finally block can no longer
  // clear this shared flag. Clear it with the invalidation so a changed query
  // never leaves the search button permanently busy.
  userSearching.value = false
  userResults.value = []
  userSearched.value = false
  userSearchError.value = false
  appliedUserQuery.value = ''
}

async function searchUsers() {
  const q = userQuery.value.trim()
  if (!q) return
  const request = beginAdminRequest('search-users')
  if (!request) return
  // Editing the query while a request is in flight makes that response stale,
  // but it must not leave the shared spinner locked forever. Request ownership
  // controls lifecycle cleanup; query equality only controls result rendering.
  const requestIsLatest = () => isAdminRequestCurrent(request)
  const requestCanApply = () => requestIsLatest() && userQuery.value.trim() === q
  userSearching.value = true
  userResults.value = []
  userSearched.value = false
  userSearchError.value = false
  appliedUserQuery.value = q
  try {
    const rows = await apiGet<UserRow[]>({ resource: 'search_users', q, limit: '50' }, request)
    if (requestCanApply()) {
      userResults.value = rows
      userSearched.value = true
      userSearchError.value = false
    }
  } catch (err: any) {
    if (requestCanApply()) {
      userResults.value = []
      userSearched.value = false
      userSearchError.value = true
      showAdminRequestError(err, t('admin.toastLoadFailed'))
    }
  } finally {
    if (requestIsLatest()) userSearching.value = false
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
const plazaPostsHasMore = ref(false)
const bannerHasMore = ref(false)
const plazaLoadingMore = ref(false)
let plazaLoadingMoreEpoch = 0
const plazaOffsets = ref({ posts: 0, banners: 0 })
const bannerFormEl = ref<HTMLElement | null>(null)
const bannerSaving = ref(false)
const bannerUploading = ref(false)
const pinMutationIds = ref<string[]>([])
const bannerMutationIds = ref<string[]>([])
const plazaWriteBusy = computed(() => (
  bannerSaving.value
  || bannerUploading.value
  || pinMutationIds.value.length > 0
  || bannerMutationIds.value.length > 0
))
const emptyBannerForm = () => ({ id: '', image_url: '', original_image_url: '', title_zh: '', title_en: '', target_url: '', priority: '0', start_at: '', end_at: '', is_default: false })
const bannerForm = ref(emptyBannerForm())

function onBannerPickerKeydown(event: KeyboardEvent) {
  if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement | null)?.click()
}

async function uploadBannerFile(
  file: File,
  request: AdminRequestOwner,
  applyDefinitiveUrl: (url: string) => void | Promise<void>,
): Promise<string> {
  // Reserve before taking the origin-wide transport lock. Concurrent tabs and
  // queued clicks therefore share one durable key before either can dispatch.
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error('admin_mutation_invalid')
  if (!adminWritesReady.value) throw new Error('admin_reconciliation_required')
  if (!tabReadIsAuthoritative('plaza')) throw new Error('admin_read_stale')
  if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
  const journalHandle = await runAdminJournalStep(request, async () => (
    reserveAdminIdempotencyKey(
      'banner-upload',
      request.key,
      await file.arrayBuffer(),
    )
  ))
  if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
  return withAdminIdempotencyRequestLock(
    async () => uploadBannerFileLocked(file, request, journalHandle, applyDefinitiveUrl),
  )
}

async function uploadBannerFileLocked(
  file: File,
  request: AdminRequestOwner,
  journalHandle: Awaited<ReturnType<typeof reserveAdminIdempotencyKey>>,
  applyDefinitiveUrl: (url: string) => void | Promise<void>,
): Promise<string> {
  if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
  if (await runAdminJournalStep(request, () => isAdminIdempotencyResolvedOrSuperseded(journalHandle))) {
    lockAdminAfterReplayedOutcome(request)
  }
  if (await runAdminJournalStep(request, () => hasOtherAdminIdempotencyUnacknowledgedOutcome(journalHandle))) {
    lockAdminAfterUnknownOutcome(request)
  }
  if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
  const replayingUnknown = await runAdminJournalStep(
    request,
    () => markAdminIdempotencyDispatchStarted(journalHandle),
  )
  if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
  const idempotencyKey = journalHandle.idempotencyKey
  // The journal atomically reports whether this exact key crossed its durable
  // pre-dispatch marker before. Treat that state as sticky-unknown; merely
  // reusing an earlier reservation is not enough, because it may never have
  // reached transport.
  let sawOutcomeUnknown = replayingUnknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fd = new FormData()
    fd.append('file', file)
    let response: Response
    try {
      response = await platformFetch(apiBase(), {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
          Authorization: `Bearer ${request.key}`,
        },
        body: fd,
      })
    } catch {
      if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
      sawOutcomeUnknown = true
      if (attempt === 0) continue
      return lockAdminAfterUnknownOutcome(request)
    }
    if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
    if (response.status === 401) {
      if (sawOutcomeUnknown) return lockAdminAfterUnknownOutcome(request)
      await runAdminJournalStep(request, () => releaseAdminIdempotencyKey(journalHandle))
      await runAdminJournalStep(request, () => consumeResolvedAdminIdempotencyKey(journalHandle))
      onLogout(request)
      throw new Error('unauthorized')
    }

    let payload: any
    try {
      payload = await readAdminJson<any>(response)
    } catch {
      if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
      sawOutcomeUnknown = true
      if (attempt === 0) continue
      return lockAdminAfterUnknownOutcome(request)
    }
    if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
    if (response.ok && typeof payload?.data?.url === 'string' && payload.data.url) {
      await runAdminJournalStep(request, () => releaseAdminIdempotencyKey(journalHandle))
      if (replayingUnknown) {
        lockAdminAfterReplayedOutcome(request)
      }
      try {
        if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
        await applyDefinitiveUrl(payload.data.url)
        if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
      } catch (err) {
        // The response is definitive but the privileged result was not safely
        // applied to the current UI. Keep its tombstone for Owner recovery.
        if (isAdminSessionOwnerCurrent(request, false)) lockAdminAfterReplayedOutcome(request)
        throw err
      }
      const acknowledged = await runAdminJournalStep(
        request,
        () => consumeResolvedAdminIdempotencyKey(journalHandle),
      )
      if (!acknowledged) lockAdminAfterUnknownOutcome(request)
      return payload.data.url
    }

    const errorCode = typeof payload?.error === 'string'
      ? payload.error
      : `http_${response.status}`
    if (response.status >= 500) {
      sawOutcomeUnknown = true
      if (attempt === 0) continue
      return lockAdminAfterUnknownOutcome(request)
    }
    if (sawOutcomeUnknown) return lockAdminAfterUnknownOutcome(request)
    if (!DEFINITIVE_ADMIN_NO_COMMIT_ERRORS.has(errorCode)) {
      return lockAdminAfterUnknownOutcome(request)
    }
    await runAdminJournalStep(request, () => releaseAdminIdempotencyKey(journalHandle))
    const acknowledged = await runAdminJournalStep(
      request,
      () => consumeResolvedAdminIdempotencyKey(journalHandle),
    )
    if (!acknowledged) lockAdminAfterUnknownOutcome(request)
    throw new Error(errorCode)
  }
  return lockAdminAfterUnknownOutcome(request)
}

const PLAZA_PAGE = 20

function appendUniqueBy<T>(current: T[], incoming: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set(current.map(keyOf))
  const next = current.slice()
  for (const row of incoming) {
    const key = keyOf(row)
    if (!key || seen.has(key)) continue
    seen.add(key)
    next.push(row)
  }
  return next
}

function resetPlazaLoadingMore() {
  plazaLoadingMoreEpoch += 1
  plazaLoadingMore.value = false
}

async function loadPlaza(owner = captureAdminSessionOwner()) {
  if (!owner) return
  const request = beginAdminRequest('plaza', owner)
  if (!request) return
  resetPlazaLoadingMore()
  beginTabRead('plaza')
  try {
    const [posts, bs] = await Promise.all([
      apiGet<PlazaPostRow[]>({ resource: 'plaza_posts', limit: String(PLAZA_PAGE + 1), offset: '0' }, request),
      apiGet<BannerRow[]>({ resource: 'banners', limit: String(PLAZA_PAGE + 1), offset: '0' }, request),
    ])
    if (!isAdminRequestCurrent(request)) return
    plazaPosts.value = posts.slice(0, PLAZA_PAGE)
    banners.value = bs.slice(0, PLAZA_PAGE)
    plazaOffsets.value = {
      posts: Math.min(posts.length, PLAZA_PAGE),
      banners: Math.min(bs.length, PLAZA_PAGE),
    }
    plazaPostsHasMore.value = posts.length > PLAZA_PAGE
    bannerHasMore.value = bs.length > PLAZA_PAGE
    completeTabRead('plaza')
  } catch (err) {
    if (isAdminRequestCurrent(request)) failTabRead('plaza')
    throw err
  }
}

async function loadMorePlaza(kind: 'posts' | 'banners') {
  const hasMore = kind === 'posts' ? plazaPostsHasMore.value : bannerHasMore.value
  if (!hasMore || plazaLoadingMore.value) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  const request = beginAdminRequest('plaza', owner)
  if (!request) return
  const busyEpoch = ++plazaLoadingMoreEpoch
  plazaLoadingMore.value = true
  beginTabRead('plaza')
  try {
    if (kind === 'posts') {
      const rows = await apiGet<PlazaPostRow[]>({
        resource: 'plaza_posts',
        limit: String(PLAZA_PAGE + 1),
        offset: String(plazaOffsets.value.posts),
      }, request)
      if (!isAdminRequestCurrent(request)) return
      const visible = rows.slice(0, PLAZA_PAGE)
      plazaOffsets.value = { ...plazaOffsets.value, posts: plazaOffsets.value.posts + visible.length }
      plazaPosts.value = appendUniqueBy(plazaPosts.value, visible, row => row.id)
      plazaPostsHasMore.value = rows.length > PLAZA_PAGE
    } else {
      const rows = await apiGet<BannerRow[]>({
        resource: 'banners',
        limit: String(PLAZA_PAGE + 1),
        offset: String(plazaOffsets.value.banners),
      }, request)
      if (!isAdminRequestCurrent(request)) return
      const visible = rows.slice(0, PLAZA_PAGE)
      plazaOffsets.value = { ...plazaOffsets.value, banners: plazaOffsets.value.banners + visible.length }
      banners.value = appendUniqueBy(banners.value, visible, row => row.id)
      bannerHasMore.value = rows.length > PLAZA_PAGE
    }
    completeTabRead('plaza')
  } catch (err) {
    if (isAdminRequestCurrent(request)) {
      failTabRead('plaza')
      showAdminRequestError(err, t('admin.toastLoadFailed'))
    }
  } finally {
    if (plazaLoadingMoreEpoch === busyEpoch) plazaLoadingMore.value = false
  }
}

async function loadTokens(owner = captureAdminSessionOwner()) {
  if (!owner || !canReadTokens.value) return
  const request = beginAdminRequest('tokens', owner)
  if (!request) return
  beginTabRead('tokens')
  try {
    const inventory = await apiGet<AdminTokenInventory>({ resource: 'tokens' }, request)
    if (isAdminRequestCurrent(request)) {
      adminTokens.value = Array.isArray(inventory?.tokens) ? inventory.tokens : []
      ownerRecovery.value = inventory?.owner_recovery || null
      completeTabRead('tokens')
    }
  } catch (err) {
    if (isAdminRequestCurrent(request)) failTabRead('tokens')
    throw err
  }
}

function isSafeAuditEvidence(value: string): boolean {
  return value.trim().length > 0
    && value.length <= 200
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
}

function restoreTokenRevokeFocus(opener: HTMLElement | null) {
  nextTick(() => {
    if (typeof document === 'undefined') return
    const target = opener && document.contains(opener)
      ? opener
      : document.getElementById('admin-tab-tokens')
    if (typeof target?.focus === 'function') target.focus()
  })
}

function cancelTokenRevoke(restoreFocus = true) {
  if (tokenRevokeBusy.value) return
  const opener = tokenRevokeOpener
  tokenRevokeTarget.value = null
  tokenRevokeCaseId.value = ''
  tokenRevokeApprovalRef.value = ''
  tokenRevokeErrorVisible.value = false
  tokenRevokeFocusField.value = null
  tokenRevokeOwner = null
  tokenRevokeOpener = null
  if (restoreFocus) restoreTokenRevokeFocus(opener)
}

function openTokenRevoke(token: AdminTokenRow, event?: Event) {
  const owner = captureAdminSessionOwner()
  if (!owner || !canReadTokens.value || !tokenActionsReady.value || tokenStatus(token) === 'revoked') return
  const eventTarget = event?.currentTarget as HTMLElement | null | undefined
  tokenRevokeOpener = typeof eventTarget?.focus === 'function'
    ? eventTarget
    : (typeof document !== 'undefined'
        ? document.getElementById(`admin-token-revoke-${token.id}`)
        : null) || activeAdminElement()
  tokenRevokeOwner = owner
  tokenRevokeTarget.value = token
  tokenRevokeCaseId.value = ''
  tokenRevokeApprovalRef.value = ''
  tokenRevokeErrorVisible.value = false
  tokenRevokeFocusField.value = null
  focusInvalidTokenRevokeEvidence('case')
}

function focusInvalidTokenRevokeEvidence(field: 'case' | 'approval') {
  tokenRevokeFocusField.value = null
  nextTick(() => {
    tokenRevokeFocusField.value = field
    // uni-app's H5 renderer may put the id on a wrapper rather than its native
    // input. The platform `focus` prop handles mini programs; this fallback
    // makes the same validation recovery deterministic for keyboard users.
    setTimeout(() => {
      if (typeof document === 'undefined') return
      const root = document.getElementById(`admin-token-revoke-${field}`)
      const target = root?.matches('input')
        ? root
        : root?.querySelector<HTMLInputElement>('input')
      target?.focus()
    }, 0)
  })
}

async function confirmTokenRevoke() {
  const token = tokenRevokeTarget.value
  const owner = tokenRevokeOwner
  if (!token || !owner || !isAdminSessionOwnerCurrent(owner) || tokenStatus(token) === 'revoked') {
    cancelTokenRevoke()
    return
  }
  const caseId = tokenRevokeCaseId.value.trim()
  const approvalRef = tokenRevokeApprovalRef.value.trim()
  if (!isSafeAuditEvidence(caseId) || !isSafeAuditEvidence(approvalRef)) {
    tokenRevokeErrorVisible.value = true
    focusInvalidTokenRevokeEvidence(isSafeAuditEvidence(caseId) ? 'approval' : 'case')
    return
  }
  if (tokenMutationIds.value.includes(token.id)) return
  tokenMutationIds.value = [...tokenMutationIds.value, token.id]
  try {
    await apiPost({
      action: 'revoke_token',
      token_id: token.id,
      case_id: caseId,
      approval_ref: approvalRef,
    }, owner, async () => {
      if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
      await loadTokens(owner)
      if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
      tokenMutationIds.value = tokenMutationIds.value.filter(id => id !== token.id)
      cancelTokenRevoke()
    })
    if (isAdminSessionOwnerCurrent(owner)) {
      uni.showToast({ title: t('admin.tokenRevoked'), icon: 'success' })
    }
  } catch (err) {
    showAdminRequestError(err, t('admin.toastUpdateFailed'))
  } finally {
    if (isAdminSessionOwnerCurrent(owner)) {
      tokenMutationIds.value = tokenMutationIds.value.filter(id => id !== token.id)
    }
  }
}

async function togglePin(p: PlazaPostRow) {
  const owner = captureAdminSessionOwner()
  if (!owner || plazaWriteBusy.value) return
  const desiredPinned = !p.is_pinned
  pinMutationIds.value = [...pinMutationIds.value, p.id]
  try {
    await apiPost(
      { action: 'set_post_pinned', post_id: p.id, pinned: desiredPinned },
      owner,
      async () => {
        if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
        await loadPlaza(owner)
        if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
      },
    )
  } catch (err: any) {
    showAdminRequestError(err, t('admin.toastLoadFailed'))
    if (isAdminSessionOwnerCurrent(owner)) {
      try { await loadPlaza(owner) } catch {}
    }
  } finally {
    if (isAdminSessionOwnerCurrent(owner)) {
      pinMutationIds.value = pinMutationIds.value.filter(id => id !== p.id)
    }
  }
}

function editBanner(b: BannerRow) {
  if (plazaWriteBusy.value) return
  invalidateAdminRequest('banner-upload')
  bannerUploading.value = false
  bannerForm.value = {
    id: b.id, image_url: b.image_url, original_image_url: b.image_url,
    title_zh: b.title_zh || '', title_en: b.title_en || '',
    target_url: b.target_url || '', priority: String(b.priority),
    // timestamptz → date-only for the <picker mode="date"> value; round-trips
    // back through saveBanner's start/end-of-day expansion.
    start_at: campusDateFromIso(b.start_at),
    end_at: campusDateFromIso(b.end_at),
    is_default: !!b.is_default,
  }
  nextTick(() => {
    try { uni.pageScrollTo({ selector: '.banner-form', duration: 250 }) } catch {}
    setTimeout(() => {
      const form = bannerFormEl.value
      form?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      const first = form?.querySelector<HTMLInputElement>('input')
      ;(first || form)?.focus?.()
    }, 0)
  })
}

function resetBannerForm() {
  invalidateAdminRequest('banner-upload')
  bannerUploading.value = false
  bannerForm.value = emptyBannerForm()
}

function cancelBannerEdit() {
  if (plazaWriteBusy.value) return
  resetBannerForm()
}

function onPickBannerImage() {
  const owner = captureAdminSessionOwner()
  if (!owner || plazaWriteBusy.value) return
  // #ifdef H5
  uni.chooseImage({
    count: 1,
    success: async (res) => {
      const file = (res.tempFiles as File[] | undefined)?.[0]
      if (!file || !isAdminSessionOwnerCurrent(owner)) return
      const request = beginAdminRequest('banner-upload', owner)
      if (!request) return
      bannerUploading.value = true
      try {
        await uploadBannerFile(file, request, (uploadedUrl) => {
          // Applying the URL is part of the durable acknowledgement. If this
          // request lost ownership after the response, leave the resolved
          // tombstone for Owner recovery instead of painting another session.
          if (!isAdminRequestCurrent(request)) throw new AdminSessionChangedError()
          bannerForm.value.image_url = uploadedUrl
        })
      } catch (err: any) {
        if (isAdminRequestCurrent(request)) {
          showAdminRequestError(err, t('admin.toastLoadFailed'))
        }
      } finally {
        if (isAdminRequestCurrent(request)) bannerUploading.value = false
      }
    },
  })
  // #endif
  // #ifndef H5
  uni.showToast({ title: t('admin.bannerUploadH5Only'), icon: 'none' })
  // #endif
}

async function saveBanner() {
  if (plazaWriteBusy.value || !bannerForm.value.image_url) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  bannerSaving.value = true
  try {
    const f = bannerForm.value
    await apiPost({
      action: 'upsert_banner',
      ...(f.id ? { id: f.id } : {}),
      ...(!f.id || f.image_url !== f.original_image_url
        ? { image_url: f.image_url }
        : {}),
      title_zh: f.title_zh || null,
      title_en: f.title_en || null,
      target_url: f.target_url || null,
      priority: parseInt(f.priority, 10) || 0,
      // Date pickers represent UIUC campus days, not UTC days. Resolve both
      // boundaries in America/Chicago so evening banners survive until local
      // midnight across CST, CDT and their transition dates.
      start_at: f.start_at ? campusDateBounds(f.start_at).startIso : null,
      end_at: f.end_at ? campusDateBounds(f.end_at).endIso : null,
      is_default: f.is_default,
      ...(f.id ? {} : { active: true }),
    }, owner, async () => {
      if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
      await loadPlaza(owner)
      if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
      resetBannerForm()
    })
    uni.showToast({ title: t('admin.bannerSaved'), icon: 'success' })
  } catch (err: any) {
    showAdminRequestError(err, t('admin.toastLoadFailed'))
  } finally {
    if (isAdminSessionOwnerCurrent(owner)) bannerSaving.value = false
  }
}

async function toggleBannerActive(b: BannerRow) {
  const owner = captureAdminSessionOwner()
  if (!owner || plazaWriteBusy.value) return
  const desiredActive = !b.active
  bannerMutationIds.value = [...bannerMutationIds.value, b.id]
  try {
    await apiPost(
      { action: 'upsert_banner', id: b.id, active: desiredActive },
      owner,
      async () => {
        if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
        await loadPlaza(owner)
        if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
      },
    )
  } catch (err: any) {
    showAdminRequestError(err, t('admin.toastLoadFailed'))
    if (isAdminSessionOwnerCurrent(owner)) {
      try { await loadPlaza(owner) } catch {}
    }
  } finally {
    if (isAdminSessionOwnerCurrent(owner)) {
      bannerMutationIds.value = bannerMutationIds.value.filter(id => id !== b.id)
    }
  }
}

function deleteBanner(b: BannerRow) {
  const owner = captureAdminSessionOwner()
  if (!owner || plazaWriteBusy.value) return
  uni.showModal({
    title: t('admin.bannerDelete'),
    content: t('admin.bannerDeleteBody'),
    success: async (res) => {
      if (!res.confirm || !isAdminSessionOwnerCurrent(owner)) return
      try {
        await apiPost(
          { action: 'delete_banner', id: b.id },
          owner,
          async () => {
            if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
            await loadPlaza(owner)
            if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
          },
        )
      } catch (err: any) {
        showAdminRequestError(err, t('admin.toastLoadFailed'))
      }
    },
  })
}

async function loadLinked(userId: string) {
  if (linkedFor.value === userId) {
    invalidateAdminRequest('linked-accounts')
    linkedFor.value = null
    linkedAccounts.value = []
    linkedLoading.value = false
    return
  }
  const request = beginAdminRequest('linked-accounts')
  if (!request) return
  const requestIsCurrent = () => isAdminRequestCurrent(request) && linkedFor.value === userId
  linkedFor.value = userId
  linkedLoading.value = true
  linkedAccounts.value = []
  try {
    const rows = await apiGet<LinkedRow[]>({ resource: 'linked_accounts', profile_id: userId }, request)
    if (requestIsCurrent()) linkedAccounts.value = rows
  } catch (err: any) {
    if (requestIsCurrent()) {
      linkedLoading.value = false
      linkedAccounts.value = []
      linkedFor.value = null
      showAdminRequestError(err, t('admin.toastLoadFailed'))
    }
  } finally {
    if (requestIsCurrent()) linkedLoading.value = false
  }
}

const detailOpen = ref(false)
const detailDialogEl = ref<HTMLElement | null>(null)
const detailLoading = ref(false)
const detailKind = ref<'report' | 'suspension' | ''>('')
const detailRow = ref<any>(null)
const detailError = ref(false)
const detailTargetId = ref('')
let detailDialogOpener: HTMLElement | null = null
const detailTitle = computed(() =>
  detailKind.value === 'report' ? t('admin.reportDetail') :
  detailKind.value === 'suspension' ? t('admin.suspensionDetail') : '')

function activeAdminElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

function focusDetailDialog() {
  const dialog = detailDialogEl.value
  if (!dialog || typeof dialog.querySelector !== 'function') return
  const first = dialog.querySelector<HTMLElement>('.detail-close')
  ;(first || dialog).focus()
}

function closeDetail(restoreFocus = true) {
  if (!detailOpen.value) return
  const opener = detailDialogOpener
  invalidateAdminRequest('detail')
  detailOpen.value = false
  detailLoading.value = false
  detailError.value = false
  detailTargetId.value = ''
  detailDialogOpener = null
  if (!restoreFocus || !opener || typeof opener.focus !== 'function') return
  nextTick(() => {
    if (typeof document === 'undefined' || document.contains(opener)) opener.focus()
  })
}

function onDetailDialogKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeDetail()
    return
  }
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget as HTMLElement | null
  if (!dialog || typeof dialog.querySelectorAll !== 'function') return
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    '[role="button"]:not([aria-disabled="true"]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(el => el.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }
  const current = activeAdminElement()
  const index = current ? focusable.indexOf(current) : -1
  if (event.shiftKey && index <= 0) {
    event.preventDefault()
    focusable[focusable.length - 1].focus()
  } else if (!event.shiftKey && (index === -1 || index === focusable.length - 1)) {
    event.preventDefault()
    focusable[0].focus()
  }
}

watch(detailOpen, (open) => {
  if (open) nextTick(focusDetailDialog)
})

function apiBase(): string {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin + '/api/admin'
  }
  // #endif
  return `${BASE_URL}/api/admin`
}

async function readAdminJson<T = any>(response: Response): Promise<T> {
  try {
    return await readBoundedJson<T>(response, {
      maxBytes: MAX_ADMIN_RESPONSE_BYTES,
      timeoutMs: 10_000,
    })
  } catch {
    // Preserve the status-only error for an invalid non-2xx body, but never
    // accept an invalid/oversized success payload as real admin data.
    if (!response.ok) return {} as T
    throw new Error('admin_response_invalid')
  }
}

async function apiGet<T>(
  params: Record<string, string>,
  owner: AdminSessionOwner = requireAdminSessionOwner(false),
): Promise<T> {
  if (!isAdminReadOwnerCurrent(owner)) throw new AdminSessionChangedError()
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  let r: Response
  try {
    r = await platformFetch(`${apiBase()}?${qs}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${owner.key}` },
    })
  } catch (err) {
    if (!isAdminReadOwnerCurrent(owner)) throw new AdminSessionChangedError()
    throw err
  }
  if (!isAdminReadOwnerCurrent(owner)) throw new AdminSessionChangedError()
  if (r.status === 401) {
    if (unlocked.value) onLogout(owner)
    throw new Error('unauthorized')
  }
  let json: any
  try {
    json = await readAdminJson<any>(r)
  } catch (err) {
    if (!isAdminReadOwnerCurrent(owner)) throw new AdminSessionChangedError()
    throw err
  }
  if (!isAdminReadOwnerCurrent(owner)) throw new AdminSessionChangedError()
  if (!r.ok) throw new Error(json?.error || `http_${r.status}`)
  return json.data as T
}

type AdminMutationJournalHandle = Awaited<ReturnType<typeof reserveAdminIdempotencyKey>>

interface AdminMutationReceipt<T> {
  result: T
  journalHandle: AdminMutationJournalHandle
}

// These responses are generated before a business mutation can commit, or by
// a transaction that rolled back atomically. Anything outside this exact list
// is outcome-unknown even if a provider happens to use a 4xx status.
const DEFINITIVE_ADMIN_NO_COMMIT_ERRORS = new Set([
  'admin_capability_denied',
  'admin_mutation_conflict',
  'admin_mutation_invalid',
  'admin_mutation_not_found',
  'bad_json',
  'bad_multipart',
  'body_too_large',
  'content_length_required',
  'invalid_active',
  'invalid_approval_ref',
  'invalid_case_id',
  'invalid_category',
  'invalid_content_length',
  'invalid_default',
  'invalid_expiry',
  'invalid_hours',
  'invalid_id',
  'invalid_idempotency_key',
  'invalid_image',
  'invalid_image_dimensions',
  'invalid_image_url',
  'invalid_level',
  'invalid_priority',
  'invalid_reason',
  'invalid_role',
  'invalid_schedule',
  'invalid_status',
  'invalid_target_type',
  'invalid_target_url',
  'invalid_title',
  'invalid_token_hash',
  'missing_action',
  'missing_args',
  'missing_file',
  'missing_image_url',
  'rate_limited',
  'request_timeout',
  'too_large',
  'unknown_action',
  'unsupported_type',
])

async function acknowledgeAdminMutationReceipts<T>(
  owner: AdminSessionOwner,
  receipts: AdminMutationReceipt<T>[],
  applyDefinitiveResults: (results: T[]) => void | Promise<void>,
): Promise<void> {
  try {
    if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
    await applyDefinitiveResults(receipts.map(receipt => receipt.result))
    if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
  } catch (err) {
    // A definitive response is not enough to erase crash-recovery evidence:
    // the caller must first apply or authoritatively reload the affected UI.
    if (isAdminSessionOwnerCurrent(owner, false)) lockAdminAfterReplayedOutcome(owner)
    throw err
  }

  for (const receipt of receipts) {
    const acknowledged = await runAdminJournalStep(
      owner,
      () => consumeResolvedAdminIdempotencyKey(receipt.journalHandle),
    )
    if (!acknowledged) lockAdminAfterUnknownOutcome(owner)
  }
}

async function apiPost<T>(
  body: Record<string, any>,
  owner: AdminSessionOwner,
  applyDefinitiveResult: (result: T) => void | Promise<void>,
): Promise<T> {
  if (!adminWritesReady.value) throw new Error('admin_reconciliation_required')
  if (!tabReadIsAuthoritative(activeTab.value)) throw new Error('admin_read_stale')
  if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
  const journalHandle = await runAdminJournalStep(owner, () => reserveAdminIdempotencyKey(
    'mutation', owner.key, canonicalAdminMutation(body),
  ))
  if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
  return withAdminIdempotencyRequestLock(async () => {
    const receipt = await apiPostLocked<T>(body, owner, journalHandle)
    await acknowledgeAdminMutationReceipts(owner, [receipt], async ([result]) => {
      await applyDefinitiveResult(result)
    })
    return receipt.result
  })
}

async function apiPostBatch<T>(
  bodies: Record<string, any>[],
  owner: AdminSessionOwner,
  applyDefinitiveResults: (outcomes: PromiseSettledResult<T>[]) => void | Promise<void>,
): Promise<PromiseSettledResult<T>[]> {
  if (!adminWritesReady.value) throw new Error('admin_reconciliation_required')
  if (!tabReadIsAuthoritative(activeTab.value)) throw new Error('admin_read_stale')
  if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()

  const entries: Array<{ body: Record<string, any>; journalHandle: AdminMutationJournalHandle }> = []
  for (const body of bodies) {
    if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
    const journalHandle = await runAdminJournalStep(owner, () => reserveAdminIdempotencyKey(
      'mutation', owner.key, canonicalAdminMutation(body),
    ))
    entries.push({ body, journalHandle })
  }

  return withAdminIdempotencyRequestLock(async () => {
    const outcomes: PromiseSettledResult<T>[] = []
    const receipts: AdminMutationReceipt<T>[] = []
    for (const entry of entries) {
      try {
        const receipt = await apiPostLocked<T>(
          entry.body,
          owner,
          entry.journalHandle,
          receipts.map(previous => previous.journalHandle),
        )
        receipts.push(receipt)
        outcomes.push({ status: 'fulfilled', value: receipt.result })
      } catch (reason) {
        // Unknown outcomes and journal failures lock the session. Stop instead
        // of dispatching the rest of a destructive batch under stale state.
        if (!isAdminSessionOwnerCurrent(owner, false)) throw reason
        outcomes.push({ status: 'rejected', reason })
      }
    }
    await acknowledgeAdminMutationReceipts(owner, receipts, async () => {
      await applyDefinitiveResults(outcomes)
    })
    return outcomes
  })
}

async function apiPostLocked<T>(
  body: Record<string, any>,
  owner: AdminSessionOwner,
  journalHandle: AdminMutationJournalHandle,
  allowedBatchReceipts: readonly AdminMutationJournalHandle[] = [],
): Promise<AdminMutationReceipt<T>> {
  if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
  if (await runAdminJournalStep(owner, () => isAdminIdempotencyResolvedOrSuperseded(journalHandle))) {
    lockAdminAfterReplayedOutcome(owner)
  }
  if (await runAdminJournalStep(owner, () => (
    hasOtherAdminIdempotencyUnacknowledgedOutcome(journalHandle, allowedBatchReceipts)
  ))) {
    lockAdminAfterUnknownOutcome(owner)
  }
  if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
  const replayingUnknown = await runAdminJournalStep(
    owner,
    () => markAdminIdempotencyDispatchStarted(journalHandle),
  )
  if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
  const idempotencyKey = journalHandle.idempotencyKey
  let sawOutcomeUnknown = replayingUnknown

  // Retry once with the SAME key. A timeout after PostgreSQL committed is not
  // evidence of failure; the atomic RPC will replay the stored result rather
  // than applying a ban, report change, or banner write twice.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let r: Response
    try {
      r = await platformFetch(apiBase(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          Authorization: `Bearer ${owner.key}`,
        },
        body: JSON.stringify(body),
      })
    } catch {
      if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
      sawOutcomeUnknown = true
      if (attempt === 0) continue
      return lockAdminAfterUnknownOutcome(owner)
    }
    if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
    if (r.status === 401) {
      if (sawOutcomeUnknown) return lockAdminAfterUnknownOutcome(owner)
      await runAdminJournalStep(owner, () => releaseAdminIdempotencyKey(journalHandle))
      await runAdminJournalStep(owner, () => consumeResolvedAdminIdempotencyKey(journalHandle))
      if (unlocked.value) onLogout(owner)
      throw new Error('unauthorized')
    }

    let json: any
    try {
      json = await readAdminJson<any>(r)
    } catch {
      if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
      sawOutcomeUnknown = true
      if (attempt === 0) continue
      return lockAdminAfterUnknownOutcome(owner)
    }
    if (!isAdminSessionOwnerCurrent(owner, false)) throw new AdminSessionChangedError()
    if (r.ok) {
      await runAdminJournalStep(owner, () => releaseAdminIdempotencyKey(journalHandle))
      if (replayingUnknown) {
        lockAdminAfterReplayedOutcome(owner)
      }
      return { result: json as T, journalHandle }
    }

    const errorCode = typeof json?.error === 'string' ? json.error : `http_${r.status}`
    if (r.status >= 500) {
      sawOutcomeUnknown = true
      if (attempt === 0) continue
      // Keep the durable key so a later unlock/manual retry of the same
      // logical action can reconcile the unknown result.
      return lockAdminAfterUnknownOutcome(owner)
    }
    if (sawOutcomeUnknown) return lockAdminAfterUnknownOutcome(owner)
    if (!DEFINITIVE_ADMIN_NO_COMMIT_ERRORS.has(errorCode)) {
      return lockAdminAfterUnknownOutcome(owner)
    }
    await runAdminJournalStep(owner, () => releaseAdminIdempotencyKey(journalHandle))
    const acknowledged = await runAdminJournalStep(
      owner,
      () => consumeResolvedAdminIdempotencyKey(journalHandle),
    )
    if (!acknowledged) lockAdminAfterUnknownOutcome(owner)
    throw new Error(errorCode)
  }
  return lockAdminAfterUnknownOutcome(owner)
}

type AdminIdempotencyOutcomeStatus = 'completed' | 'running' | 'not_dispatched'

function applyAdminRecoverySnapshot(
  snapshot: Awaited<ReturnType<typeof inspectAdminIdempotencyRecovery>>,
) {
  adminRecoveryResolvedCount.value = snapshot.resolvedCount
  adminRecoveryUnknownCount.value = snapshot.unknown.length
}

async function reconcileAdminOutcomeJournal(owner: AdminSessionOwner) {
  await withAdminIdempotencyRequestLock(async () => {
    if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
    await runAdminJournalStep(owner, () => discardUndispatchedAdminIdempotencyEntries())
    let snapshot = await runAdminJournalStep(owner, () => inspectAdminIdempotencyRecovery())
    if (isAdminSessionOwnerCurrent(owner)) applyAdminRecoverySnapshot(snapshot)

    if (snapshot.unknown.length > 0 && whoami.value?.role === 'owner') {
      for (const entry of snapshot.unknown) {
        if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
        const outcome = await apiGet<{ status: AdminIdempotencyOutcomeStatus }>({
          resource: 'idempotency_reconciliation',
          idempotency_key: entry.idempotencyKey,
        }, owner)
        if (
          !outcome
          || !['completed', 'running', 'not_dispatched'].includes(outcome.status)
        ) throw new Error('admin_response_invalid')
        // `not_dispatched` is authoritative only because the database RPC
        // installs a durable fence that rejects any late ledger insert using
        // this UUID. A plain absence result must never reach this branch.
        if (outcome.status === 'completed' || outcome.status === 'not_dispatched') {
          await runAdminJournalStep(owner, () => releaseAdminIdempotencyKey(entry))
        }
      }
      snapshot = await runAdminJournalStep(owner, () => inspectAdminIdempotencyRecovery())
      if (isAdminSessionOwnerCurrent(owner)) applyAdminRecoverySnapshot(snapshot)
    }
  })
}

async function strictReloadAdminState(owner: AdminSessionOwner) {
  if (whoami.value?.role === 'owner') {
    const [
      nextStats,
      nextReports,
      nextSuspensions,
      nextAppeals,
      nextWarnings,
      nextAudit,
      nextPosts,
      nextBanners,
      nextInventory,
    ] = await Promise.all([
      apiGet<StatsRow>({ resource: 'stats' }, owner),
      apiGet<ReportGroup[]>({
        resource: 'reports_grouped', limit: '200', offset: '0', pending: '0',
      }, owner),
      apiGet<SuspensionRow[]>({ resource: 'suspensions', limit: '200', offset: '0' }, owner),
      apiGet<AppealRow[]>({ resource: 'appeals', limit: '200', offset: '0' }, owner),
      apiGet<WarningRow[]>({ resource: 'warnings', limit: '200', offset: '0' }, owner),
      apiGet<AuditRow[]>({ resource: 'audit', limit: '200', offset: '0' }, owner),
      apiGet<PlazaPostRow[]>({ resource: 'plaza_posts', limit: '200', offset: '0' }, owner),
      apiGet<BannerRow[]>({ resource: 'banners' }, owner),
      apiGet<AdminTokenInventory>({ resource: 'tokens' }, owner),
    ])
    if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
    stats.value = nextStats
    reportGroups.value = reportPendingOnly.value
      ? nextReports.filter(group => group.pending_count > 0)
      : nextReports
    reportHasMore.value = false
    suspensions.value = nextSuspensions
    appeals.value = nextAppeals
    warnings.value = nextWarnings
    auditLog.value = nextAudit
    plazaPosts.value = nextPosts
    banners.value = nextBanners
    adminTokens.value = Array.isArray(nextInventory?.tokens) ? nextInventory.tokens : []
    ownerRecovery.value = nextInventory?.owner_recovery || null
    return
  }
  await Promise.all([
    loadTab(activeTab.value, owner, true),
    ...(canReadModeration.value ? [loadStats(owner, true)] : []),
    ...(canReadTokens.value && activeTab.value !== 'tokens' ? [loadTokens(owner)] : []),
  ])
  if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
}

async function finishAdminRecovery(owner: AdminSessionOwner, acknowledgeResolved: boolean) {
  await withAdminIdempotencyRequestLock(async () => {
    if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
    const before = await runAdminJournalStep(owner, () => inspectAdminIdempotencyRecovery())
    if (before.unknown.length > 0) throw new Error('admin_reconciliation_required')
    if (before.resolvedCount > 0 && !acknowledgeResolved) {
      throw new Error('admin_reconciliation_required')
    }

    // Keep writes disabled while an authoritative read is made. Only the
    // explicit acknowledgement path may remove definitive tombstones, and it
    // does so after the read succeeds—not merely because credentials passed.
    await strictReloadAdminState(owner)
    if (acknowledgeResolved) {
      await runAdminJournalStep(owner, () => clearResolvedAdminIdempotencyEntries())
    }
    await runAdminJournalStep(owner, () => discardUndispatchedAdminIdempotencyEntries())
    const after = await runAdminJournalStep(owner, () => inspectAdminIdempotencyRecovery())
    if (after.resolvedCount > 0 || after.unknown.length > 0) {
      applyAdminRecoverySnapshot(after)
      throw new Error('admin_reconciliation_required')
    }
    applyAdminRecoverySnapshot(after)
  })
  if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
  adminRecoveryError.value = false
  adminWritesReady.value = true
}

async function retryAdminOutcomeRecovery() {
  if (adminRecoveryBusy.value) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  adminRecoveryBusy.value = true
  adminRecoveryError.value = false
  try {
    await reconcileAdminOutcomeJournal(owner)
    if (
      isAdminSessionOwnerCurrent(owner)
      && adminRecoveryUnknownCount.value === 0
      && adminRecoveryResolvedCount.value === 0
    ) await finishAdminRecovery(owner, false)
  } catch (err) {
    if (isAdminSessionOwnerCurrent(owner)) {
      adminRecoveryError.value = true
      showAdminRequestError(err, t('admin.outcomeRecoveryFailed'))
    }
  } finally {
    if (isAdminSessionOwnerCurrent(owner)) adminRecoveryBusy.value = false
  }
}

async function acknowledgeAdminOutcomes() {
  if (
    adminRecoveryBusy.value
    || adminRecoveryUnknownCount.value > 0
    || whoami.value?.role !== 'owner'
  ) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  adminRecoveryBusy.value = true
  adminRecoveryError.value = false
  try {
    await finishAdminRecovery(owner, true)
    if (isAdminSessionOwnerCurrent(owner)) {
      uni.showToast({ title: t('admin.outcomeRecoveryReady'), icon: 'success' })
    }
  } catch (err) {
    if (isAdminSessionOwnerCurrent(owner)) {
      adminRecoveryError.value = true
      showAdminRequestError(err, t('admin.outcomeRecoveryFailed'))
    }
  } finally {
    if (isAdminSessionOwnerCurrent(owner)) adminRecoveryBusy.value = false
  }
}

async function onUnlock() {
  if (checking.value) return
  const candidate = keyInput.value.trim()
  if (!ADMIN_TOKEN_PATTERN.test(candidate)) {
    gateError.value = t('admin.errWrongKey')
    return
  }
  checking.value = true
  const unlockAttempt = ++adminUnlockAttemptEpoch
  gateError.value = ''
  adminSessionEpoch += 1
  adminKey.value = candidate
  // Once submitted, keep the token only in the short-lived session owner.
  // Leaving it in the password input exposes the full value to DOM/accessibility
  // inspection after an unsuccessful unlock.
  keyInput.value = ''
  unlocked.value = false
  resetAdminPrivateState()
  const owner = requireAdminSessionOwner(false)
  try {
    const identity = await apiGet<WhoAmI>({ resource: 'whoami' }, owner)
    if (!isAdminSessionOwnerCurrent(owner, false)) return
    if (!isAdminRole(identity?.role) || !Array.isArray(identity?.capabilities)) {
      throw new Error('invalid_admin_authorization')
    }
    whoami.value = identity
    const firstAllowedTab = tabList.value[0]?.id
    if (!firstAllowedTab) throw new Error('admin_capability_denied')
    if (!tabList.value.some(tab => tab.id === activeTab.value)) activeTab.value = firstAllowedTab
    unlocked.value = true
    adminWritesReady.value = false
    adminRecoveryError.value = false
    try {
      await reconcileAdminOutcomeJournal(owner)
    } catch (recoveryError) {
      if (!isAdminSessionOwnerCurrent(owner)) return
      adminRecoveryError.value = true
      showAdminRequestError(recoveryError, t('admin.outcomeRecoveryFailed'))
    }
    if (!isAdminSessionOwnerCurrent(owner)) return
    await Promise.all([
      loadTab(activeTab.value, owner),
      ...(canReadModeration.value ? [loadStats(owner)] : []),
      ...(canReadTokens.value && activeTab.value !== 'tokens'
        ? [loadTokens(owner).catch(err => showAdminRequestError(err, t('admin.toastLoadFailed')))]
        : []),
    ])
    if (!isAdminSessionOwnerCurrent(owner)) return
    if (!adminRecoveryVisible.value) adminWritesReady.value = true
  } catch (err: any) {
    if (!isAdminSessionOwnerCurrent(owner, false)) return
    gateError.value = err?.message === 'unauthorized'
      ? t('admin.errWrongKey')
      : t('admin.errUnlockFailed')
    adminSessionEpoch += 1
    adminKey.value = ''
    unlocked.value = false
    resetAdminPrivateState()
  } finally {
    if (unlockAttempt === adminUnlockAttemptEpoch) checking.value = false
  }
}

function resetAdminPrivateState() {
  invalidateAllAdminRequests()
  adminWritesReady.value = false
  adminRecoveryResolvedCount.value = 0
  adminRecoveryUnknownCount.value = 0
  adminRecoveryBusy.value = false
  adminRecoveryError.value = false
  whoami.value = null
  tabReadStates.value = {
    reports: newAdminReadState(),
    users: newAdminReadState(),
    plaza: newAdminReadState(),
    suspensions: newAdminReadState(),
    appeals: newAdminReadState(),
    warnings: newAdminReadState(),
    audit: newAdminReadState(),
    tokens: newAdminReadState(),
  }
  statsReadState.value = newAdminReadState()
  stats.value = null
  reports.value = []
  reportGroups.value = []
  reportOffset.value = 0
  reportHasMore.value = false
  reportLoadingMore.value = false
  selectMode.value = false
  selectedKeys.value = []
  bulkResolving.value = false
  suspensions.value = []
  appeals.value = []
  warnings.value = []
  auditLog.value = []
  listOffsets.value = { suspensions: 0, appeals: 0, warnings: 0, audit: 0 }
  listHasMore.value = { suspensions: false, appeals: false, warnings: false, audit: false }
  resetListLoadingMore()
  adminTokens.value = []
  ownerRecovery.value = null
  tokenMutationIds.value = []
  tokenRevokeTarget.value = null
  tokenRevokeCaseId.value = ''
  tokenRevokeApprovalRef.value = ''
  tokenRevokeErrorVisible.value = false
  tokenRevokeFocusField.value = null
  tokenRevokeOwner = null
  tokenRevokeOpener = null
  suspensionQuery.value = ''
  userResults.value = []
  userQuery.value = ''
  userSearched.value = false
  userSearching.value = false
  userSearchError.value = false
  appliedUserQuery.value = ''
  linkedFor.value = null
  linkedAccounts.value = []
  linkedLoading.value = false
  plazaPosts.value = []
  banners.value = []
  plazaOffsets.value = { posts: 0, banners: 0 }
  plazaPostsHasMore.value = false
  bannerHasMore.value = false
  resetPlazaLoadingMore()
  bannerSaving.value = false
  bannerUploading.value = false
  pinMutationIds.value = []
  bannerMutationIds.value = []
  detailOpen.value = false
  detailLoading.value = false
  detailKind.value = ''
  detailRow.value = null
  detailError.value = false
  detailTargetId.value = ''
  detailDialogOpener = null
  loading.value = false
  resetBannerForm()
}

function onLogout(expectedOwner?: AdminSessionOwner): boolean {
  if (expectedOwner && !isAdminSessionOwnerCurrent(expectedOwner, false)) return false
  adminSessionEpoch += 1
  adminUnlockAttemptEpoch += 1
  adminKey.value = ''
  unlocked.value = false
  checking.value = false
  try { uni.hideLoading() } catch {}
  resetAdminPrivateState()
  return true
}

function lockAdminSessionOnLeave() {
  if (unlocked.value || adminKey.value) onLogout()
}

function onAdminVisibilityChange() {
  // H5 can remain mounted while the browser tab/app is backgrounded. Treat
  // that as leaving the privileged surface so a shared device always requires
  // the token again on return.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    lockAdminSessionOnLeave()
  }
}

onHide(lockAdminSessionOnLeave)
onUnload(lockAdminSessionOnLeave)
onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onAdminVisibilityChange)
  }
})
onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onAdminVisibilityChange)
  }
  lockAdminSessionOnLeave()
})

async function loadStats(
  owner = captureAdminSessionOwner(),
  throwOnError = false,
) {
  if (!owner || !canReadModeration.value) return
  const request = beginAdminRequest('stats', owner)
  if (!request) return
  statsReadState.value = { ...statsReadState.value, loading: true }
  try {
    const nextStats = await apiGet<StatsRow>({ resource: 'stats' }, request)
    if (isAdminRequestCurrent(request)) {
      stats.value = nextStats
      statsReadState.value = {
        phase: 'ready', loading: false, stale: false, updatedAt: new Date().toISOString(),
      }
    }
  } catch (err: any) {
    if (isAdminRequestCurrent(request)) {
      const previous = statsReadState.value
      statsReadState.value = {
        ...previous,
        phase: previous.phase === 'ready' ? 'ready' : 'error',
        loading: false,
        stale: previous.phase === 'ready',
      }
      showAdminRequestError(err, t('admin.toastLoadFailed'))
    }
    if (throwOnError) throw err
  }
}

const REPORTS_PAGE = 50
const reportOffset = ref(0)

async function loadReports(
  reset = true,
  request = beginAdminRequest('reports'),
) {
  if (!request) return
  const pendingOnly = reportPendingOnly.value
  beginTabRead('reports')
  if (reset) reportLoadingMore.value = false
  const offset = reset ? 0 : reportOffset.value
  try {
    const page = (await apiGet<ReportGroup[]>({
      resource: 'reports_grouped',
      limit: String(REPORTS_PAGE + 1),
      offset: String(offset),
      pending: pendingOnly ? '1' : '0',
    }, request)) || []
    if (!isAdminRequestCurrent(request) || reportPendingOnly.value !== pendingOnly) return
    const visible = page.slice(0, REPORTS_PAGE)
    reportGroups.value = reset
      ? visible
      : appendUniqueBy(reportGroups.value, visible, row => `${row.target_type}:${row.target_id}`)
    reportOffset.value = offset + visible.length
    reportHasMore.value = page.length > REPORTS_PAGE
    completeTabRead('reports')
  } catch (err) {
    if (isAdminRequestCurrent(request) && reportPendingOnly.value === pendingOnly) failTabRead('reports')
    throw err
  }
}

async function loadMoreReports() {
  if (reportLoadingMore.value || !reportHasMore.value) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  const request = beginAdminRequest('reports', owner)
  if (!request) return
  reportLoadingMore.value = true
  try {
    await loadReports(false, request)
  } catch (err: any) {
    if (isAdminRequestCurrent(request)) showAdminRequestError(err, t('admin.toastLoadFailed'))
  } finally {
    if (isAdminRequestCurrent(request)) reportLoadingMore.value = false
  }
}

async function setReportFilter(pendingOnly: boolean) {
  if (reportPendingOnly.value === pendingOnly) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  reportPendingOnly.value = pendingOnly
  reportGroups.value = []
  reportHasMore.value = false
  updateTabReadState('reports', newAdminReadState())
  const request = beginAdminRequest('reports', owner)
  if (!request) return
  selectMode.value = false
  selectedKeys.value = []
  loading.value = true
  try {
    await loadReports(true, request)
  } catch (err: any) {
    if (isAdminRequestCurrent(request)) showAdminRequestError(err, t('admin.toastLoadFailed'))
  } finally {
    if (isAdminRequestCurrent(request)) loading.value = false
  }
}

const ADMIN_LIST_PAGE = 50

function adminListRows(tab: PagedAdminTab): any[] {
  if (tab === 'suspensions') return suspensions.value
  if (tab === 'appeals') return appeals.value
  if (tab === 'warnings') return warnings.value
  return auditLog.value
}

function applyAdminListRows(tab: PagedAdminTab, rows: any[]) {
  if (tab === 'suspensions') suspensions.value = rows as SuspensionRow[]
  else if (tab === 'appeals') appeals.value = rows as AppealRow[]
  else if (tab === 'warnings') warnings.value = rows as WarningRow[]
  else auditLog.value = rows as AuditRow[]
}

function adminListKey(tab: PagedAdminTab, row: any): string {
  if (tab === 'warnings') return String(row?.profile_id || '')
  return String(row?.id ?? '')
}

function resetListLoadingMore() {
  listLoadingMoreEpoch += 1
  listLoadingMore.value = false
}

async function loadPagedAdminTab(
  tab: PagedAdminTab,
  reset: boolean,
  request: AdminRequestOwner,
) {
  if (reset) resetListLoadingMore()
  beginTabRead(tab)
  const current = adminListRows(tab)
  try {
    const page = await apiGet<any[]>({
      resource: tab,
      limit: String(ADMIN_LIST_PAGE + 1),
      offset: String(reset ? 0 : listOffsets.value[tab]),
    }, request)
    if (!isAdminRequestCurrent(request)) return
    const visible = page.slice(0, ADMIN_LIST_PAGE)
    applyAdminListRows(tab, reset
      ? visible
      : appendUniqueBy(current, visible, row => adminListKey(tab, row)))
    listOffsets.value = {
      ...listOffsets.value,
      [tab]: (reset ? 0 : listOffsets.value[tab]) + visible.length,
    }
    listHasMore.value = { ...listHasMore.value, [tab]: page.length > ADMIN_LIST_PAGE }
    completeTabRead(tab)
  } catch (err) {
    if (isAdminRequestCurrent(request)) failTabRead(tab)
    throw err
  }
}

async function loadMoreAdminList(tab: PagedAdminTab) {
  if (listLoadingMore.value || !listHasMore.value[tab] || activeTab.value !== tab) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  const request = beginAdminRequest('tab-load', owner)
  if (!request) return
  const busyEpoch = ++listLoadingMoreEpoch
  listLoadingMore.value = true
  try {
    await loadPagedAdminTab(tab, false, request)
  } catch (err) {
    if (isAdminRequestCurrent(request)) showAdminRequestError(err, t('admin.toastLoadFailed'))
  } finally {
    if (listLoadingMoreEpoch === busyEpoch) listLoadingMore.value = false
  }
}

async function loadTab(
  tab: TabId,
  owner = captureAdminSessionOwner(),
  throwOnError = false,
) {
  if (!owner || !tabList.value.some(candidate => candidate.id === tab)) return
  const tabRequest = beginAdminRequest('tab-load', owner)
  if (!tabRequest) return
  const reportsRequest = tab === 'reports' ? beginAdminRequest('reports', tabRequest) : null
  if (tab === 'reports' && !reportsRequest) return
  const prior = tabReadStates.value[tab]
  loading.value = prior.phase === 'idle'
  if (tab === 'users') beginTabRead('users')
  try {
    if (tab === 'reports') {
      await loadReports(true, reportsRequest)
    } else if (tab === 'plaza') {
      await loadPlaza(tabRequest)
    } else if (tab === 'suspensions' || tab === 'appeals' || tab === 'warnings' || tab === 'audit') {
      await loadPagedAdminTab(tab, true, tabRequest)
    } else if (tab === 'tokens') {
      await loadTokens(tabRequest)
    } else if (tab === 'users') {
      if (isAdminRequestCurrent(tabRequest)) completeTabRead('users')
    }
  } catch (err: any) {
    if (isAdminRequestCurrent(tabRequest) && tabReadStates.value[tab].loading) failTabRead(tab)
    if (throwOnError) throw err
    if (isAdminRequestCurrent(tabRequest) && (tab !== 'reports' || isAdminRequestCurrent(reportsRequest))) {
      showAdminRequestError(err, t('admin.toastLoadFailed'))
    }
  } finally {
    if (isAdminRequestCurrent(tabRequest)) loading.value = false
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
  const owner = captureAdminSessionOwner()
  if (!owner || !tabList.value.some(tab => tab.id === id)) return
  if (id !== 'reports') {
    invalidateAdminRequest('reports')
    reportLoadingMore.value = false
  }
  resetListLoadingMore()
  resetPlazaLoadingMore()
  activeTab.value = id
  await loadTab(id, owner)
}

async function refreshAll() {
  if (loading.value) return
  const owner = captureAdminSessionOwner()
  if (!owner) return
  await Promise.all([
    loadTab(activeTab.value, owner),
    ...(canReadModeration.value ? [loadStats(owner)] : []),
    ...(canReadTokens.value && activeTab.value !== 'tokens'
      ? [loadTokens(owner).catch(err => showAdminRequestError(err, t('admin.toastLoadFailed')))]
      : []),
  ])
}

async function loadAdminDetail(
  kind: 'report' | 'suspension',
  id: string,
  captureOpener = true,
) {
  const request = beginAdminRequest('detail')
  if (!request) return
  const requestIsCurrent = () => isAdminRequestCurrent(request)
    && detailOpen.value
    && detailKind.value === kind
    && detailTargetId.value === id
  if (captureOpener) detailDialogOpener = activeAdminElement()
  detailKind.value = kind
  detailTargetId.value = id
  detailRow.value = null
  detailError.value = false
  detailLoading.value = true
  detailOpen.value = true
  try {
    const row = await apiGet<any>({ resource: kind, id }, request)
    if (!row || typeof row !== 'object') throw new Error('admin_detail_not_found')
    if (requestIsCurrent()) detailRow.value = row
  } catch (err: any) {
    if (requestIsCurrent()) {
      detailError.value = true
      showAdminRequestError(err, t('admin.toastLoadFailed'))
    }
  } finally {
    if (requestIsCurrent()) detailLoading.value = false
  }
}

function retryDetail() {
  if (!detailKind.value || !detailTargetId.value || detailLoading.value) return
  void loadAdminDetail(detailKind.value, detailTargetId.value, false)
}

async function openReportById(id: string) {
  await loadAdminDetail('report', id)
}
function openReport(r: ReportRow) { return openReportById(r.id) }

/* gaps-2: close ALL pending sibling reports on a target in one action,
   behind a confirm (it can touch many rows). */
const selectMode = ref(false)
const selectedKeys = ref<string[]>([])
const bulkResolving = ref(false)
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
  const owner = captureAdminSessionOwner()
  if (!owner || bulkResolving.value) return
  const groups = reportGroups.value.filter(g => isSelected(g) && g.pending_count > 0)
  if (!groups.length) return
  const total = groups.reduce((s, g) => s + g.pending_count, 0)
  uni.showModal({
    title: status === 'resolved' ? t('admin.resolveAllConfirmTitle') : t('admin.dismissAllConfirmTitle'),
    content: t('admin.bulkConfirmBody', { groups: groups.length, n: total }),
    confirmText: status === 'resolved' ? t('admin.resolve') : t('admin.dismiss'),
    success: async (r) => {
      if (!r.confirm || !isAdminSessionOwnerCurrent(owner) || bulkResolving.value) return
      bulkResolving.value = true
      uni.showLoading({ title: t('admin.loading'), mask: true })
      try {
        const outcomes = await apiPostBatch(groups.map(g => ({
          action: 'resolve_target_reports',
          target_type: g.target_type,
          target_id: g.target_id,
          status,
        })), owner, async () => {
          if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
          await Promise.all([loadTab('reports', owner, true), loadStats(owner, true)])
          if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
        })
        const failed = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed.length > 0) {
          selectedKeys.value = selectedKeys.value.filter(key =>
            reportGroups.value.some(group => gKey(group) === key && group.pending_count > 0))
          selectMode.value = selectedKeys.value.length > 0
          showAdminRequestError(failed[0].reason, t('admin.toastUpdateFailed'))
        } else {
          uni.showToast({ title: t('admin.toastUpdated'), icon: 'success' })
          selectMode.value = false
          selectedKeys.value = []
        }
      } catch (err: any) {
        showAdminRequestError(err, t('admin.toastUpdateFailed'))
      } finally {
        if (isAdminSessionOwnerCurrent(owner)) {
          bulkResolving.value = false
          uni.hideLoading()
        }
      }
    },
  })
}

function resolveTargetReports(g: ReportGroup, status: 'resolved' | 'dismissed') {
  const owner = captureAdminSessionOwner()
  if (!owner) return
  uni.showModal({
    title: status === 'resolved' ? t('admin.resolveAllConfirmTitle') : t('admin.dismissAllConfirmTitle'),
    content: t('admin.resolveAllConfirmBody', { n: g.pending_count }),
    confirmText: status === 'resolved' ? t('admin.resolve') : t('admin.dismiss'),
    success: async (r) => {
      if (!r.confirm || !isAdminSessionOwnerCurrent(owner)) return
      try {
        await apiPost({
          action: 'resolve_target_reports',
          target_type: g.target_type,
          target_id: g.target_id,
          status,
        }, owner, async () => {
          if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
          await Promise.all([loadTab('reports', owner, true), loadStats(owner, true)])
          if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
        })
        if (isAdminSessionOwnerCurrent(owner)) {
          uni.showToast({ title: t('admin.toastUpdated'), icon: 'success' })
        }
      } catch (err: any) {
        showAdminRequestError(err, t('admin.toastUpdateFailed'))
      }
    },
  })
}

async function openSuspension(s: SuspensionRow | AppealRow) {
  await loadAdminDetail('suspension', s.id)
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
  closeDetail(false)
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
  const owner = captureAdminSessionOwner()
  if (!owner) return
  uni.showModal({
    title: t('admin.takedownConfirmTitle'),
    content: t('admin.takedownConfirmBody'),
    confirmText: t('admin.takedownConfirm'),
    confirmColor: '#c0392b',
    success: async (r) => {
      if (!r.confirm || !isAdminSessionOwnerCurrent(owner)) return
      try {
        await apiPost({
          action: 'takedown_content',
          target_type: row.target_type,
          target_id: row.target_id,
          reason: 'admin takedown',
        }, owner, async () => {
          if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
          closeDetail()
          await Promise.all([loadTab(activeTab.value, owner, true), loadStats(owner, true)])
          if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
        })
        if (isAdminSessionOwnerCurrent(owner)) {
          uni.showToast({ title: t('admin.toastTakedownDone'), icon: 'success' })
        }
      } catch (err: any) {
        showAdminRequestError(err, t('admin.toastTakedownFailed'))
      }
    },
  })
}

function openUser(userId: string) {
  if (!userId) return
  closeDetail(false)
  uni.navigateTo({ url: `/pages/seller/index?id=${userId}` })
}

function onLiftSuspension(s: { id: string }) {
  const owner = captureAdminSessionOwner()
  if (!owner) return
  uni.showModal({
    title: t('admin.liftConfirmTitle'),
    editable: true,
    placeholderText: t('admin.liftReasonPh'),
    success: async (r) => {
      if (!r.confirm || !isAdminSessionOwnerCurrent(owner)) return
      const reason = (r.content || '').trim() || t('admin.adminReview')
      try {
        await apiPost(
          { action: 'lift_suspension', suspension_id: s.id, reason },
          owner,
          async () => {
            if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
            closeDetail()
            await Promise.all([loadTab(activeTab.value, owner, true), loadStats(owner, true)])
            if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
          },
        )
        if (isAdminSessionOwnerCurrent(owner)) {
          uni.showToast({ title: t('admin.toastLifted'), icon: 'success' })
        }
      } catch (err: any) {
        showAdminRequestError(err, t('admin.toastLiftFailed'))
      }
    },
  })
}

function onBanPrompt(targetId: string, nickname?: string) {
  const owner = captureAdminSessionOwner()
  if (!owner) return
  uni.showActionSheet({
    itemList: [
      t('admin.banL1'),
      t('admin.banL2'),
      t('admin.banL3'),
      t('admin.banL4'),
      t('admin.banL5'),
    ],
    success: (a) => {
      if (!isAdminSessionOwnerCurrent(owner)) return
      const level = a.tapIndex + 1
      uni.showModal({
        title: t('admin.banConfirmTitle', { name: nickname || targetId }),
        editable: true,
        placeholderText: t('admin.banReasonPh'),
        success: async (r) => {
          if (!r.confirm || !isAdminSessionOwnerCurrent(owner)) return
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
            }, owner, async () => {
              if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
              closeDetail()
              await Promise.all([loadTab(activeTab.value, owner, true), loadStats(owner, true)])
              if (!isAdminSessionOwnerCurrent(owner)) throw new AdminSessionChangedError()
            })
            if (isAdminSessionOwnerCurrent(owner)) {
              uni.showToast({ title: t('admin.toastBanApplied'), icon: 'success' })
            }
          } catch (err: any) {
            showAdminRequestError(err, t('admin.toastBanFailed'))
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

</script>

<style lang="scss" scoped>
.admin {
  min-height: 100vh; background: var(--bg-subtle);
  padding: calc(20px + var(--mp-status-bar, env(safe-area-inset-top, 0px))) 16px 40px;
  max-width: 960px; margin: 0 auto;
  font-family: var(--font-hei);
}
.admin [role='button']:focus-visible,
.admin [role='tab']:focus-visible,
.admin [role='checkbox']:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
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
  &.spinning .admin-refresh-icon { animation: admin-spin 0.7s linear infinite; }
}
.admin-refresh-icon { display: flex; align-items: center; justify-content: center; }
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
.admin-recovery-barrier {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--accent-warn);
  border-radius: var(--radius-md);
  background: var(--warning-soft);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
}
.admin-recovery-title { font-weight: 800; }
.admin-recovery-error { color: var(--accent-danger); font-weight: 650; }
.admin-recovery-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
.admin-read-state {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border: 1px solid var(--border-subtle); border-radius: 10px;
  color: var(--text-primary); font-size: 13px; line-height: 1.45;
}
.admin-read-error { background: var(--danger-soft); border-color: var(--accent-danger); }
.admin-read-stale { background: var(--warning-soft); border-color: var(--accent-warn); }
.admin-read-refreshing { background: var(--bg-subtle); color: var(--text-secondary); }
.admin-read-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.admin-read-title { font-weight: 750; color: var(--text-primary); }
.admin-read-time { font-size: 11px; color: var(--text-secondary); }
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
.card-stats { display: flex; align-items: center; gap: 5px; }
.card-stat { display: inline-flex; align-items: center; gap: 2px; }
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
.select-box {
  width: 18px; height: 18px; margin-right: 2px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid var(--campus-blue); border-radius: 4px;
}
.select-box.checked { background: var(--campus-blue); }
.select-box.disabled { border-color: var(--text-faint); opacity: 0.6; }
.card-selected { outline: 2px solid var(--campus-blue); outline-offset: -1px; }
.filter-row { display: flex; gap: 8px; margin-bottom: 8px; }
.plaza-sec-title { font-size: 13px; font-weight: 700; color: var(--text-secondary); margin: 8px 0 2px; }
.banner-thumb { width: 72px; height: 40px; border-radius: 6px; background: var(--bg-inset); flex-shrink: 0; }
.banner-head-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.banner-head-info .card-meta { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.banner-form { gap: 8px; scroll-margin-top: 16px; }
.token-identifiers { display: flex; flex-direction: column; gap: 3px; }
.token-identifier { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 11px; line-height: 1.4; }
.token-identifier-label { flex-shrink: 0; color: var(--text-muted); font-weight: 600; }
.token-identifier-value {
  min-width: 0; color: var(--text-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums; overflow-wrap: anywhere; word-break: break-all; user-select: text;
}
.token-revoke-evidence {
  display: flex; flex-direction: column; gap: 8px; margin-top: 6px; padding: 12px;
  border: 1px solid var(--line-soft); border-radius: 8px; background: var(--bg-subtle);
}
.token-revoke-title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.token-revoke-target {
  display: flex; flex-direction: column; gap: 4px; padding: 8px;
  border: 1px solid var(--line-soft); border-radius: 6px; background: var(--bg-elev-1);
}
.token-revoke-target-title { font-size: 11px; font-weight: 700; color: var(--text-secondary); }
.token-revoke-hint { font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
.token-revoke-field { display: flex; flex-direction: column; gap: 4px; }
.token-revoke-error { font-size: 12px; color: var(--accent-danger); }
.bf-img-row { display: flex; align-items: center; gap: 10px; }
.bf-preview { width: 120px; height: 48px; border-radius: 8px; background: var(--bg-inset); }
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
.token-role-operator { background: var(--campus-blue-soft); color: var(--campus-blue); }
.token-role-security_admin { background: var(--warning-soft); color: var(--accent-warn); }
.token-role-owner { background: var(--danger-soft); color: var(--accent-danger); }
.owner-recovery {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  font-size: 13px;
  color: var(--text-secondary);
}
.owner-recovery-title { font-weight: 700; color: var(--text-primary); }
.owner-recovery-compact { margin-bottom: 14px; }
.owner-recovery-healthy { background: var(--success-soft); border-color: var(--accent-good); }
.owner-recovery-warning { background: var(--warning-soft); border-color: var(--accent-warn); }
.owner-recovery-critical { background: var(--danger-soft); border-color: var(--accent-danger); color: var(--accent-danger); }
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
  color: var(--text-secondary);
  &:active { background: var(--bg-inset); }
}
.detail-body { flex: 1; padding: 16px 18px 30px; }
.detail-error { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; color: var(--text-primary); }
.d-row { display: block; font-size: 13px; color: var(--text-primary); line-height: 1.6; margin-bottom: 6px; }
.d-key { color: var(--text-secondary); font-weight: 600; }
.d-preview { background: var(--bg-subtle); padding: 8px 10px; border-radius: 6px; margin: 8px 0; font-style: italic; }
.d-thumb { width: 120px; height: 120px; border-radius: 8px; margin: 4px 0 10px; background: var(--bg-inset); cursor: pointer; }
.d-appeal { background: var(--warning-soft); padding: 10px; border-radius: 6px; border-left: 3px solid var(--accent-warn); margin: 10px 0; }
.d-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }

@media (max-width: 600px) {
  .admin { padding-left: 12px; padding-right: 12px; }
  .admin-header { flex-wrap: wrap; }
  .admin-whoami { order: 2; flex-basis: 100%; align-items: flex-start; text-align: left; }
  .admin-whoami-label,
  .admin-whoami-detail { max-width: 100%; }
  .bf-sched { flex-direction: column; }
  .card-title,
  .card-meta,
  .card-note,
  .linked-name,
  .linked-meta,
  .d-row { overflow-wrap: anywhere; word-break: break-word; }
  .admin-refresh,
  .admin-lang,
  .admin-logout,
  .tab,
  .chip,
  .load-more,
  .mini-btn,
  .search-clear,
  .bf-clear {
    min-height: 44px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card-actions > .mini-btn { flex: 1 1 120px; text-align: center; }
  .admin-read-state { align-items: stretch; flex-direction: column; }
  .detail-close { width: 44px; height: 44px; }
  .detail-body { padding-bottom: calc(30px + env(safe-area-inset-bottom, 0px)); }
}
</style>
