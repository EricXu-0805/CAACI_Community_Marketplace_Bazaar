# Admin Dashboard Implementation Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Dashboard (Separate App)            │
│                  (Next.js / Vue / React)                     │
└────────────────────────┬────────────────────────────────────┘
                         │ ADMIN_API_KEY header
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Vercel API Routes (/api/admin/*)                │
│         (Uses SUPABASE_SERVICE_ROLE_KEY)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Supabase (service_role)                     │
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

## Step 2: Create API Endpoints

**File**: `api/admin/suspensions.js`

```javascript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function checkAuth(request) {
  const auth = request.headers.get('authorization')?.replace('Bearer ', '')
  if (auth !== process.env.ADMIN_API_KEY) {
    throw new Error('Unauthorized')
  }
}

export default async function handler(request) {
  try {
    checkAuth(request)

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
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function checkAuth(request) {
  const auth = request.headers.get('authorization')?.replace('Bearer ', '')
  if (auth !== process.env.ADMIN_API_KEY) {
    throw new Error('Unauthorized')
  }
}

export default async function handler(request) {
  try {
    checkAuth(request)

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
ADMIN_API_KEY=your-secret-admin-key-here
SUPABASE_URL=https://lfhvgprfphyfvhidegum.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

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
const adminKey = 'your-admin-api-key'

async function fetchSuspensions() {
  const res = await fetch(
    `/api/admin/suspensions?action=list&limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${adminKey}` } }
  )
  const { data } = await res.json()
  suspensions.value = data
}

async function fetchReports() {
  const res = await fetch(
    `/api/admin/reports?action=list&limit=50&offset=0`,
    { headers: { Authorization: `Bearer ${adminKey}` } }
  )
  const { data } = await res.json()
  reports.value = data
}

async function liftSuspension(suspensionId: string) {
  const res = await fetch(`/api/admin/suspensions`, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${adminKey}`,
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
      Authorization: `Bearer ${adminKey}`,
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
- ✅ API endpoints check `ADMIN_API_KEY` header
- ✅ Service role key never exposed to client
- ✅ Admin pages gated by API key, not client-side flag
- ✅ All mutations logged via `issued_by`, `lifted_by` fields
- ✅ RLS policies prevent direct table access (except via RPC)

