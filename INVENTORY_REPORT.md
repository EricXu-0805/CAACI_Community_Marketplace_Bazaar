# CAACI Community Marketplace Bazaar - Comprehensive Inventory Report

## A. i18n / Language System for USER-GENERATED Content

### Current Implementation

**File: `app/src/composables/useI18n.ts` (lines 1-965)**

#### Language Storage & Switching
- **Current Language**: Stored in `currentLang` ref (default: 'zh')
- **Persistence**: Uses `uni.getStorageSync('lang')` and `uni.setStorageSync('lang', lang)`
- **Supported Languages**: 'en' | 'zh' (English and Chinese)
- **Toggle Function**: `toggleLang()` switches between 'zh' ↔ 'en'

#### Message Dictionary Structure
```typescript
const messages: Record<Lang, Record<string, string>> = {
  en: { /* 476 keys */ },
  zh: { /* 476 keys */ }
}
```

**Total Keys**: 476 UI label translations (lines 13-940)
- Navigation: nav.home, nav.plaza, nav.post, nav.messages, nav.profile
- Home/Search: home.search, home.loading, home.noMore, home.emptyTitle, etc.
- Categories: cat.all, cat.furniture, cat.electronics, cat.clothing, etc.
- Conditions: condition.new, condition.like_new, condition.good, condition.fair, condition.defective
- Detail page: detail.description, detail.save, detail.chat, detail.report, etc.
- Publishing: publish.title, publish.addPhoto, publish.price, publish.category, etc.
- Messages: msg.signIn, msg.empty, msg.deleteConv, etc.
- Profile: profile.signIn, profile.listed, profile.saved, profile.sold, etc.
- Chat: chat.empty, chat.placeholder, chat.makeOffer, chat.qrStillAvailable, etc.
- Plaza: plaza.title, plaza.post, plaza.comment, plaza.like, plaza.delete, etc.
- Legal: legal.terms, legal.privacy, legal.termsBody, legal.privacyBody
- Login: login.signIn, login.signUp, login.agreement, login.agreeRequired, login.agreeCheckbox
- Settings: settings.language, settings.clearCache, settings.changePassword, etc.

### User-Generated Content Translation

**File: `app/src/utils/index.ts` (lines 474-571)**

#### `quickTranslate()` Function
```typescript
export function quickTranslate(text: string, targetLang: 'en' | 'zh'): string {
  if (!text) return text
  const dict = targetLang === 'zh' ? TRANSLATE_DICT : TRANSLATE_REV
  let result = text
  const entries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length)
  for (const [src, dst] of entries) {
    if (!src) continue
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = targetLang === 'zh'
      ? new RegExp(`\\b${escaped}\\b`, 'gi')
      : new RegExp(escaped, 'g')
    result = result.replace(pattern, dst)
  }
  return result
}
```

**Translation Method**: Static dictionary-based (NOT LLM, NOT server-side)
- Uses `TRANSLATE_DICT` (lines 474-550): 77 English → Chinese mappings
- Uses `TRANSLATE_REV` (lines 552-555): Reverse mapping (Chinese → English)
- Sorts by key length (longest first) to avoid partial matches
- Uses word-boundary regex for English (`\b`), global regex for Chinese
- **Limitation**: Only translates exact matches in the dictionary

#### Dictionary Coverage (77 entries)
**Furniture**: desk, chair, table, bed, mattress, sofa, couch, lamp, mirror, rug, shelf, bookshelf, wardrobe, dresser, fridge, microwave, oven, fan, ac
**Electronics**: laptop, computer, pc, monitor, keyboard, mouse, phone, iphone, ipad, tablet, airpods, headphones, charger, cable, battery, camera, guitar, piano, book, textbook, notebook, backpack, bag, shoes, sneakers, jacket, coat, hoodie, shirt, pants, jeans, dress, hat, scarf
**Vehicles**: bike, bicycle, car, scooter, helmet
**Housing**: apartment, sublease, sublet, rent
**Appliances**: fridge, refrigerator, microwave, oven, fan, ac
**Other**: new, like new, used, excellent, good, fair, free, negotiable, obo, pickup, delivery, price

### Where `quickTranslate()` is Called

**File: `app/src/pages/index/index.vue` (line 251, 355)**
```typescript
function localizeTitle(title: string): string {
  if (!title) return ''
  return quickTranslate(title, lang.value as 'en' | 'zh')
}
// Called on line 251:
<text class="card-title">{{ localizeTitle(item.title) }}</text>
```

**File: `app/src/pages/plaza/index.vue` (line 94)**
```typescript
<text class="aic-title">{{ post.attached_item.title }}</text>
// NOT translated — uses raw title
```

**File: `app/src/pages/post/index.vue`**
- No translation of item titles in attached items

### What CAN Be Translated Now

1. **Item Titles** (home page cards): Via `quickTranslate()` on line 251 of index/index.vue
   - Only if title contains exact dictionary matches (e.g., "laptop", "desk", "iPhone")
   - Example: "Used laptop" → "二手笔记本电脑" (if lang='zh')

2. **UI Labels**: All 476 keys in `messages` dictionary
   - Navigation, buttons, placeholders, error messages, etc.

3. **Item Descriptions**: NOT translated (stored as-is in database)

4. **Plaza Posts**: NOT translated (stored as-is in database)

5. **Comments**: NOT translated (stored as-is in database)

6. **Chat Messages**: NOT translated (stored as-is in database)

### What CAN'T Be Translated

1. **Item Descriptions**: No translation pipeline exists
2. **Plaza Posts & Comments**: No translation pipeline exists
3. **Chat Messages**: No translation pipeline exists
4. **Item Titles with No Dictionary Match**: 
   - Example: "MacBook Pro 2023" → stays in English even if lang='zh'
   - Only 77 common terms are in the dictionary
5. **Server-Side Translation**: No API endpoint for translation
6. **Dynamic Translation**: No LLM integration (e.g., Claude, Google Translate API)

### Why Item Titles Appear in Source Language Only

**Root Cause**: The `quickTranslate()` function only translates exact dictionary matches.

**Example Scenario**:
- User posts: "iPhone 15 Pro Max in excellent condition"
- Dictionary has: "iphone" → "iPhone", "excellent" → "极佳"
- Result in Chinese UI: "iPhone 15 Pro Max in 极佳 condition" (mixed language)
- Result in English UI: "iPhone 15 Pro Max in excellent condition" (unchanged)

**Why This Happens**:
1. Most item titles are in English (user input)
2. Dictionary is small (77 entries) and covers only common product names
3. No context-aware translation (e.g., "condition" field is separate from title)
4. No server-side translation service

### Recommendation for Full i18n

To properly translate user-generated content:
1. Add a `language` field to `items`, `posts`, `post_comments`, `messages` tables
2. Integrate a translation API (Google Translate, DeepL, or Claude API)
3. Translate on-insert or on-demand (lazy loading)
4. Cache translations in database to avoid repeated API calls
5. Expand `TRANSLATE_DICT` with more product names and common phrases

---

## B. Onboarding & ToS Flow for New Users

### Welcome Page

**File: `app/src/pages/welcome/index.vue` (lines 1-75)**

- **Purpose**: 3-slide onboarding carousel
- **Slides**:
  1. "Buy & Sell Near Campus" (🛍) - furniture, electronics, textbooks
  2. "Chat Directly" (💬) - message sellers, negotiate, arrange meetups
  3. "Safe & Trusted" (🛡) - UIUC community, campus safe zones
- **Skip/Start Button**: "Skip" on slides 1-2, "Get Started" on slide 3
- **Persistence**: Sets `welcomed` flag in localStorage on completion
- **Navigation**: Redirects to `/pages/index/index` (home page)

### Login/Signup Flow

**File: `app/src/pages/login/index.vue` (lines 1-313)**

#### Signup Tab (mode === 'signup')
- **Fields**:
  1. Nickname (required, max 40 chars)
  2. Email (required, must be valid)
  3. Password (required, min 8 chars)
  4. Password visibility toggle

#### ToS Agreement Checkbox
**Lines 69-79**:
```vue
<view class="agreement-row" v-if="mode === 'signup'" @click="agreed = !agreed">
  <view :class="['agree-check', { on: agreed }]">
    <view v-if="agreed" class="check-mark"></view>
  </view>
  <text class="agree-text">
    <text>{{ t('login.agreePrefix') }}</text>
    <text class="link" @click.stop="goLegal('terms')">{{ t('legal.terms') }}</text>
    <text>{{ t('login.agreeAnd') }}</text>
    <text class="link" @click.stop="goLegal('privacy')">{{ t('legal.privacy') }}</text>
  </text>
</view>
```

**i18n Keys**:
- `login.agreePrefix`: "By signing up you agree to our" / "注册即表示同意"
- `legal.terms`: "Terms of Service" / "用户协议"
- `login.agreeAnd`: "and" / "和"
- `legal.privacy`: "Privacy Policy" / "隐私政策"

#### Enforcement
**Lines 153-156**:
```typescript
if (!agreed.value) {
  uni.showToast({ title: t('login.agreeRequired'), icon: 'none', duration: 2500 })
  return
}
```

**Status**: ✅ **BLOCKING** - User cannot sign up without checking the box
- Error message: "Please agree to the Terms and Privacy Policy to sign up" / "请先同意《用户协议》与《隐私政策》"

#### Signup Success Flow
**Lines 157-171**:
1. Call `signUp(email, password, nickname)`
2. If email already registered: show "This email is already registered"
3. If email confirmation required: show modal "Check your email" with confirmation link hint
4. If signup succeeds: show "Account created!" and navigate back

### Legal Pages

**File: `app/src/pages/legal/index.vue` (lines 1-68)**

- **Route**: `/pages/legal/index?type=privacy` (privacy) or default (terms)
- **Content**: Full text in i18n keys:
  - `legal.termsBody`: 12 sections (lines 280 in useI18n.ts)
  - `legal.privacyBody`: 10 sections (lines 281 in useI18n.ts)
- **Contact**: Email link to `illini.market.help@gmail.com`
- **Accessibility**: Clickable email (H5: opens mailto, native: copies to clipboard)

#### Terms of Service Summary (lines 280)
1. Eligibility: 18+, UIUC/Champaign-Urbana community
2. Accounts: No sharing, no multi-accounting, no impersonation
3. Listings: Legal items only, prohibited list (firearms, drugs, stolen goods, etc.)
4. Prohibited Conduct: No harassment, hate speech, threats, doxxing, spam, phishing
5. Transactions: No escrow, meet in public, never wire before seeing item
6. Content License: Non-exclusive, worldwide, royalty-free license to host/display
7. Plaza: No commercial spam, no off-platform solicitation, no political campaigning, no NSFW
8. IP: Respect copyrights and trademarks
9. Termination: Can suspend/terminate accounts, users can self-delete
10. Disclaimers: "As is" without warranties
11. Applicable Law: Illinois law
12. Updates: Material changes notified in-app

#### Privacy Policy Summary (lines 281)
1. Data Collected: Account (email, nickname, avatar, bio, location), listings, messages, device (IP, browser, geolocation)
2. Usage: Operate marketplace, authenticate, deliver messages, prevent fraud, improve service
3. Sharing: With other users (nickname, avatar, bio, listings visible; email/phone hidden), with service providers (Supabase, Vercel), with law enforcement (valid legal process only)
4. Storage: Supabase (AWS us-east-1), RLS policies, hashed passwords
5. Retention: While account active; 30 days after deletion; anonymized records for fraud prevention
6. User Rights: View/edit profile, delete account, request data copy, block/report users
7. Children: Not for under-18
8. Cookies: Session cookies only, no third-party ads
9. International: Data processed in US
10. Updates: Material changes notified in-app

### Reset Password Flow

**File: `app/src/pages/reset-password/index.vue` (lines 1-161)**

- **Route**: Accessed via email link with reset token
- **Flow**:
  1. Verify reset link validity (check session)
  2. If invalid: show error "This reset link is invalid or has expired"
  3. If valid: show form with "New password" and "Confirm password" fields
  4. Validate: passwords match, min 8 chars
  5. On success: "Password reset successfully" → redirect to home
- **No ToS Re-agreement**: Just password reset, no legal flow

### Profile Completeness Nudge

**Status**: ❌ **NOT IMPLEMENTED**
- No "complete your profile" prompt after signup
- No profile completeness percentage indicator
- No nudge to add avatar, bio, or location

### First-Run Guided Tour / Coach-Marks

**Status**: ❌ **NOT IMPLEMENTED**
- Welcome carousel exists but is just 3 static slides
- No interactive tooltips or coach-marks
- No "tap here to post" or "swipe to filter" hints
- No feature discovery overlays

### Database: Consent/ToS Tracking

**Status**: ❌ **NOT STORED**
- No `agreed_terms`, `tos_version`, `privacy_version`, `consent_timestamp` fields in `profiles` table
- No audit trail of when user agreed to ToS
- No version tracking if ToS is updated
- **Risk**: Cannot prove user agreed to specific version of ToS

### Recommendation

1. Add to `profiles` table:
   ```sql
   ALTER TABLE profiles ADD COLUMN agreed_tos_version TEXT;
   ALTER TABLE profiles ADD COLUMN agreed_tos_at TIMESTAMPTZ;
   ALTER TABLE profiles ADD COLUMN agreed_privacy_version TEXT;
   ALTER TABLE profiles ADD COLUMN agreed_privacy_at TIMESTAMPTZ;
   ```

2. Update on signup to record version and timestamp

3. Add profile completeness nudge:
   - Show banner after signup: "Complete your profile" (avatar, bio, location)
   - Track completion percentage
   - Offer incentive (e.g., "Verified sellers get more views")

4. Add guided tour:
   - First-time home page: highlight search, filters, post button
   - First-time plaza: highlight compose button, like/comment actions
   - Use overlay + tooltip library (e.g., Shepherd.js)

---

## C. Plaza Post Card Action-Button Alignment

### Plaza Post Actions

**File: `app/src/pages/plaza/index.vue` (lines 101-116, 778-811)**

#### HTML Structure
```vue
<view class="post-actions">
  <view class="pa-btn" @click.stop="onToggleLike(post)">
    <image :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'" class="heart-img" />
    <text :class="['pa-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
  </view>
  <view class="pa-btn" @click.stop="openComments(post)">
    <view class="bubble-ico"></view>
    <text class="pa-num">{{ post.comment_count }}</text>
  </view>
  <view class="pa-btn" @click.stop="onSharePost(post)">
    <view class="share-ico"></view>
  </view>
</view>
```

#### CSS (lines 778-811)
```scss
.post-actions {
  display: flex; gap: 24px; margin-top: 12px;
  padding-top: 10px; border-top: 0.5px solid rgba(0,0,0,0.05);
}
.pa-btn {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.heart-img {
  width: 20px; height: 20px; transition: transform 0.15s;
  &:active { transform: scale(1.2); }
}
.pa-num { font-size: 12px; color: #8e8e93; font-weight: 500; &.active { color: #FF3B30; } }
.bubble-ico {
  width: 18px; height: 15px; border: 1.8px solid #8e8e93;
  border-radius: 8px 8px 8px 2px;
}
.share-ico {
  width: 16px; height: 16px; position: relative;
  &::before { /* vertical line */ }
  &::after { /* arrow */ }
}
```

#### Analysis
✅ **ALIGNED CORRECTLY**
- `.post-actions`: `display: flex; gap: 24px;` (equal spacing)
- `.pa-btn`: `display: flex; align-items: center;` (vertical center alignment)
- All buttons have same height (flex items auto-stretch)
- Gap: 24px between buttons (consistent)
- **Status**: Buttons ARE on the same horizontal line

---

### Home Page Item Card Bottom

**File: `app/src/pages/index/index.vue` (lines 256-275, 989-999)**

#### HTML Structure
```vue
<view class="card-bottom">
  <view class="card-seller">
    <image :src="item.profile?.avatar_url || '/static/default-avatar.svg'" class="seller-pic" />
    <text class="seller-nick">{{ item.profile?.nickname || t('app.user') }}</text>
    <text class="card-time">{{ formatTime(item.created_at) }}</text>
  </view>
  <view class="card-fav">
    <text v-if="isOldItem(item.created_at)" class="old-tag">{{ t('home.oldListing') }}</text>
    <image :src="isFavorited(item.id) ? '/static/heart-filled.svg' : '/static/heart.svg'" class="heart-img" @click.stop="onQuickFav(item)" />
    <text class="fav-num">{{ item.favorite_count || 0 }}</text>
  </view>
</view>
```

#### CSS (lines 989-999)
```scss
.card-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; }
.card-seller { display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0; }
.seller-pic { width: 16px; height: 16px; border-radius: 50%; background: #f0f0f0; flex-shrink: 0; }
.seller-nick { font-size: 11px; color: #8e8e93; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-fav { display: flex; align-items: center; gap: 4px; flex-shrink: 0; padding: 4px 2px; }
.heart-img { width: 18px; height: 18px; cursor: pointer; transition: transform 0.15s; &:active { transform: scale(1.25); } }
.fav-num { font-size: 10px; color: #aeaeb2; }
```

#### Analysis
✅ **ALIGNED CORRECTLY**
- `.card-bottom`: `display: flex; justify-content: space-between; align-items: center;`
- `.card-seller`: `display: flex; align-items: center;` (left side)
- `.card-fav`: `display: flex; align-items: center;` (right side)
- Both sides vertically centered with `align-items: center`
- **Status**: Seller info and favorite button ARE on the same horizontal line

---

### Post Detail Page Stats Row

**File: `app/src/pages/post/index.vue` (lines 40-55, 419-447)**

#### HTML Structure
```vue
<view class="stats-row">
  <view class="stat-btn" @click="onToggleLike">
    <image :src="post.liked_by_me ? '/static/heart-filled.svg' : '/static/heart.svg'" class="heart-img" />
    <text :class="['stat-num', { active: post.liked_by_me }]">{{ post.like_count }}</text>
  </view>
  <view class="stat-btn">
    <view class="bubble-ico"></view>
    <text class="stat-num">{{ post.comment_count }}</text>
  </view>
  <view class="stat-btn" @click="onShare">
    <view class="share-ico"></view>
  </view>
</view>
```

#### CSS (lines 419-447)
```scss
.stats-row {
  display: flex; gap: 28px; margin-top: 16px;
  padding-top: 14px; border-top: 0.5px solid rgba(0,0,0,0.06);
}
.stat-btn {
  display: flex; align-items: center; gap: 6px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  &:active { opacity: 0.6; }
}
.heart-img { width: 22px; height: 22px; }
.stat-num { font-size: 13px; color: #8e8e93; font-weight: 500; &.active { color: #FF3B30; } }
.bubble-ico { width: 20px; height: 16px; border: 1.8px solid #8e8e93; border-radius: 9px 9px 9px 2px; }
.share-ico { width: 18px; height: 18px; position: relative; /* ... */ }
```

#### Analysis
✅ **ALIGNED CORRECTLY**
- `.stats-row`: `display: flex; gap: 28px;`
- `.stat-btn`: `display: flex; align-items: center;`
- All buttons vertically centered
- **Status**: Like, comment, share buttons ARE on the same horizontal line

---

### Conclusion

**All action buttons are properly aligned.** The CSS uses flexbox with `align-items: center` consistently, ensuring vertical centering. If the user perceives misalignment, it may be due to:
1. Icon size differences (e.g., heart 20px vs bubble 15px height)
2. Text baseline differences (font-size 12px vs 13px)
3. Padding/margin on individual elements
4. Browser rendering differences

**Recommendation**: If visual misalignment is still perceived, add explicit `height` to `.pa-btn` and `.stat-btn`:
```scss
.pa-btn { height: 32px; }
.stat-btn { height: 32px; }
```

---

## D. Self-Reply Capability on Plaza

### Current Behavior: Self-Reply is BLOCKED

**File: `app/src/pages/plaza/index.vue` (lines 538-542)**

```typescript
function onCommentTap(c: PostComment) {
  if (!currentUser.value) return
  if (c.user_id === currentUser.value.id) return  // ← BLOCKS SELF-REPLY
  replyTo.value = c
}
```

**Effect**: Clicking on your own comment does nothing (no reply-to state set)

### Similar Guard in Post Detail Page

**File: `app/src/pages/post/index.vue` (lines 228-232)**

```typescript
function onCommentTap(c: PostComment) {
  if (!currentUser.value) return
  if (c.user_id === currentUser.value.id) return  // ← BLOCKS SELF-REPLY
  replyTo.value = c
}
```

**Same behavior**: Self-reply blocked

### Long-Press Menu (Alternative Path)

**File: `app/src/pages/plaza/index.vue` (lines 544-573)**

```typescript
function onCommentLongPress(c: PostComment) {
  if (!currentUser.value) return
  const isMine = c.user_id === currentUser.value.id
  const items = isMine ? [t('plaza.delete')] : [t('plaza.reply'), t('plaza.report')]
  // If isMine: only "Delete" option
  // If not mine: "Reply" and "Report" options
}
```

**Effect**: Own comments show only "Delete" in long-press menu, no "Reply" option

### Database Schema: No Constraint

**File: `supabase/migrations/010_plaza_and_uid_and_chat_flags.sql` (lines 178-185)**

```sql
CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 1000),
  parent_comment_id UUID REFERENCES public.post_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Analysis**:
- No CHECK constraint preventing `user_id == parent_comment.user_id`
- Database allows self-replies technically
- **Blocking is purely frontend logic**

### RLS Policies: No Restriction

**File: `supabase/migrations/010_plaza_and_uid_and_chat_flags.sql` (lines 195-197)**

```sql
DROP POLICY IF EXISTS "Authenticated users can comment" ON public.post_comments;
CREATE POLICY "Authenticated users can comment"
  ON public.post_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
```

**Analysis**:
- RLS only checks `auth.uid() = user_id` (user owns the comment)
- No restriction on `parent_comment_id`
- **Backend allows self-replies**

### Recommendation to Enable Self-Reply

1. **Remove frontend guard** in `plaza/index.vue` line 540:
   ```typescript
   function onCommentTap(c: PostComment) {
     if (!currentUser.value) return
     // Remove: if (c.user_id === currentUser.value.id) return
     replyTo.value = c
   }
   ```

2. **Update long-press menu** in `plaza/index.vue` line 547:
   ```typescript
   const items = isMine ? [t('plaza.delete'), t('plaza.reply')] : [t('plaza.reply'), t('plaza.report')]
   ```

3. **Same changes in `post/index.vue`** (lines 228-237)

4. **Optional: Add database constraint** to prevent accidental self-replies:
   ```sql
   ALTER TABLE post_comments ADD CONSTRAINT no_self_reply 
   CHECK (parent_comment_id IS NULL OR user_id != (SELECT user_id FROM post_comments WHERE id = parent_comment_id));
   ```

---

## E. Plaza Compose-Button "文字提示" Discovery

### Current State: Icon-Only, No Text Label

**File: `app/src/pages/plaza/index.vue` (lines 7-9)**

```vue
<view class="compose-btn" @click="openComposer" v-if="isLoggedIn">
  <view class="cb-pen"></view>
</view>
```

#### CSS (lines 635-648)
```scss
.compose-btn {
  width: 34px; height: 34px; border-radius: 50%;
  background: #1a1a1a; display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  &:active { opacity: 0.8; }
}
.cb-pen {
  width: 14px; height: 14px; position: relative;
  &::before {
    content: ''; position: absolute; inset: 0;
    background: #fff;
    clip-path: polygon(0 100%, 40% 100%, 100% 40%, 60% 0, 0 60%);
  }
}
```

**Current Design**:
- ✅ Black circular button (34×34px)
- ✅ White pen icon (14×14px, CSS clip-path)
- ❌ **No text label** (no "Write" or "发动态" text)
- ❌ **No tooltip** on hover
- ❌ **No aria-label** for accessibility

### Comparison: Tab Bar Post Button

**File: `app/src/components/CustomTabBar.vue`**

The tab bar has a "+" FAB (Floating Action Button) for posting items:
- **Location**: Bottom center of tab bar
- **Icon**: "+" symbol
- **Label**: "发布" (Chinese) / "Post" (English) — visible in tab bar
- **Accessibility**: Clear label in tab bar

### Confusion Risk

**Potential Issues**:
1. **Two post buttons**: Plaza compose button (pen icon) vs. Tab bar post button (+ icon)
2. **Unclear purpose**: Pen icon could mean "edit" rather than "write post"
3. **No discovery**: New users may not realize they can post in plaza
4. **Accessibility**: No aria-label for screen readers

### Recommendation

**Option 1: Add Text Label Below Icon**
```vue
<view class="compose-btn" @click="openComposer" v-if="isLoggedIn">
  <view class="cb-pen"></view>
  <text class="cb-label">{{ t('plaza.write') }}</text>
</view>
```

**CSS**:
```scss
.compose-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; padding: 4px;
  width: auto; height: auto; border-radius: 8px;
  background: #1a1a1a; cursor: pointer;
}
.cb-label { font-size: 10px; color: #fff; font-weight: 600; }
```

**Option 2: Add Tooltip on Hover**
```vue
<view class="compose-btn" @click="openComposer" v-if="isLoggedIn" :title="t('plaza.write')">
  <view class="cb-pen"></view>
</view>
```

**Option 3: Add aria-label for Accessibility**
```vue
<view class="compose-btn" @click="openComposer" v-if="isLoggedIn" :aria-label="t('plaza.write')">
  <view class="cb-pen"></view>
</view>
```

**Recommended**: Combine Option 1 + Option 3 for best UX and accessibility.

---

## F. Item Ranking Algorithm

### Current Sort Options

**File: `app/src/pages/index/index.vue` (lines 401-402)**

```typescript
const sortKeys = ['latest', 'price_asc', 'price_desc', 'popular']
const sortOpts = computed(() => sortKeys.map(k => ({ value: k, label: t('sort.' + k.replace('price_asc', 'priceAsc').replace('price_desc', 'priceDesc')) })))
```

**Available Sorts**:
1. `latest` - Most recent first (default)
2. `price_asc` - Price low to high
3. `price_desc` - Price high to low
4. `popular` - "Most popular" (label: `sort.popular` = "最热" / "Popular")

### Implementation: useItems Composable

**File: `app/src/composables/useItems.ts` (lines 41-125)**

```typescript
async function fetchItems(options: {
  page?: number
  category?: ItemCategory | null
  search?: string
  userId?: string
  priceMin?: number
  priceMax?: number
  condition?: ItemCondition | null
  sort?: string
  reset?: boolean
} = {}) {
  // ...
  const buildQuery = () => {
    let q = supabase
      .from('items')
      .select(`${fields}, profile:profiles(${publicProfileFields()})`)
      .eq('status', 'active')

    if (sort === 'price_asc') q = q.order('price', { ascending: true })
    else if (sort === 'price_desc') q = q.order('price', { ascending: false })
    else if (sort === 'popular') q = q.order('view_count', { ascending: false })  // ← POPULAR = VIEW COUNT
    else q = q.order('created_at', { ascending: false })  // ← DEFAULT = LATEST

    q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    // ... filters ...
    return q
  }
}
```

### "Popular" Algorithm Analysis

**Current Implementation** (line 71):
```typescript
else if (sort === 'popular') q = q.order('view_count', { ascending: false })
```

**What It Does**:
- Orders items by `view_count` descending (highest views first)
- **NOT** by favorite count
- **NOT** by time-decay (old items with many views rank high)
- **NOT** by engagement score (views + favorites + comments)

**Issues**:
1. ❌ **No favorite count sorting**: User requested "ranked by favorite count"
2. ❌ **No time-decay**: Old items with high views stay at top forever
3. ❌ **No engagement weighting**: Views are counted equally regardless of recency
4. ❌ **No trending algorithm**: No "hot" or "trending" option

### Database Fields Available

**File: `app/src/composables/useItems.ts` (lines 16-19)**

```typescript
const LIST_ITEM_FIELDS_FULL =
  'id, user_id, title, price, category, condition, status, location, location_verified, images, view_count, favorite_count, negotiable, created_at'
```

**Available for Ranking**:
- `view_count` (currently used for "popular")
- `favorite_count` (NOT currently used)
- `created_at` (used for "latest")
- `price` (used for price sorts)

### Recommendation: Add Favorite-Based Ranking

**Option 1: Add "Favorite Count" Sort**
```typescript
const sortKeys = ['latest', 'price_asc', 'price_desc', 'popular', 'favorites']

// In buildQuery():
else if (sort === 'favorites') q = q.order('favorite_count', { ascending: false })
else if (sort === 'popular') q = q.order('view_count', { ascending: false })
```

**Option 2: Improve "Popular" with Time-Decay**
```typescript
// In buildQuery():
else if (sort === 'popular') {
  // Fetch all active items, then sort in JavaScript with time-decay
  q = q.order('created_at', { ascending: false })
}

// After fetching:
if (sort === 'popular') {
  const now = Date.now()
  const DECAY_DAYS = 30
  data.sort((a, b) => {
    const ageA = (now - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24)
    const ageB = (now - new Date(b.created_at).getTime()) / (1000 * 60 * 60 * 24)
    const scoreA = a.favorite_count / (1 + ageA / DECAY_DAYS)
    const scoreB = b.favorite_count / (1 + ageB / DECAY_DAYS)
    return scoreB - scoreA
  })
}
```

**Option 3: Add "Trending" Sort (Recommended)**
```typescript
const sortKeys = ['latest', 'price_asc', 'price_desc', 'popular', 'trending']

// In buildQuery():
else if (sort === 'trending') {
  // Trending = (favorites + views/10) / (1 + age_in_days/7)
  // Requires client-side calculation
  q = q.order('created_at', { ascending: false })
}

// After fetching:
if (sort === 'trending') {
  const now = Date.now()
  data.sort((a, b) => {
    const ageA = (now - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24)
    const ageB = (now - new Date(b.created_at).getTime()) / (1000 * 60 * 60 * 24)
    const scoreA = (a.favorite_count + a.view_count / 10) / (1 + ageA / 7)
    const scoreB = (b.favorite_count + b.view_count / 10) / (1 + ageB / 7)
    return scoreB - scoreA
  })
}
```

### Current Sort UI

**File: `app/src/pages/index/index.vue` (lines 165-177)**

```vue
<view class="fs-section">
  <text class="fs-label">{{ t('filter.sort') }}</text>
  <view class="fs-pills">
    <view
      v-for="s in sortOpts"
      :key="s.value"
      :class="['fpill', { active: sortBy === s.value }]"
      @click="sortBy = s.value"
    >
      <text>{{ s.label }}</text>
    </view>
  </view>
</view>
```

**i18n Labels** (from `useI18n.ts`):
- `sort.latest`: "Latest" / "最新"
- `sort.priceAsc`: "Price ↑" / "价格↑"
- `sort.priceDesc`: "Price ↓" / "价格↓"
- `sort.popular`: "Popular" / "最热"

### Summary

| Sort | Current | Recommended |
|------|---------|-------------|
| Latest | ✅ Works (created_at DESC) | ✅ Keep |
| Price ↑ | ✅ Works (price ASC) | ✅ Keep |
| Price ↓ | ✅ Works (price DESC) | ✅ Keep |
| Popular | ⚠️ View count only, no decay | ❌ Replace with "Trending" |
| Favorites | ❌ Not available | ✅ Add |
| Trending | ❌ Not available | ✅ Add (time-decayed engagement) |

---

## Summary Table

| Area | Status | Key Finding |
|------|--------|------------|
| **A. i18n** | ⚠️ Partial | Only 77 dictionary terms; item titles in source language if not in dict |
| **B. Onboarding** | ⚠️ Partial | Welcome carousel exists; ToS blocking works; no profile nudge or guided tour |
| **C. Alignment** | ✅ Good | All action buttons properly aligned with flexbox |
| **D. Self-Reply** | ❌ Blocked | Frontend guard prevents self-reply; DB allows it; easy to enable |
| **E. Compose Button** | ❌ No Label | Icon-only pen button; no text or tooltip; confusing with tab bar post button |
| **F. Ranking** | ⚠️ Limited | "Popular" = view count only; no favorite sort; no time-decay; recommend "Trending" |

