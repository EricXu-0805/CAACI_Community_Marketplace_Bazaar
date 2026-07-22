# Admin Dashboard Implementation Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                 Admin Dashboard (uni-app / Vue page)         │
│                  app/src/pages/admin/index.vue               │
└────────────────────────┬────────────────────────────────────┘
                         │ Bearer iam_admin_<per-admin token>
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                Unified Vercel route (/api/admin)             │
│          (Uses SUPABASE_SECRET_KEY)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│       Supabase (server-only privileged API-key access)      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ RPC Functions:                                       │   │
│  │ - admin_list_suspensions()                           │   │
│  │ - admin_list_reports()                               │   │
│  │ - admin_get_suspension_detail()                       │   │
│  │ - apply_ban_level() [existing]                        │   │
│  │ - lift_suspension() [existing]                        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Tables:                                              │   │
│  │ - suspensions (RLS: self-read only)                  │   │
│  │ - reports (RLS: self-read only)                      │   │
│  │ - device_fingerprints (RLS: self-read only)          │   │
│  │ - profiles (RLS: public read, self-write)            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

The dashboard and regular token lifecycle CLIs cross the same authenticated
`/api/admin` boundary with `Authorization: Bearer iam_admin_...`. The deployed
route owns its server-side Supabase credential; `admin-token-mint.mjs` and
`admin-token-revoke.mjs` never accept that credential and never write tables
directly. Initial owner bootstrap is a separate, externally controlled
break-glass gate, not a hidden regular-script path.

The lifecycle database contract is
`supabase/migrations/20260719010000_admin_token_lifecycle_rpc.sql` followed by
the forward-only recovery/concurrency reconciliation in
`supabase/migrations/20260719020000_admin_owner_recovery_concurrency.sql`,
the appeal/session hardening in
`supabase/migrations/20260720035037_harden_admin_appeal_decisions_and_session_metadata.sql`,
and the ordered owner-identity plus invalid-authorization hardening in
`supabase/migrations/20260722145042_harden_last_active_owner_revoke.sql` and
`supabase/migrations/20260722152000_harden_admin_invalid_auth_amplification.sql`,
plus the forward-only presentation-signal trigger repair in
`supabase/migrations/20260722161200_protect_admin_owner_presentation_signal.sql`,
layered after the actor, atomic-mutation, capability, and banner-saga migrations. The
older split-endpoint/SQL snippets below remain design history, not an operator
deployment recipe.

## Step 1: Create Admin RPC Functions

**File**: `supabase/migrations/029_admin_functions.sql`

```sql
-- ============================================
-- 029 Admin Functions for Moderation Dashboard
-- ============================================

-- 1. List all suspensions (paginated)
CREATE OR REPLACE FUNCTION public.admin_list_suspensions(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  level smallint,
  reason text,
  category text,
  started_at timestamptz,
  ends_at timestamptz,
  lifted_at timestamptz,
  appeal_note text,
  created_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    s.id, s.profile_id, p.nickname, p.avatar_url,
    s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at, s.appeal_note,
    s.created_at
  FROM public.suspensions s
  JOIN public.profiles p ON p.id = s.profile_id
  ORDER BY s.created_at DESC
  LIMIT limit_in OFFSET offset_in;
$$;

REVOKE ALL ON FUNCTION public.admin_list_suspensions(integer, integer) FROM PUBLIC;

-- 2. Get suspension detail with appeal info
CREATE OR REPLACE FUNCTION public.admin_get_suspension_detail(
  suspension_id_in uuid
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  profile_nickname text,
  profile_avatar_url text,
  profile_email text,
  profile_trust_score smallint,
  profile_warning_count integer,
  level smallint,
  reason text,
  category text,
  started_at timestamptz,
  ends_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid,
  lift_reason text,
  appeal_note text,
  issued_by uuid,
  created_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    s.id, s.profile_id, p.nickname, p.avatar_url, p.email,
    p.trust_score, p.warning_count,
    s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at, s.lifted_by, s.lift_reason,
    s.appeal_note, s.issued_by, s.created_at
  FROM public.suspensions s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.id = suspension_id_in;
$$;

REVOKE ALL ON FUNCTION public.admin_get_suspension_detail(uuid) FROM PUBLIC;

-- 3. List all reports (paginated)
CREATE OR REPLACE FUNCTION public.admin_list_reports(
  limit_in integer DEFAULT 50,
  offset_in integer DEFAULT 0,
  status_filter text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  reporter_id uuid,
  reporter_nickname text,
  target_type text,
  target_id uuid,
  reason text,
  note text,
  status text,
  created_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    r.id, r.reporter_id, p.nickname,
    r.target_type, r.target_id, r.reason, r.note,
    r.status, r.created_at
  FROM public.reports r
  JOIN public.profiles p ON p.id = r.reporter_id
  WHERE (status_filter IS NULL OR r.status = status_filter)
  ORDER BY r.created_at DESC
  LIMIT limit_in OFFSET offset_in;
$$;

REVOKE ALL ON FUNCTION public.admin_list_reports(integer, integer, text) FROM PUBLIC;

-- 4. Get report detail with target info
CREATE OR REPLACE FUNCTION public.admin_get_report_detail(
  report_id_in uuid
)
RETURNS TABLE (
  id uuid,
  reporter_id uuid,
  reporter_nickname text,
  reporter_email text,
  target_type text,
  target_id uuid,
  target_user_id uuid,
  target_user_nickname text,
  reason text,
  note text,
  status text,
  created_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    r.id, r.reporter_id, p1.nickname, p1.email,
    r.target_type, r.target_id,
    CASE 
      WHEN r.target_type = 'user' THEN r.target_id
      WHEN r.target_type = 'item' THEN (SELECT user_id FROM public.items WHERE id = r.target_id)
      WHEN r.target_type = 'post' THEN (SELECT user_id FROM public.posts WHERE id = r.target_id)
      WHEN r.target_type = 'message' THEN (SELECT sender_id FROM public.messages WHERE id = r.target_id)
      WHEN r.target_type = 'comment' THEN (SELECT user_id FROM public.post_comments WHERE id = r.target_id)
    END,
    p2.nickname,
    r.reason, r.note, r.status, r.created_at
  FROM public.reports r
  JOIN public.profiles p1 ON p1.id = r.reporter_id
  LEFT JOIN public.profiles p2 ON p2.id = (
    CASE 
      WHEN r.target_type = 'user' THEN r.target_id
      WHEN r.target_type = 'item' THEN (SELECT user_id FROM public.items WHERE id = r.target_id)
      WHEN r.target_type = 'post' THEN (SELECT user_id FROM public.posts WHERE id = r.target_id)
      WHEN r.target_type = 'message' THEN (SELECT sender_id FROM public.messages WHERE id = r.target_id)
      WHEN r.target_type = 'comment' THEN (SELECT user_id FROM public.post_comments WHERE id = r.target_id)
    END
  )
  WHERE r.id = report_id_in;
$$;

REVOKE ALL ON FUNCTION public.admin_get_report_detail(uuid) FROM PUBLIC;

-- 5. Update report status
CREATE OR REPLACE FUNCTION public.admin_update_report_status(
  report_id_in uuid,
  status_in text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF status_in NOT IN ('pending', 'reviewed', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  
  UPDATE public.reports
  SET status = status_in
  WHERE id = report_id_in;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_report_status(uuid, text) FROM PUBLIC;

-- 6. List active suspensions for a profile
CREATE OR REPLACE FUNCTION public.admin_get_profile_suspensions(
  profile_id_in uuid
)
RETURNS TABLE (
  id uuid,
  level smallint,
  reason text,
  category text,
  started_at timestamptz,
  ends_at timestamptz,
  lifted_at timestamptz,
  appeal_note text,
  created_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    s.id, s.level, s.reason, s.category,
    s.started_at, s.ends_at, s.lifted_at, s.appeal_note,
    s.created_at
  FROM public.suspensions s
  WHERE s.profile_id = profile_id_in
  ORDER BY s.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_profile_suspensions(uuid) FROM PUBLIC;
```

## Step 2: API authentication model

> **Current implementation:** use the unified `api/admin/index.js` route and
> `app/src/pages/admin/index.vue`. The split endpoint snippets below are retained
> only as historical design context; do not copy them into a deployment. The
> live route hashes the presented `iam_admin_...` token and validates it through
> `admin_token_authorization_v2`, which returns the exact identity, database
> clock, expiry, role, and capability projection
> only for a live, profile-backed administrator. There is no shared
> environment-key fallback. The older `admin_token_validate` RPC remains only
> for rolling database compatibility and must not be reconnected to the API.
> Candidate UI and lifecycle tooling send `Authorization: Bearer`; the
> `x-admin-key` header is retained only for temporary backward compatibility
> and must not be copied into new clients.

### Historical split-endpoint sketch (retired)

**File**: `api/admin/suspensions.js`

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkAuth(request) {
  const auth = request.headers.get('authorization')?.replace('Bearer ', '')
  // Current code hashes this token and calls admin_token_authorization_v2.
  if (!(await validatePerAdminToken(auth))) {
    throw new Error('Unauthorized')
  }
}

export default async function handler(request) {
  try {
    await checkAuth(request)

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    if (action === 'list') {
      const { data, error } = await supabase.rpc('admin_list_suspensions', {
        limit_in: limit,
        offset_in: offset
      })
      if (error) throw error
      return new Response(JSON.stringify({ data }), { status: 200 })
    }

    if (action === 'detail') {
      const id = searchParams.get('id')
      const { data, error } = await supabase.rpc('admin_get_suspension_detail', {
        suspension_id_in: id
      })
      if (error) throw error
      return new Response(JSON.stringify({ data: data?.[0] }), { status: 200 })
    }

    if (request.method === 'POST') {
      const body = await request.json()
      
      if (body.action === 'apply_ban') {
        const { data, error } = await supabase.rpc('apply_ban_level', {
          target_in: body.target_id,
          level_in: body.level,
          reason_in: body.reason,
          category_in: body.category || 'generic',
          hours_in: body.hours || null
        })
        if (error) throw error
        return new Response(JSON.stringify({ data }), { status: 200 })
      }

      if (body.action === 'lift_suspension') {
        const { error } = await supabase.rpc('lift_suspension', {
          suspension_id: body.suspension_id,
          reason_in: body.reason
        })
        if (error) throw error
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
    }

    return new Response(JSON.stringify({ error: 'invalid_action' }), { status: 400 })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}
```

**File**: `api/admin/reports.js`

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function checkAuth(request) {
  const auth = request.headers.get('authorization')?.replace('Bearer ', '')
  // Current code hashes this token and calls admin_token_authorization_v2.
  if (!(await validatePerAdminToken(auth))) {
    throw new Error('Unauthorized')
  }
}

export default async function handler(request) {
  try {
    await checkAuth(request)

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    const status = searchParams.get('status')

    if (action === 'list') {
      const { data, error } = await supabase.rpc('admin_list_reports', {
        limit_in: limit,
        offset_in: offset,
        status_filter: status || null
      })
      if (error) throw error
      return new Response(JSON.stringify({ data }), { status: 200 })
    }

    if (action === 'detail') {
      const id = searchParams.get('id')
      const { data, error } = await supabase.rpc('admin_get_report_detail', {
        report_id_in: id
      })
      if (error) throw error
      return new Response(JSON.stringify({ data: data?.[0] }), { status: 200 })
    }

    if (request.method === 'POST') {
      const body = await request.json()
      
      if (body.action === 'update_status') {
        const { error } = await supabase.rpc('admin_update_report_status', {
          report_id_in: body.report_id,
          status_in: body.status
        })
        if (error) throw error
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      }
    }

    return new Response(JSON.stringify({ error: 'invalid_action' }), { status: 400 })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}
```

## Step 3: Environment Variables

Add to `.env.local` (Vercel):

```
SUPABASE_URL=https://lfhvgprfphyfvhidegum.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-named-key-here
```

`SUPABASE_SERVICE_ROLE_KEY` is accepted only as a temporary legacy fallback.

Admin plaintext tokens are not Vercel application variables. For a regular
lifecycle operation, the trusted operator shell uses only:

```bash
ADMIN_API_ORIGIN=https://staging.example.edu
ADMIN_TOKEN="<existing-owner-or-security-admin-token-from-vault>"
```

`ADMIN_API_ORIGIN` must identify the exact approved target. `ADMIN_TOKEN` is
retrieved temporarily from the approved vault and must not be stored in `.env`,
CI, shell startup files, command arguments, or browser storage. Issuance
requires an existing **owner**; revocation requires `security_admin` or owner.
The CLIs deliberately have no `SUPABASE_SECRET_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` fallback.

Issuance accepts authoritative `admin_id`, role, case ID, approval reference,
and idempotency. Expiry defaults to 90 days: operator/security-admin accept
1–365 days, while owner accepts 2–365 whole days and the database independently
requires more than 24 hours of remaining recovery life. The server derives the immutable
name/email snapshot from `public.profiles`; caller-supplied name/email is
rejected. Apply never prints plaintext: it creates a mode-`0600` recovery/output
JSON manifest at an absolute, exclusively created path. The manifest contains
the credential plus immutable request/idempotency fields and is itself a secret.
After an outcome-unknown or 409 response, use the exact original owner
`ADMIN_TOKEN` with
`--resume-file /absolute/private/path/token-recovery.json --apply`; do not
repeat/change issuance flags or generate another key. The manifest binds an
irreversible issuer-token fingerprint and rejects a replacement issuer without
deleting the only plaintext. A replay 2xx is followed by authoritative hash
reconciliation; only the same attached, unrevoked, unexpired token ID is a
confirmed success. Any missing, mismatched, inactive, detached, or unavailable
state exits nonzero, retains the manifest, and must not be vaulted. After that
active-state confirmation, vault the credential and securely remove the local
manifest.

Revocation inventories active/expired/revoked separately and calls audited,
atomic lifecycle actions through `/api/admin`. Email is a cached snapshot and
is case-insensitive dry-run discovery only; matches spanning multiple admin IDs
are warned for separate review. Apply must select an exact token ID or authoritative
admin ID and include case/approval plus a case-recorded idempotency key. Admin-ID
apply revokes active and expired unrevoked rows. Inventory is current
state, not audit history; lifecycle evidence is the `token_issued` /
`token_revoked` audit entry plus the approved external case record.

Rehearse against controlled staging with disposable tokens. Production issue
or revoke needs production-scoped approval, verified origin/caller/target, and
an independent reviewer when privileged access or owner continuity is affected.
If no owner token exists, stop and use the separately governed external
bootstrap/break-glass process. Never reintroduce a service-key/direct-table
operator bypass.

Store each issued token in an approved vault and paste it into the dashboard
gate for one in-memory page session. The API ignores the retired shared-key
variable. The `iam_admin_` prefix is not automatically covered by GitHub:
configure a custom `iam_admin_[A-Za-z0-9_-]{43}` secret pattern, verify scanning
and push protection in repository settings, and test it with a synthetic value.

The dashboard's durable idempotency journal contains only an opaque intent hash,
UUID key, and timestamps. It acknowledges a 2xx only after the UI or an
authoritative GET has applied the result. A crash, refresh failure, or uncertain
transport preserves the receipt and blocks unrelated writes. Only a verified
owner can perform the read-only recovery GET; no recovery path re-sends a POST.
Owner recovery health requires an attached active profile, a non-null
`last_used_at`, and at least 24 hours remaining (or no expiry).

## Step 4: Admin Dashboard Component Example

**File**: `app/src/pages/admin/dashboard.vue` (if building in the same app)

```vue
<template>
  <view class="admin-page">
    <view class="header">
      <text class="title">Moderation Dashboard</text>
    </view>

    <view class="tabs">
      <text 
        v-for="tab in ['suspensions', 'reports']"
        :key="tab"
        :class="['tab', { active: activeTab === tab }]"
        @click="activeTab = tab"
      >
        {{ tab }}
      </text>
    </view>

    <view v-if="activeTab === 'suspensions'" class="content">
      <view v-for="s in suspensions" :key="s.id" class="card">
        <text class="card-title">{{ s.profile_nickname }}</text>
        <text class="card-meta">Level {{ s.level }} · {{ s.reason }}</text>
        <view class="card-actions">
          <view class="btn" @click="viewDetail(s.id)">View</view>
          <view class="btn" @click="liftSuspension(s.id)">Lift</view>
        </view>
      </view>
    </view>

    <view v-if="activeTab === 'reports'" class="content">
      <view v-for="r in reports" :key="r.id" class="card">
        <text class="card-title">{{ r.target_type }} report</text>
        <text class="card-meta">{{ r.reason }}</text>
        <view class="card-actions">
          <view class="btn" @click="viewReportDetail(r.id)">View</view>
          <view class="btn" @click="updateReportStatus(r.id, 'reviewed')">Mark Reviewed</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const activeTab = ref('suspensions')
const suspensions = ref([])
const reports = ref([])
// Supplied by the operator for this page session only; never persist it.
const adminToken = ref('')

async function fetchSuspensions() {
  const res = await fetch(
    `/api/admin/suspensions?action=list&limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${adminToken.value}` } }
  )
  const { data } = await res.json()
  suspensions.value = data
}

async function fetchReports() {
  const res = await fetch(
    `/api/admin/reports?action=list&limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${adminToken.value}` } }
  )
  const { data } = await res.json()
  reports.value = data
}

async function liftSuspension(suspensionId: string) {
  const res = await fetch(`/api/admin/suspensions`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${adminToken.value}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'lift_suspension',
      suspension_id: suspensionId,
      reason: 'Admin review'
    })
  })
  if (res.ok) {
    await fetchSuspensions()
  }
}

async function updateReportStatus(reportId: string, status: string) {
  const res = await fetch(`/api/admin/reports`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${adminToken.value}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'update_status',
      report_id: reportId,
      status
    })
  })
  if (res.ok) {
    await fetchReports()
  }
}

function viewDetail(id: string) {
  uni.navigateTo({ url: `/pages/admin/suspension-detail?id=${id}` })
}

function viewReportDetail(id: string) {
  uni.navigateTo({ url: `/pages/admin/report-detail?id=${id}` })
}

onMounted(() => {
  fetchSuspensions()
  fetchReports()
})
</script>

<style scoped>
.admin-page { padding: 20px; }
.header { margin-bottom: 20px; }
.title { font-size: 24px; font-weight: bold; }
.tabs { display: flex; gap: 10px; margin-bottom: 20px; }
.tab { padding: 10px 20px; border-radius: 8px; background: #f0f0f0; }
.tab.active { background: #1a1a1a; color: white; }
.card { background: white; padding: 15px; border-radius: 8px; margin-bottom: 10px; }
.card-title { font-weight: bold; }
.card-meta { font-size: 12px; color: #666; }
.card-actions { display: flex; gap: 10px; margin-top: 10px; }
.btn { padding: 8px 12px; background: #1a1a1a; color: white; border-radius: 6px; }
</style>
```

## Step 5: Update pages.json

```json
{
  "path": "pages/admin/dashboard",
  "style": { "navigationStyle": "custom" }
},
{
  "path": "pages/admin/suspension-detail",
  "style": { "navigationStyle": "custom" }
},
{
  "path": "pages/admin/report-detail",
  "style": { "navigationStyle": "custom" }
}
```

## Security Checklist

- ✅ All admin functions use `SECURITY DEFINER` with `REVOKE ALL FROM PUBLIC`
- ✅ `/api/admin` authorizes a hashed per-admin bearer through `admin_token_authorization_v2` with exact identity/clock/expiry/role/capabilities and a live profile; no shared-key fallback
- ✅ Service role key never exposed to client
- ✅ Admin pages keep the per-admin token in page memory only, never browser storage
- ✅ Candidate admin/token mutations commit business state, actor attribution,
  case/approval metadata, idempotency result, and required `admin_audit_log`
  evidence atomically
- ✅ Token inventory separates active/expired/revoked and is not represented as
  audit history
- ✅ Regular lifecycle CLIs use `/api/admin`; no Supabase key or direct-table
  issue/revoke path
- ✅ RLS policies prevent direct table access (except via RPC)
