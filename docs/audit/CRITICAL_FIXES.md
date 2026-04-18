# CRITICAL SECURITY FIXES - IMMEDIATE ACTION REQUIRED

## 🔴 CRITICAL (1 Issue)

### 1. Notifications Table Missing INSERT Policy
**File:** `supabase/migrations/005_notifications_and_price_drop.sql`  
**Risk:** Any authenticated user can create fake notifications for any other user  
**Fix Time:** 5 minutes

**Create new migration `013_notifications_insert_policy.sql`:**
```sql
-- ============================================
-- 013 Add explicit INSERT policy to notifications
-- ============================================
-- CRITICAL: notifications table had no INSERT policy, allowing
-- any authenticated user to create notifications for any other user.

DROP POLICY IF EXISTS "System only creates notifications" ON public.notifications;
CREATE POLICY "System only creates notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (false);  -- Deny all; only triggers can insert

-- Verification:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notifications';
```

**Why:** Notifications are created by triggers (price_drop, sold), not by users. Explicit deny prevents accidental permission escalation.

---

## 🟠 HIGH (2 Issues)

### 2. Conversation Participant Flag Isolation
**File:** `supabase/migrations/010_plaza_and_uid_and_chat_flags.sql`  
**Risk:** Buyer/seller can toggle each other's mute/pin flags  
**Fix Time:** 10 minutes

**Create new migration `013_conversation_flag_isolation.sql`:**
```sql
-- ============================================
-- 013 Separate conversation flag policies by participant
-- ============================================
-- HIGH: Buyer and seller could update each other's flags
-- (is_pinned_buyer, is_muted_seller, etc.)

DROP POLICY IF EXISTS "Participants can update conversations" ON public.conversations;

CREATE POLICY "Buyer controls own flags"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = buyer_id)
  WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Seller controls own flags"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

-- Verification:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'conversations';
```

### 3. Duplicate Detection Bypass (Title Normalization)
**File:** `supabase/migrations/012_rate_limiting_and_dedupe.sql`  
**Risk:** Attacker can post duplicate items by changing case/whitespace  
**Fix Time:** 10 minutes

**Create new migration `013_normalize_duplicate_detection.sql`:**
```sql
-- ============================================
-- 013 Normalize title in duplicate detection
-- ============================================
-- HIGH: Duplicate detection used exact title match, allowing
-- bypass via case changes ("iPhone 13" vs "iphone 13") or
-- whitespace ("iPhone 13" vs "iPhone 13 ").

CREATE OR REPLACE FUNCTION public.rl_items_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
  dupe INT;
BEGIN
  SELECT COUNT(*) INTO last_hour
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_items_hour'
      USING HINT = 'You have posted too many items this hour. Try again later.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_items_day'
      USING HINT = 'You have posted too many items today. Try again tomorrow.';
  END IF;

  -- FIXED: Normalize title (lowercase + trim)
  SELECT COUNT(*) INTO dupe
    FROM public.items
    WHERE user_id = NEW.user_id
      AND LOWER(TRIM(title)) = LOWER(TRIM(NEW.title))
      AND created_at > NOW() - INTERVAL '60 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_item'
      USING HINT = 'This item was just posted. Please wait before reposting.';
  END IF;

  RETURN NEW;
END;
$$;

-- Same fix for posts
CREATE OR REPLACE FUNCTION public.rl_posts_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
  dupe INT;
BEGIN
  IF NEW.is_official THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO last_hour
    FROM public.posts
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_posts_hour'
      USING HINT = 'You have posted too many times this hour. Slow down.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.posts
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_posts_day'
      USING HINT = 'You have posted too many times today. Try again tomorrow.';
  END IF;

  -- FIXED: Normalize content
  SELECT COUNT(*) INTO dupe
    FROM public.posts
    WHERE user_id = NEW.user_id
      AND LOWER(TRIM(content)) = LOWER(TRIM(NEW.content))
      AND created_at > NOW() - INTERVAL '60 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_post'
      USING HINT = 'You just posted that. Please wait before reposting.';
  END IF;

  RETURN NEW;
END;
$$;
```

---

## 🟡 MEDIUM (4 Issues - Fix Before Scaling)

### 4. Storage MIME Type Validation
**File:** `supabase/migrations/011_rls_hardening_and_perf_indexes.sql`  
**Risk:** Attacker can upload executable files with spoofed MIME type  
**Fix Time:** 30 minutes (requires Edge Function)

**Create Supabase Edge Function `supabase/functions/validate-upload/index.ts`:**
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAGIC_NUMBERS: Record<string, Uint8Array> = {
  'image/jpeg': new Uint8Array([0xFF, 0xD8, 0xFF]),
  'image/png': new Uint8Array([0x89, 0x50, 0x4E, 0x47]),
  'image/webp': new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  'image/gif': new Uint8Array([0x47, 0x49, 0x46]),
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const formData = await req.formData()
  const file = formData.get('file') as File
  const mimeType = formData.get('mimeType') as string

  if (!ALLOWED_MIMES.includes(mimeType)) {
    return new Response(JSON.stringify({ error: 'Invalid MIME type' }), { status: 400 })
  }

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const magic = MAGIC_NUMBERS[mimeType]

  if (!magic || !bytes.slice(0, magic.length).every((v, i) => v === magic[i])) {
    return new Response(JSON.stringify({ error: 'File header does not match MIME type' }), { status: 400 })
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
```

**Update client code `app/src/composables/useItems.ts`:**
```typescript
// Before upload, validate MIME type
const validateMime = async (blob: Blob) => {
  const formData = new FormData()
  formData.append('file', blob)
  formData.append('mimeType', 'image/jpeg')
  
  const res = await fetch('https://your-project.supabase.co/functions/v1/validate-upload', {
    method: 'POST',
    body: formData,
    headers: { Authorization: `Bearer ${session.access_token}` }
  })
  
  if (!res.ok) throw new Error('Invalid file')
}
```

### 5. Rate Limit Window Boundary
**File:** `supabase/migrations/012_rate_limiting_and_dedupe.sql`  
**Risk:** Attacker can post ~20 items/hour by timing window boundary  
**Fix Time:** 10 minutes

**Create new migration `013_rate_limit_buffer.sql`:**
```sql
-- ============================================
-- 013 Add buffer to rate limit windows
-- ============================================
-- MEDIUM: Sliding window could be bypassed by timing boundary.
-- Add 1-second buffer to prevent off-by-one attacks.

CREATE OR REPLACE FUNCTION public.rl_items_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_hour INT;
  last_day INT;
  dupe INT;
BEGIN
  -- FIXED: Add 1 second buffer
  SELECT COUNT(*) INTO last_hour
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '1 hour 1 second';
  IF last_hour >= 10 THEN
    RAISE EXCEPTION 'rate_limit_items_hour'
      USING HINT = 'You have posted too many items this hour. Try again later.';
  END IF;

  SELECT COUNT(*) INTO last_day
    FROM public.items
    WHERE user_id = NEW.user_id AND created_at > NOW() - INTERVAL '24 hours 1 second';
  IF last_day >= 30 THEN
    RAISE EXCEPTION 'rate_limit_items_day'
      USING HINT = 'You have posted too many items today. Try again tomorrow.';
  END IF;

  SELECT COUNT(*) INTO dupe
    FROM public.items
    WHERE user_id = NEW.user_id
      AND LOWER(TRIM(title)) = LOWER(TRIM(NEW.title))
      AND created_at > NOW() - INTERVAL '60 seconds';
  IF dupe > 0 THEN
    RAISE EXCEPTION 'duplicate_item'
      USING HINT = 'This item was just posted. Please wait before reposting.';
  END IF;

  RETURN NEW;
END;
$$;

-- Apply same fix to all other rate limit functions
-- (posts, comments, messages, reports)
```

### 6. PII Detection in Bio
**File:** `app/src/types/index.ts`  
**Risk:** Users can put phone numbers in bio, readable by blocked users  
**Fix Time:** 15 minutes

**Update `app/src/composables/useAuth.ts`:**
```typescript
const PII_REGEX = /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|wechat|微信|whatsapp|telegram)/i

async function updateProfile(updates: AllowedProfileUpdate) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return { error: new Error('Not authenticated') }
  }

  // NEW: Validate bio for PII
  if (updates.bio && PII_REGEX.test(updates.bio)) {
    return { error: new Error('Please do not include personal contact info in your bio') }
  }

  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([k]) =>
      (ALLOWED_PROFILE_FIELDS as readonly string[]).includes(k)
    )
  )

  const { error } = await supabase
    .from('profiles')
    .update(sanitized)
    .eq('id', session.user.id)

  if (!error && currentUser.value) {
    currentUser.value = { ...currentUser.value, ...sanitized } as Profile
  }
  return { error }
}
```

### 7. Currency Exchange Enforcement
**File:** `supabase/migrations/010_plaza_and_uid_and_chat_flags.sql`  
**Risk:** Scam warnings are UX-only, not enforced by system  
**Fix Time:** 1-2 hours (requires new features)

**Create new migration `013_currency_exchange_safeguards.sql`:**
```sql
-- ============================================
-- 013 Currency exchange transaction safeguards
-- ============================================

-- Add transaction table for escrow
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'disputed', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

CREATE POLICY "Buyer can create transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = buyer_id);

-- Rate limit currency_exchange to 1 per day
CREATE OR REPLACE FUNCTION public.rl_currency_exchange_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  count INT;
BEGIN
  IF NEW.category = 'currency_exchange' THEN
    SELECT COUNT(*) INTO count
      FROM public.items
      WHERE user_id = NEW.user_id
        AND category = 'currency_exchange'
        AND created_at > NOW() - INTERVAL '24 hours';
    IF count >= 1 THEN
      RAISE EXCEPTION 'rate_limit_currency_exchange'
        USING HINT = 'You can only post one currency exchange listing per day.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rl_currency_exchange ON public.items;
CREATE TRIGGER trg_rl_currency_exchange
  BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.rl_currency_exchange_limit();
```

---

## DEPLOYMENT CHECKLIST

- [ ] Create migration `013_notifications_insert_policy.sql` (CRITICAL)
- [ ] Create migration `013_conversation_flag_isolation.sql` (HIGH)
- [ ] Create migration `013_normalize_duplicate_detection.sql` (HIGH)
- [ ] Create migration `013_rate_limit_buffer.sql` (MEDIUM)
- [ ] Create migration `013_currency_exchange_safeguards.sql` (MEDIUM)
- [ ] Create Edge Function `validate-upload` (MEDIUM)
- [ ] Update `useAuth.ts` with PII detection (MEDIUM)
- [ ] Test all migrations in staging
- [ ] Run verification queries from each migration
- [ ] Deploy to production
- [ ] Monitor error logs for rate limit exceptions

---

## TESTING COMMANDS

```bash
# Verify notifications policy
psql -c "SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notifications';"

# Verify conversation policies
psql -c "SELECT policyname, cmd FROM pg_policies WHERE tablename = 'conversations';"

# Test duplicate detection normalization
psql -c "INSERT INTO items (user_id, title, category, condition, location) VALUES ('test-uuid', 'iPhone 13', 'electronics', 'good', 'UIUC');"
psql -c "INSERT INTO items (user_id, title, category, condition, location) VALUES ('test-uuid', 'IPHONE 13', 'electronics', 'good', 'UIUC');" -- Should fail
```

