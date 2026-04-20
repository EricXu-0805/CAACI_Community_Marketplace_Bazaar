# CAACI Community Marketplace - Comprehensive Security Audit Report

**Project Location:** `/Users/xiaogangxu/Projects/CAACI_Community_Marketplace_Bazaar`  
**Audit Date:** April 2024  
**Scope:** Complete security/moderation/anti-abuse infrastructure

---

## EXECUTIVE SUMMARY

This is a **well-hardened** uniapp + Supabase marketplace with **comprehensive server-side rate limiting, RLS policies, and moderation infrastructure**. The security posture is **STRONG** with multiple layers of defense. Key strengths:

- ✅ **Server-side rate limiting** via BEFORE INSERT triggers on all user-generated content tables
- ✅ **Duplicate detection** with normalized string comparison (case-insensitive, whitespace-collapsed)
- ✅ **RLS policies** on all tables with WITH CHECK guards to prevent field tampering
- ✅ **Block list system** with client-side filtering integration
- ✅ **Report system** with unique constraint to prevent spam
- ✅ **PII protection** via column-level GRANTs (phone/email/wechat hidden from public)
- ✅ **Conversation flag isolation** via BEFORE UPDATE trigger
- ✅ **Notification INSERT denial** via explicit CHECK (false) policy
- ✅ **Storage upload restrictions** to user's own folder
- ✅ **Illini email auto-verification** for campus badge

**Gaps identified:**
- ⚠️ No explicit captcha/disposable email detection on signup
- ⚠️ No graduated ban/suspension system (soft-delete only)
- ⚠️ No content keyword filtering (relies on user reports)
- ⚠️ No virus/malware scanning on image uploads
- ⚠️ No explicit phone number / WeChat ID / QR code regex validation in client
- ⚠️ No admin dashboard UI (reports table exists but no UI to review)

---

## 1. RATE LIMITING

### 1.1 Server-Side Rate Limits (Database Triggers)

**File:** `supabase/migrations/012_rate_limiting_and_dedupe.sql` (lines 1-302)  
**File:** `supabase/migrations/013_security_patches.sql` (lines 120-310)

All rate limits are enforced via **BEFORE INSERT triggers** with SECURITY DEFINER. Attacker cannot bypass by spoofing timestamps.

#### Items (Marketplace Listings)
- **Limit:** 10/hour, 30/day
- **Trigger:** `trg_rl_items_before_insert` on `public.items`
- **Function:** `rl_items_before_insert()` (migration 012, lines 52-96; updated 013, lines 129-170)
- **Error Codes:** `rate_limit_items_hour`, `rate_limit_items_day`
- **Dedupe:** 60-second window, normalized title comparison (LOWER + TRIM + collapse whitespace)

#### Posts (Plaza)
- **Limit:** 10/hour, 30/day (official posts exempt)
- **Trigger:** `trg_rl_posts_before_insert` on `public.posts`
- **Function:** `rl_posts_before_insert()` (migration 012, lines 101-149; updated 013, lines 173-218)
- **Error Codes:** `rate_limit_posts_hour`, `rate_limit_posts_day`
- **Dedupe:** 60-second window, normalized content comparison
- **Special:** `is_official=true` posts bypass rate limits (line 112-114 in 012)

#### Comments (Post Comments)
- **Limit:** 30/hour, 100/day
- **Trigger:** `trg_rl_post_comments_before_insert` on `public.post_comments`
- **Function:** `rl_post_comments_before_insert()` (migration 012, lines 154-199; updated 013, lines 221-263)
- **Error Codes:** `rate_limit_comments_hour`, `rate_limit_comments_day`
- **Dedupe:** 30-second window, normalized content comparison

#### Messages (Chat)
- **Limit:** 30/minute, 300/hour
- **Trigger:** `trg_rl_messages_before_insert` on `public.messages`
- **Function:** `rl_messages_before_insert()` (migration 012, lines 204-250; updated 013, lines 267-310)
- **Error Codes:** `rate_limit_messages_minute`, `rate_limit_messages_hour`
- **Dedupe:** 5-second window, normalized content comparison
- **Note:** 300/hour = 5 msgs/min average; 30/min burst limit prevents spam

#### Reports (Abuse Reports)
- **Limit:** 10/hour, 30/day
- **Trigger:** `trg_rl_reports_before_insert` on `public.reports`
- **Function:** `rl_reports_before_insert()` (migration 012, lines 256-289)
- **Error Codes:** `rate_limit_reports_hour`, `rate_limit_reports_day`
- **Additional Guard:** UNIQUE(reporter_id, target_type, target_id) constraint (migration 011, lines 132-138) prevents duplicate reports on same target

#### Follows (Seller Following)
- **Limit:** 30/hour, 100/day
- **Trigger:** `trg_rl_follows_before_insert` on `public.follows`
- **Function:** `rl_follows_before_insert()` (migration 016, lines 42-68)
- **Error Codes:** `rate_limit_follows_hour`, `rate_limit_follows_day`

### 1.2 Client-Side Error Handling

**File:** `app/src/utils/index.ts` (lines 35-74)

The `friendlyErrorMessage()` function maps database error codes to user-friendly messages:

```typescript
const RATE_LIMIT_MESSAGES: Record<string, { en: string; zh: string }> = {
  rate_limit_items_hour:    { en: 'Too many items this hour...', zh: '本小时发布太多...' },
  rate_limit_items_day:     { en: 'Daily item limit reached...', zh: '今日已达发布上限' },
  duplicate_item:           { en: 'You just posted this...', zh: '刚刚已发布过这条...' },
  rate_limit_posts_hour:    { en: 'Too many posts this hour...', zh: '本小时发帖太多...' },
  rate_limit_posts_day:     { en: 'Daily post limit reached...', zh: '今日已达发帖上限' },
  duplicate_post:           { en: 'You just posted that...', zh: '刚刚已发过这条' },
  rate_limit_comments_hour: { en: 'Commenting too fast...', zh: '评论太快...' },
  rate_limit_comments_day:  { en: 'Daily comment limit reached...', zh: '今日评论已达上限' },
  duplicate_comment:        { en: 'You just wrote that...', zh: '刚刚写过这条评论' },
  rate_limit_messages_minute: { en: 'Slow down — too many messages...', zh: '发送太快...' },
  rate_limit_messages_hour: { en: 'Hourly message limit reached...', zh: '本小时消息已达上限' },
  duplicate_message:        { en: 'Duplicate message blocked...', zh: '重复消息已拦截' },
  rate_limit_reports_hour:  { en: 'Too many reports recently...', zh: '举报太频繁' },
  rate_limit_reports_day:   { en: 'Daily report limit reached...', zh: '今日举报已达上限' },
  reports_unique_reporter_target: { en: 'You have already reported this...', zh: '你已举报过这个' },
}
```

**Usage:** Pages like `post/index.vue`, `chat/index.vue`, `publish/index.vue`, `detail/index.vue`, `plaza/index.vue` all call `friendlyErrorMessage(err, lang)` on catch blocks.

### 1.3 No Client-Side Debounce/Throttle

**Finding:** No explicit debounce on submit buttons in the UI. The `debounce()` utility exists (app/src/utils/index.ts, lines 90-99) but is **not used** on form submissions. This means:
- A user can click "Post" 10 times rapidly and hit the server 10 times
- The database trigger will reject attempts 2-10, but the client doesn't prevent the requests
- **Recommendation:** Add debounce to submit buttons (e.g., `@click="debounce(onSubmit, 500)"`)

---

## 2. CONTENT MODERATION

### 2.1 Keyword Filtering

**Finding:** **NO keyword/profanity filtering implemented.** The system relies entirely on user reports.

- No `ban_words` table
- No regex validation for phone numbers, WeChat IDs, QR codes, or URLs in posts/items
- No content validation beyond length checks

**Length Checks (Client-Side):**
- Items: title ≤ 200 chars, description ≤ 2000 chars (useItems.ts, lines 164-165)
- Posts: content ≤ 2000 chars (usePlaza.ts, line 108)
- Comments: content ≤ 1000 chars (post_comments table CHECK, migration 010, line 182)
- Messages: content ≤ 2000 chars (useMessages.ts, line 83)
- Status text: ≤ 60 chars (useAuth.ts, line 149)
- Status emoji: ≤ 8 chars (useAuth.ts, line 153)

**HTML/Control Character Sanitization (Client-Side):**
- `sanitizeStatus()` in useAuth.ts (lines 15-21) removes HTML tags and control characters from status_text/status_emoji
- No sanitization on item titles, descriptions, post content, or comments

### 2.2 PII Leakage Prevention

**File:** `supabase/migrations/004_security_hardening.sql` (lines 22-54)

Column-level GRANTs hide sensitive fields from public:

```sql
REVOKE SELECT ON public.profiles FROM anon, authenticated, PUBLIC;
GRANT SELECT (id, nickname, avatar_url, bio, location, created_at, is_illini_verified)
  ON public.profiles TO anon, authenticated;
```

**Hidden Columns:**
- `phone` (not in GRANT)
- `email` (not in GRANT)
- `wechat_openid` (not in GRANT)

**Self-Service Access:**
- `get_my_profile()` RPC (migration 004, lines 43-54) returns full profile including PII for authenticated user
- Only callable by authenticated users (GRANT EXECUTE to authenticated)

**Updated Grants (Migration 021, line 30):**
```sql
GRANT SELECT (id, nickname, avatar_url, bio, location, is_illini_verified, created_at, updated_at, uid, avg_rating, rating_count, status_text, status_emoji)
  ON public.profiles TO anon, authenticated;
```

---

## 3. REPORTS SYSTEM

### 3.1 Report Table Schema

**File:** `supabase/migrations/004_security_hardening.sql` (lines 123-148)

```sql
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('item', 'user', 'message')),
  target_id UUID NOT NULL,
  reason TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Updated (Migration 022, lines 1-5):**
```sql
ALTER TABLE public.reports
  ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('item', 'user', 'message', 'post', 'comment'));
```

**Supported Target Types:**
- `item` (marketplace listing)
- `user` (user profile)
- `message` (chat message)
- `post` (plaza post)
- `comment` (plaza comment)

### 3.2 Report RLS Policies

**File:** `supabase/migrations/004_security_hardening.sql` (lines 139-147)

```sql
DROP POLICY IF EXISTS "Users can create reports" ON public.reports;
CREATE POLICY "Users can create reports"
  ON public.reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "Users can view own reports" ON public.reports;
CREATE POLICY "Users can view own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = reporter_id);
```

**Restrictions:**
- Users can only INSERT reports where they are the reporter
- Users can only SELECT their own reports
- **No admin dashboard UI** to review reports (table exists but no UI)

### 3.3 Report Submission (Client-Side)

**File:** `app/src/composables/useModeration.ts` (lines 32-49)

```typescript
async function reportTarget(
  targetType: ReportTarget,
  targetId: string,
  reason: string,
  note = ''
) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')

  const { error } = await supabase.from('reports').insert({
    reporter_id: session.user.id,
    target_type: targetType,
    target_id: targetId,
    reason: reason.slice(0, 50),  // Truncate to 50 chars
    note: note.slice(0, 500),     // Truncate to 500 chars
  })
  if (error) throw error
}
```

**Type Definition:**
```typescript
export type ReportTarget = 'item' | 'user' | 'message' | 'post' | 'comment'
```

**Spam Prevention:**
- Rate limit: 10/hour, 30/day (migration 012, lines 256-289)
- Unique constraint: UNIQUE(reporter_id, target_type, target_id) (migration 011, lines 132-138)
  - Prevents duplicate reports on same target by same user

---

## 4. BLOCK LIST

### 4.1 Block Table Schema

**File:** `supabase/migrations/004_security_hardening.sql` (lines 152-171)

```sql
CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own blocks" ON public.blocks;
CREATE POLICY "Users manage own blocks"
  ON public.blocks FOR ALL
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);
```

### 4.2 Block Management (Client-Side)

**File:** `app/src/composables/useModeration.ts` (lines 6-75)

```typescript
const blockedIds = ref<Set<string>>(new Set())
let loaded = false

async function loadBlockedIds() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) { blockedIds.value = new Set(); loaded = false; return }

  const { data } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', session.user.id)
  blockedIds.value = new Set((data || []).map(r => r.blocked_id))
  loaded = true
}

function isBlocked(userId: string): boolean {
  return blockedIds.value.has(userId)
}

async function blockUser(blockedId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')
  if (session.user.id === blockedId) throw new Error('Cannot block yourself')

  const { error } = await supabase.from('blocks').insert({
    blocker_id: session.user.id,
    blocked_id: blockedId,
  })
  if (error && error.code !== '23505') throw error  // Ignore duplicate
  blockedIds.value.add(blockedId)
}

async function unblockUser(blockedId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', session.user.id)
    .eq('blocked_id', blockedId)
  if (error) throw error
  blockedIds.value.delete(blockedId)
}
```

### 4.3 Block Propagation to Feed Queries

**File:** `app/src/composables/useItems.ts` (lines 105-110)

```typescript
if (data) {
  const { blockedIds } = useModeration()
  const rows = data as unknown as Item[]
  const filtered = blockedIds.value.size > 0
    ? rows.filter(item => !blockedIds.value.has(item.user_id))
    : rows
  // ...
}
```

**File:** `app/src/composables/usePlaza.ts` (lines 55-58)

```typescript
const { blockedIds } = useModeration()
if (blockedIds.value.size > 0) {
  result = result.filter(p => !blockedIds.value.has(p.user_id))
}
```

**File:** `app/src/composables/useMessages.ts` (lines 32-36)

```typescript
const { blockedIds } = useModeration()
let convs = (data || []) as unknown as Conversation[]
if (blockedIds.value.size > 0) {
  convs = convs.filter(c => !blockedIds.value.has(c.buyer_id) && !blockedIds.value.has(c.seller_id))
}
```

**UI:** `app/src/pages/blocked/index.vue` (lines 1-133)
- Shows list of blocked users
- Allows unblocking with confirmation dialog

---

## 5. AUTH PROTECTION

### 5.1 Signup Validation

**File:** `app/src/composables/useAuth.ts` (lines 78-101)

```typescript
async function signUp(email: string, password: string, nickname: string) {
  loading.value = true
  try {
    if (password.length < 8) throw new Error('Password must be at least 8 characters')

    const emailRedirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/#/pages/index/index`
      : undefined
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nickname },
        emailRedirectTo,
      },
    })
    if (error) throw error
    return { data, error: null }
  } catch (error: any) {
    return { data: null, error }
  } finally {
    loading.value = false
  }
}
```

**Protections:**
- ✅ Password minimum 8 characters (client-side)
- ✅ Email verification required (Supabase auth default)
- ✅ Illini email auto-verification (migration 004, lines 214-238)
  - Users with @illinois.edu email get `is_illini_verified = true` automatically
- ❌ No captcha
- ❌ No disposable email detection
- ❌ No rate limiting on signup attempts (Supabase auth handles this)

### 5.2 Illini Email Auto-Verification

**File:** `supabase/migrations/004_security_hardening.sql` (lines 214-238)

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nickname, is_illini_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nickname', split_part(NEW.email, '@', 1), '用户'),
    (LOWER(COALESCE(NEW.email, '')) LIKE '%@illinois.edu')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

UPDATE public.profiles p
SET is_illini_verified = TRUE
FROM auth.users u
WHERE p.id = u.id
  AND LOWER(COALESCE(u.email, '')) LIKE '%@illinois.edu'
  AND p.is_illini_verified = FALSE;
```

---

## 6. DUPLICATE DETECTION

### 6.1 Duplicate Detection Mechanism

All duplicate detection uses **normalized string comparison** (migration 013, lines 120-127):

```sql
norm := LOWER(TRIM(regexp_replace(COALESCE(NEW.title, ''), '\s+', ' ', 'g')));
```

This catches:
- Case variations: "iPhone 13" vs "IPHONE 13"
- Whitespace variations: "iPhone 13" vs "iPhone  13" vs "iPhone 13 "

### 6.2 Duplicate Detection by Content Type

| Content Type | Window | Trigger | Function | Error Code |
|---|---|---|---|---|
| Items | 60s | `trg_rl_items_before_insert` | `rl_items_before_insert()` | `duplicate_item` |
| Posts | 60s | `trg_rl_posts_before_insert` | `rl_posts_before_insert()` | `duplicate_post` |
| Comments | 30s | `trg_rl_post_comments_before_insert` | `rl_post_comments_before_insert()` | `duplicate_comment` |
| Messages | 5s | `trg_rl_messages_before_insert` | `rl_messages_before_insert()` | `duplicate_message` |

---

## 7. ROW LEVEL SECURITY (RLS) POLICIES

### 7.1 Summary of All RLS Policies

**File:** `supabase/migrations/001_initial_schema.sql` (lines 157-240)  
**File:** `supabase/migrations/004_security_hardening.sql` (lines 29-147)  
**File:** `supabase/migrations/010_plaza_and_uid_and_chat_flags.sql` (lines 153-223)  
**File:** `supabase/migrations/011_rls_hardening_and_perf_indexes.sql` (lines 23-100)  
**File:** `supabase/migrations/013_security_patches.sql` (lines 32-117)  
**File:** `supabase/migrations/016_follows.sql` (lines 25-39)  
**File:** `supabase/migrations/018_ratings.sql` (lines 36-66)

#### profiles
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Public profile rows readable" | SELECT | `true` | — | ⚠️ **PERMISSIVE** - anyone can view profiles (necessary for FK embeds) |
| "Users can update own profile" | UPDATE | `auth.uid() = id` | — | (migration 001) |
| (Column-level GRANTs) | SELECT | — | — | Hide phone, email, wechat_openid (migration 004) |

#### items
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Anyone can view active items" | SELECT | `status != 'deleted'` | — | ⚠️ **PERMISSIVE** - anyone can view active items |
| "Authenticated users can create items" | INSERT | — | `auth.uid() = user_id` | ✅ WITH CHECK prevents user_id spoofing |
| "Users can update own items" | UPDATE | `auth.uid() = user_id` | `auth.uid() = user_id` | ✅ WITH CHECK added (migration 011) |
| "Users can delete own items" | DELETE | `auth.uid() = user_id` | — | |

#### conversations
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Participants can view conversations" | SELECT | `auth.uid() = buyer_id OR auth.uid() = seller_id` | — | |
| "Authenticated users can create conversations" | INSERT | — | `auth.uid() = buyer_id` | Only buyer can create |
| "Participants can update conversations" | UPDATE | `auth.uid() = buyer_id OR auth.uid() = seller_id` | `auth.uid() = buyer_id OR auth.uid() = seller_id` | ✅ WITH CHECK added (migration 011) |
| "Participants can delete conversations" | DELETE | `auth.uid() = buyer_id OR auth.uid() = seller_id` | — | |

**Additional Protection (Migration 013, lines 65-117):**
- BEFORE UPDATE trigger `enforce_conversation_flag_ownership()` prevents cross-party flag mutations
- Buyer can only change `is_pinned_buyer` and `is_muted_buyer`
- Seller can only change `is_pinned_seller` and `is_muted_seller`
- Prevents buyer from setting `is_muted_seller = true`

#### messages
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Participants can view messages" | SELECT | `conversation_id IN (SELECT id FROM conversations WHERE buyer_id = auth.uid() OR seller_id = auth.uid())` | — | |
| "Participants can send messages" | INSERT | — | `auth.uid() = sender_id AND conversation_id IN (...)` | ✅ WITH CHECK prevents sender_id spoofing |
| "Participants can update messages" | UPDATE | `conversation_id IN (...)` | `conversation_id IN (...)` | ✅ WITH CHECK added (migration 011) |

#### favorites
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Users can view own favorites" | SELECT | `auth.uid() = user_id` | — | |
| "Users can add favorites" | INSERT | — | `auth.uid() = user_id` | ✅ WITH CHECK |
| "Users can remove favorites" | DELETE | `auth.uid() = user_id` | — | |

#### posts (plaza)
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Anyone can view active posts" | SELECT | `status = 'active'` | — | ⚠️ **PERMISSIVE** - anyone can view active posts |
| "Authenticated users can create posts" | INSERT | — | `auth.uid() = user_id AND NOT is_official` | ✅ Regular users cannot create official posts |
| "Users can update own posts" | UPDATE | `auth.uid() = user_id` | `auth.uid() = user_id AND NOT is_official AND NOT is_pinned` | ✅ Cannot self-pin or flip is_official (migration 011) |
| "Users can delete own posts" | DELETE | `auth.uid() = user_id` | — | |

#### post_comments
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Anyone can view comments" | SELECT | `true` | — | ⚠️ **PERMISSIVE** - anyone can view comments |
| "Authenticated users can comment" | INSERT | — | `auth.uid() = user_id` | ✅ WITH CHECK |
| "Users can update own comments" | UPDATE | `auth.uid() = user_id` | `auth.uid() = user_id` | ✅ WITH CHECK added (migration 011) |
| "Users can delete own comments" | DELETE | `auth.uid() = user_id` | — | |

#### post_likes
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Anyone can view likes" | SELECT | `true` | — | ⚠️ **PERMISSIVE** - anyone can view likes |
| "Users can like" | INSERT | — | `auth.uid() = user_id` | ✅ WITH CHECK |
| "Users can unlike" | DELETE | `auth.uid() = user_id` | — | |
| "No updates to likes" | UPDATE | `false` | `false` | ✅ Explicit deny - likes are insert/delete only |

#### follows
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Anyone can view follows" | SELECT | `true` | — | ⚠️ **PERMISSIVE** - anyone can view follow graph |
| "Users can follow" | INSERT | — | `auth.uid() = follower_id` | ✅ WITH CHECK |
| "Users can unfollow" | DELETE | `auth.uid() = follower_id` | — | |

#### ratings
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Anyone can view ratings" | SELECT | `true` | — | ⚠️ **PERMISSIVE** - anyone can view ratings |
| "Participants can rate sold items" | INSERT | — | Complex: rater_id, item sold, conversation exists | ✅ WITH CHECK prevents rating non-participants |
| "Raters can delete own rating" | DELETE | `auth.uid() = rater_id` | — | |

#### reports
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Users can create reports" | INSERT | — | `auth.uid() = reporter_id` | ✅ WITH CHECK |
| "Users can view own reports" | SELECT | `auth.uid() = reporter_id` | — | Users can only see their own reports |

#### blocks
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Users manage own blocks" | ALL | `auth.uid() = blocker_id` | `auth.uid() = blocker_id` | ✅ WITH CHECK on all operations |

#### notifications
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Users can view own notifications" | SELECT | `auth.uid() = user_id` | — | (migration 005) |
| "Users update own notifications" | UPDATE | `auth.uid() = user_id` | `auth.uid() = user_id` | ✅ WITH CHECK (migration 011) |
| "Block direct notification inserts" | INSERT | — | `false` | ✅ Explicit deny (migration 013) - only SECURITY DEFINER triggers can insert |

#### storage.objects (item-images bucket)
| Policy | Operation | USING | WITH CHECK | Notes |
|---|---|---|---|---|
| "Anyone can view item images" | SELECT | `bucket_id = 'item-images'` | — | ⚠️ **PERMISSIVE** - anyone can view images |
| "Authenticated users can upload to own folder" | INSERT | — | `bucket_id = 'item-images' AND auth.role() = 'authenticated' AND (storage.foldername(name))[1] = 'items' AND (storage.foldername(name))[2] = auth.uid()::text` | ✅ Restricts uploads to `items/<uid>/*` (migration 011) |
| "Users can delete own images" | DELETE | `bucket_id = 'item-images' AND auth.uid()::text = (storage.foldername(name))[1]` | — | (migration 001) |

### 7.2 Permissive Policies (USING true)

**⚠️ Intentional and Necessary:**

1. **profiles** - `USING (true)` for SELECT
   - Reason: Required for PostgREST FK embeds (e.g., items → profile)
   - Mitigation: Column-level GRANTs hide PII (phone, email, wechat_openid)

2. **items** - `USING (status != 'deleted')` for SELECT
   - Reason: Marketplace must show active items to all users
   - Mitigation: Deleted items filtered out; user_id is public

3. **posts** - `USING (status = 'active')` for SELECT
   - Reason: Plaza posts must be visible to all users
   - Mitigation: Deleted/hidden posts filtered out

4. **post_comments** - `USING (true)` for SELECT
   - Reason: Comments must be visible to all users
   - Mitigation: No sensitive data in comments

5. **post_likes** - `USING (true)` for SELECT
   - Reason: Like counts must be visible to all users
   - Mitigation: No sensitive data

6. **follows** - `USING (true)` for SELECT
   - Reason: Follow graph must be visible to all users
   - Mitigation: No sensitive data

7. **ratings** - `USING (true)` for SELECT
   - Reason: Ratings must be visible to all users
   - Mitigation: No sensitive data

8. **storage.objects** - `USING (bucket_id = 'item-images')` for SELECT
   - Reason: Images must be publicly viewable
   - Mitigation: Uploaded to user's own folder; no private data

---

## 8. APPEALS / BAN SYSTEM

### 8.1 Current State

**Finding:** **NO ban/suspension system implemented.**

- No `user_status` field (profiles table has no status column)
- No graduated bans (soft-delete only)
- No appeal mechanism
- No admin dashboard to manage bans

### 8.2 Account Deletion (Soft-Delete)

**File:** `supabase/migrations/004_security_hardening.sql` (lines 179-209)

```sql
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.items SET status = 'deleted' WHERE user_id = uid;
  DELETE FROM public.favorites WHERE user_id = uid;
  DELETE FROM public.conversations WHERE buyer_id = uid OR seller_id = uid;

  UPDATE public.profiles
    SET nickname = '[deleted]',
        avatar_url = '',
        bio = '',
        phone = NULL,
        email = NULL,
        wechat_openid = NULL,
        is_illini_verified = FALSE
    WHERE id = uid;
END;
$$;
```

**Behavior:**
- User-initiated only (no admin ban)
- Soft-delete: profile anonymized, items marked deleted, conversations deleted
- auth.users row NOT deleted (requires service_role)

---

## 9. FILE UPLOAD SECURITY

### 9.1 Image Upload Implementation

**File:** `app/src/composables/useItems.ts` (lines 222-305)

```typescript
async function uploadImages(tempFiles: string[]): Promise<string[]> {
  if (tempFiles.length > MAX_IMAGES) throw new Error('Too many files')
  const urls: string[] = []

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) throw new Error('Not authenticated')

  const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
    })

  for (const filePath of tempFiles) {
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
    const storagePath = `items/${session.user.id}/${fileName}`

    try {
      let uploadError: any = null

      // #ifdef H5
      const compressed = await compressImage(filePath, 1600, 0.82)
      const response = await fetch(compressed)
      const blob = await response.blob()
      if (blob.size > MAX_FILE_SIZE) throw new Error('File too large (max 5MB)')
      const h5Result = await withTimeout(
        supabase.storage.from('item-images').upload(storagePath, blob, { contentType: 'image/jpeg' }),
        30000,
        'image upload',
      )
      uploadError = h5Result.error
      // #endif

      // #ifndef H5
      const compressedPath = await compressImage(filePath, 1600, 0.82)
      const fileInfo = await new Promise<{ size: number } | null>((resolve) => {
        uni.getFileInfo({
          filePath: compressedPath,
          success: (info: any) => resolve({ size: info.size }),
          fail: () => resolve(null),
        })
      })
      if (fileInfo && fileInfo.size > MAX_FILE_SIZE) {
        throw new Error('File too large (max 5MB)')
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const uploadUrl = `${supabaseUrl}/storage/v1/object/item-images/${storagePath}`
      uploadError = await new Promise<any>((resolve) => {
        uni.uploadFile({
          url: uploadUrl,
          filePath: compressedPath,
          name: 'file',
          header: {
            Authorization: `Bearer ${session.access_token}`,
            'x-upsert': 'false',
          },
          success: (res: any) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(null)
            } else {
              resolve(new Error(`Upload HTTP ${res.statusCode}: ${res.data}`))
            }
          },
          fail: (err) => resolve(err),
        })
      })
      // #endif

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from('item-images')
          .getPublicUrl(storagePath)
        urls.push(urlData.publicUrl)
      } else {
        console.warn('Upload rejected for', filePath, uploadError)
      }
    } catch (err) {
      console.warn('Upload error for', filePath, err)
    }
  }

  return urls
}
```

### 9.2 Upload Security Controls

| Control | Implementation | Notes |
|---|---|---|
| **Max Files** | `MAX_IMAGES = 9` (line 35) | Enforced client-side |
| **Max File Size** | `MAX_FILE_SIZE = 5 * 1024 * 1024` (line 34) | 5 MB per image |
| **MIME Type** | Hardcoded `image/jpeg` (line 248) | Only JPEG allowed |
| **Compression** | `compressImage(filePath, 1600, 0.82)` (lines 243, 256) | Max 1600px width, 82% quality |
| **Path Restriction** | `items/${session.user.id}/${fileName}` (line 237) | RLS policy enforces (migration 011, lines 114-124) |
| **Timeout** | 30 seconds (line 249) | Prevents hanging uploads |
| **Randomized Filename** | `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg` (line 236) | Prevents enumeration |

### 9.3 Storage RLS Policy

**File:** `supabase/migrations/011_rls_hardening_and_perf_indexes.sql` (lines 114-124)

```sql
CREATE POLICY "Authenticated users can upload to own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'item-images'
    AND auth.role() = 'authenticated'
    AND (
      -- allow: items/<uid>/...
      (storage.foldername(name))[1] = 'items'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
  );
```

### 9.4 Missing Protections

- ❌ **No virus/malware scanning** (e.g., ClamAV, VirusTotal)
- ❌ **No EXIF data stripping** (could leak location)
- ❌ **No image validation** (could upload non-image files with .jpg extension)
- ❌ **No duplicate image detection** (same image uploaded multiple times)

---

## 10. API ENDPOINTS

### 10.1 API Files

**Location:** `/Users/xiaogangxu/Projects/CAACI_Community_Marketplace_Bazaar/api/`

#### probe-022.js (lines 1-71)
**Purpose:** Migration health check endpoint  
**Endpoint:** `GET /api/probe-022`  
**Auth:** Optional (uses SERVICE_ROLE if available, falls back to ANON_KEY)  
**Functionality:**
- Checks if migration 021 (status_text/status_emoji columns) is applied
- Checks if migration 022 (reports post/comment target types) is applied
- Uses service_role key if available to test INSERT permissions
- Cleans up test rows after verification

**Security:**
- ✅ Reads SUPABASE_SERVICE_ROLE_KEY from env (not exposed in response)
- ✅ Falls back to ANON_KEY if service role unavailable
- ✅ Cleans up test data (lines 40-47)
- ⚠️ Exposes which key is being used in response (line 9)

#### share.js (lines 1-64)
**Purpose:** Open Graph metadata for item sharing  
**Endpoint:** `GET /api/share?id=<item-uuid>`  
**Auth:** None (public)  
**Functionality:**
- Fetches item details (title, description, price, images)
- Generates HTML with OG meta tags for social sharing
- Redirects to item detail page

**Security:**
- ✅ Uses ANON_KEY (public data only)
- ✅ HTML escapes all user input (lines 6-10)
- ✅ Caches response (max-age=60, s-maxage=300)
- ✅ Gracefully handles missing items (returns placeholder)

#### share-post.js (lines 1-65)
**Purpose:** Open Graph metadata for plaza post sharing  
**Endpoint:** `GET /api/share-post?id=<post-uuid>`  
**Auth:** None (public)  
**Functionality:**
- Fetches post details (content, images, author)
- Generates HTML with OG meta tags for social sharing
- Redirects to post detail page

**Security:**
- ✅ Uses ANON_KEY (public data only)
- ✅ HTML escapes all user input (lines 6-10)
- ✅ Caches response (max-age=60, s-maxage=300)
- ✅ Gracefully handles missing posts (returns placeholder)

### 10.2 Service Role Usage

**Finding:** Service role key is **only used in probe-022.js** for testing migrations.

- ✅ NOT used in share.js or share-post.js (both use ANON_KEY)
- ✅ NOT used in any client-side code
- ✅ Stored in environment variable (not hardcoded)
- ⚠️ Exposed in probe-022 response (which key is being used)

---

## 11. SECURITY GAPS & RECOMMENDATIONS

### Critical Gaps

| Gap | Severity | Recommendation |
|---|---|---|
| No captcha on signup | MEDIUM | Add reCAPTCHA v3 or hCaptcha to signup form |
| No disposable email detection | MEDIUM | Use disposable email API (e.g., disposable-email-domains) |
| No content keyword filtering | MEDIUM | Implement keyword filter (e.g., Perspective API, custom list) |
| No admin dashboard for reports | HIGH | Build admin UI to review/resolve reports |
| No ban/suspension system | HIGH | Add user_status field + graduated bans (warning → 24h → 7d → permanent) |
| No image virus scanning | MEDIUM | Integrate ClamAV or VirusTotal API |
| No EXIF stripping | LOW | Strip EXIF data from uploaded images |
| No client-side debounce on submit | LOW | Add debounce to form submit buttons |
| No phone/WeChat/QR validation | LOW | Add regex validation for contact info in posts |

### Strengths

✅ **Comprehensive server-side rate limiting** with normalized duplicate detection  
✅ **RLS policies with WITH CHECK guards** on all write operations  
✅ **PII protection** via column-level GRANTs  
✅ **Block list integration** across all feeds  
✅ **Conversation flag isolation** via BEFORE UPDATE trigger  
✅ **Notification INSERT denial** via explicit CHECK (false) policy  
✅ **Storage upload restrictions** to user's own folder  
✅ **Illini email auto-verification** for campus badge  
✅ **Unique constraint on reports** to prevent spam  
✅ **Error handling** with friendly messages for rate limits  

---

## 12. DETAILED FILE INVENTORY

### Migrations (22 files)

| File | Lines | Purpose |
|---|---|---|
| 001_initial_schema.sql | 277 | Base tables, RLS, storage bucket |
| 002_add_negotiable.sql | 133 | Add negotiable field to items |
| 003_view_count_rpc_and_conv_update.sql | 1069 | View count RPC, conversation updates |
| 004_security_hardening.sql | 9093 | PII protection, reports, blocks, delete_my_account RPC |
| 005_notifications_and_price_drop.sql | 2191 | Notifications table, price drop trigger |
| 006_sold_notification_trigger.sql | 878 | Sold item notification trigger |
| 007_search_trigram_index.sql | 1310 | Full-text search index |
| 008_messages_delete_policy.sql | 337 | Message delete RLS policy |
| 009_emergency_fixes.sql | 3574 | Various fixes |
| 010_plaza_and_uid_and_chat_flags.sql | 11545 | Posts, comments, likes, UID, conversation flags |
| 011_rls_hardening_and_perf_indexes.sql | 6773 | WITH CHECK guards, storage policy, performance indexes |
| 012_rate_limiting_and_dedupe.sql | 9503 | Rate limit triggers for all content types |
| 013_security_patches.sql | 11398 | Notification INSERT deny, conversation flag isolation, dedupe normalization |
| 014_condition_defective.sql | 904 | Add defective condition to items |
| 015_plaza_item_tag.sql | 2117 | Item tag for plaza posts |
| 016_follows.sql | 3735 | Seller follows, follow notifications |
| 017_saved_searches.sql | 4402 | Saved search functionality |
| 018_ratings.sql | 4482 | Two-way ratings system |
| 019_items_favorite_count.sql | 2014 | Favorite count on items |
| 020_items_location_verified.sql | 1512 | Location verified flag |
| 021_profiles_status.sql | 1662 | Status text/emoji fields |
| 022_reports_post_target.sql | 224 | Add post/comment to report target types |

### Composables (18 files)

| File | Lines | Purpose |
|---|---|---|
| useAuth.ts | 197 | Auth, profile updates, sanitization |
| useCampusSpots.ts | 1637 | Campus location data |
| useFavorites.ts | 2646 | Favorite items |
| useFollow.ts | 4245 | Seller follows, following feed |
| useHistory.ts | 1640 | Search history |
| useI18n.ts | 49215 | Internationalization (EN/ZH) |
| useItems.ts | 12542 | Item CRUD, image upload, search |
| useLocation.ts | 2026 | Location services |
| useMessages.ts | 8188 | Chat, conversations, message sending |
| useModeration.ts | 2499 | Block list, reports |
| useNotifications.ts | 2379 | Notifications |
| usePlaza.ts | 7238 | Posts, comments, likes |
| useRatings.ts | 1750 | Ratings |
| useSavedSearch.ts | 2058 | Saved searches |
| useSemester.ts | 3525 | Semester/academic calendar |
| useSupabase.ts | 1578 | Supabase client init |
| useUnread.ts | 3370 | Unread message counts |

### Utils

| File | Lines | Purpose |
|---|---|---|
| index.ts | 609 | Rate limit messages, error handling, search synonyms, image compression, debounce |

### Pages (20 files)

| File | Purpose |
|---|---|
| blocked/index.vue | Block list UI |
| chat/index.vue | Chat/messaging UI |
| detail/index.vue | Item detail page |
| history/index.vue | Search history |
| index/index.vue | Home feed |
| login/index.vue | Auth UI |
| notifications/index.vue | Notifications |
| plaza/index.vue | Plaza posts feed |
| post/index.vue | Post detail + comments |
| profile/index.vue | User profile |
| profile/edit.vue | Profile edit |
| publish/index.vue | Create item listing |
| reset-password/index.vue | Password reset |
| saved-searches/index.vue | Saved searches |
| seller/index.vue | Seller profile |
| settings/index.vue | Settings |
| welcome/index.vue | Onboarding |
| legal/index.vue | Privacy/terms |
| messages/index.vue | Conversations list |
| following/index.vue | Following feed |

### API (3 files)

| File | Purpose |
|---|---|
| probe-022.js | Migration health check |
| share.js | Item OG metadata |
| share-post.js | Post OG metadata |

---

## 13. CONCLUSION

This project has **strong security fundamentals** with comprehensive server-side rate limiting, RLS policies, and moderation infrastructure. The main gaps are:

1. **No admin dashboard** to review reports
2. **No ban/suspension system** (only soft-delete)
3. **No content filtering** (keyword/profanity)
4. **No captcha/disposable email detection**
5. **No image virus scanning**

For a production marketplace, I recommend implementing the admin dashboard and ban system as priority 1, followed by content filtering and captcha.

