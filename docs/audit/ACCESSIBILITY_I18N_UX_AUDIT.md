# CAACI Community Marketplace Bazaar - Accessibility, i18n & UX Audit Report

## Executive Summary
Comprehensive audit of uni-app Vue 3 bilingual (EN/CN) marketplace app. Found **30+ critical and high-priority issues** across i18n coverage, accessibility, and UX consistency. The app has good i18n infrastructure but several hardcoded strings, missing alt attributes on images, low contrast text, and inconsistent error handling.

---

## PRIORITY FIXES (Top 30)

### 1. **CRITICAL: Hardcoded English Error Message in App.vue**
- **File:** `/app/src/App.vue:36`
- **Issue:** `'No network connection'` is hardcoded English, not translated
- **Impact:** Chinese users see English error message; breaks i18n consistency
- **Fix:** Add to useI18n.ts: `'error.noNetwork': 'No network connection'` (EN) / `'error.noNetwork': '无网络连接'` (ZH), then use `t('error.noNetwork')`
- **Severity:** CRITICAL

### 2. **CRITICAL: Missing alt Attributes on All Images**
- **Files:** 24 `<image>` tags across pages (detail, profile, chat, messages, etc.)
- **Examples:** 
  - `/app/src/pages/detail/index.vue:7` - product images
  - `/app/src/pages/profile/index.vue:21` - user avatars
  - `/app/src/pages/chat/index.vue:83` - message images
- **Impact:** Screen reader users cannot identify images; fails WCAG 2.1 Level A
- **Fix:** Add `alt` attribute to all `<image>` tags:
  ```vue
  <image :src="item.images[0]" alt="Product image: {{ item.title }}" />
  <image :src="user.avatar_url" alt="User avatar: {{ user.nickname }}" />
  ```
- **Severity:** CRITICAL

### 3. **HIGH: Hardcoded Error Messages in Composables**
- **Files:** 
  - `/app/src/composables/usePlaza.ts` - `'Failed to load plaza'`
  - `/app/src/composables/useMessages.ts` - `'Failed to load messages'`
  - `/app/src/composables/useFavorites.ts` - `'Failed, please try again'`
- **Impact:** Chinese users see English errors; inconsistent UX
- **Fix:** Add i18n keys for all error messages and use `t()` function
- **Severity:** HIGH

### 4. **HIGH: Login Form Missing Email Input Type**
- **File:** `/app/src/pages/login/index.vue:33`
- **Issue:** Email input uses `type="text"` instead of `type="email"`
- **Impact:** Mobile keyboards don't show @ symbol; poor UX; no email validation
- **Fix:** Change to `type="email"` for proper keyboard and validation
- **Severity:** HIGH

### 5. **HIGH: Password Input Missing Autocomplete Attribute**
- **File:** `/app/src/pages/login/index.vue:39`
- **Issue:** Password input missing `autocomplete="current-password"` (login) or `autocomplete="new-password"` (signup)
- **Impact:** Password managers can't autofill; poor UX
- **Fix:** Add `autocomplete` attribute based on mode
- **Severity:** HIGH

### 6. **HIGH: Low Contrast Text - Filter Labels**
- **File:** `/app/src/pages/index/index.vue` - `.fs-label { color: #999; }`
- **Issue:** #999 gray on white background fails WCAG AA contrast (4.5:1 required)
- **Impact:** Users with low vision cannot read filter labels
- **Fix:** Change to `color: #666` or darker (#555)
- **Severity:** HIGH

### 7. **HIGH: Low Contrast Text - Empty State Subtitle**
- **File:** `/app/src/pages/index/index.vue` - `.empty-sub { color: #999; }`
- **Issue:** Same contrast issue as above
- **Impact:** Empty state messages hard to read
- **Fix:** Change to `color: #666` or darker
- **Severity:** HIGH

### 8. **HIGH: Low Contrast Text - Dash in Price Filter**
- **File:** `/app/src/pages/index/index.vue` - `.fs-dash { color: #ccc; }`
- **Issue:** #ccc is extremely light gray, fails contrast
- **Impact:** Price range separator barely visible
- **Fix:** Change to `color: #999` or `#888`
- **Severity:** HIGH

### 9. **HIGH: Low Contrast Text - Form Helper Text**
- **File:** `/app/src/pages/index/index.vue` - `.fs-footer { color: #bbb; }`
- **Issue:** #bbb fails contrast requirements
- **Impact:** Helper text unreadable
- **Fix:** Change to `color: #666` or darker
- **Severity:** HIGH

### 10. **HIGH: Low Contrast Text - Trust Labels**
- **File:** `/app/src/pages/seller/index.vue` - `.trust-label { color: #8e8e93; }`
- **Issue:** #8e8e93 (iOS gray) fails contrast on white
- **Impact:** Seller stats labels hard to read
- **Fix:** Change to `color: #666` or darker
- **Severity:** HIGH

### 11. **MEDIUM: Missing Form Labels for Accessibility**
- **Files:** Multiple pages (publish, profile/edit, etc.)
- **Issue:** Form inputs have visual labels but no `<label>` elements with `for` attributes
- **Examples:**
  - `/app/src/pages/publish/index.vue:37` - title input
  - `/app/src/pages/publish/index.vue:42` - description textarea
  - `/app/src/pages/login/index.vue:33` - email input
- **Impact:** Screen readers cannot associate labels with inputs
- **Fix:** Wrap inputs in `<label>` or add `aria-label` attributes
- **Severity:** MEDIUM

### 12. **MEDIUM: Clickable Non-Button Elements Missing Role**
- **Files:** Multiple pages
- **Examples:**
  - `/app/src/pages/index/index.vue:21` - clear search (×)
  - `/app/src/pages/index/index.vue:23` - filter button
  - `/app/src/pages/detail/index.vue:17` - back button
  - `/app/src/pages/login/index.vue:40` - password toggle
- **Impact:** Screen readers don't announce these as buttons; keyboard navigation broken
- **Fix:** Use `<button>` elements or add `role="button"` and `tabindex="0"`
- **Severity:** MEDIUM

### 13. **MEDIUM: Touch Target Size Too Small**
- **File:** `/app/src/pages/index/index.vue` - `.fs-close { width: 32px; height: 32px; }`
- **Issue:** 32px is below Apple HIG minimum of 44px
- **Impact:** Hard to tap on mobile; accessibility issue
- **Fix:** Increase to `min-width: 44px; min-height: 44px;`
- **Severity:** MEDIUM

### 14. **MEDIUM: Back Button Touch Target Too Small**
- **Files:** Multiple pages (seller, settings, messages, etc.)
- **Issue:** `.back-btn { width: 32px; height: 32px; }` - below 44px minimum
- **Impact:** Hard to tap; accessibility issue
- **Fix:** Increase to `min-width: 44px; min-height: 44px;`
- **Severity:** MEDIUM

### 15. **MEDIUM: Missing Character Counter Labels**
- **Files:** 
  - `/app/src/pages/publish/index.vue:38` - title counter
  - `/app/src/pages/publish/index.vue:43` - description counter
  - `/app/src/pages/profile/edit.vue` - bio counter
- **Issue:** Character counts shown but not labeled (e.g., "50/50 characters")
- **Impact:** Screen reader users don't know what the numbers mean
- **Fix:** Add `aria-label="Title: 50 of 50 characters"` to counter elements
- **Severity:** MEDIUM

### 16. **MEDIUM: Language Conditional Logic (Fragile Pattern)**
- **Files:**
  - `/app/src/pages/publish/index.vue:159` - `lang.value === 'zh' ? spot.zh : spot.en`
  - `/app/src/pages/detail/index.vue` - `quickTranslate(item.value.title, lang.value as 'en' | 'zh')`
  - `/app/src/pages/seller/index.vue` - `if (lang.value === 'zh')`
- **Issue:** Direct language checks instead of using i18n keys; fragile if adding 3rd language
- **Impact:** Hard to maintain; not scalable
- **Fix:** Move all strings to useI18n.ts and use `t()` function
- **Severity:** MEDIUM

### 17. **MEDIUM: Hardcoded Currency Symbol ($)**
- **Files:**
  - `/app/src/pages/index/index.vue:81` - `${{ filterPriceMin }}`
  - `/app/src/pages/index/index.vue:113` - `.fs-dollar { color: #999; }`
  - `/app/src/pages/publish/index.vue:49` - `<text class="currency">$</text>`
  - `/app/src/utils/index.ts:342` - `return '$' + ...`
- **Issue:** $ hardcoded; Chinese users should see ¥ or USD label
- **Impact:** Confusing for international users
- **Fix:** Add i18n key `'currency.symbol': '$'` (EN) / `'currency.symbol': 'USD'` (ZH)
- **Severity:** MEDIUM

### 18. **MEDIUM: Date/Time Formatting Not Locale-Aware**
- **File:** `/app/src/utils/index.ts:1-13` - `formatTime()` function
- **Issue:** Returns English strings like "5m ago", "2h ago", "3d ago" - not translated
- **Impact:** Chinese users see English time labels
- **Fix:** Use i18n keys for time units:
  ```ts
  export function formatTime(dateStr: string, t: (key: string) => string): string {
    // ... return t('time.minutesAgo', { n: minutes }) etc.
  }
  ```
- **Severity:** MEDIUM

### 19. **MEDIUM: Missing Toast Duration Consistency**
- **Files:** Multiple pages
- **Issue:** Toast durations vary: some 2000ms, some 3000ms, some default
- **Impact:** Inconsistent UX; users can't predict toast visibility
- **Fix:** Define constant `const TOAST_DURATION = 2500` and use consistently
- **Severity:** MEDIUM

### 20. **MEDIUM: Missing Loading States on Some Pages**
- **Files:**
  - `/app/src/pages/index/index.vue` - has loading state ✓
  - `/app/src/pages/detail/index.vue` - NO loading state while fetching item
  - `/app/src/pages/seller/index.vue` - has loading state ✓
  - `/app/src/pages/profile/index.vue` - has loading state ✓
- **Issue:** Detail page doesn't show loading spinner while fetching item data
- **Impact:** User doesn't know if page is loading or broken
- **Fix:** Add `v-if="loading"` with spinner before showing item content
- **Severity:** MEDIUM

### 21. **MEDIUM: Missing Error States on Some Pages**
- **Files:**
  - `/app/src/pages/detail/index.vue` - NO error state if item fetch fails
  - `/app/src/pages/seller/index.vue` - NO error state if seller fetch fails
- **Issue:** If API fails, page shows nothing; user doesn't know what happened
- **Impact:** Poor UX; user thinks app is broken
- **Fix:** Add error state with retry button
- **Severity:** MEDIUM

### 22. **MEDIUM: Inconsistent Empty State Icons**
- **Files:** Multiple pages
- **Issue:** Some pages have SVG icons, some have CSS-drawn icons, some have none
- **Impact:** Inconsistent visual design
- **Fix:** Create consistent empty state component with icon, title, subtitle
- **Severity:** MEDIUM

### 23. **MEDIUM: Modal Confirm Dialogs Not Translated**
- **Files:** Multiple pages
- **Issue:** `uni.showModal()` calls use translated titles but some have hardcoded content
- **Examples:**
  - `/app/src/pages/settings/index.vue` - some modals missing i18n
  - `/app/src/pages/messages/index.vue` - delete confirmation
- **Impact:** Some confirmation dialogs show English to Chinese users
- **Fix:** Ensure all modal content uses `t()` function
- **Severity:** MEDIUM

### 24. **MEDIUM: Missing Keyboard Navigation**
- **Files:** Multiple pages with custom buttons
- **Issue:** Custom clickable elements don't respond to keyboard (Enter/Space)
- **Examples:**
  - `/app/src/pages/index/index.vue:23` - filter button
  - `/app/src/pages/detail/index.vue:135` - favorite button
- **Impact:** Keyboard-only users cannot interact
- **Fix:** Add `@keydown.enter` and `@keydown.space` handlers to custom buttons
- **Severity:** MEDIUM

### 25. **MEDIUM: Missing Focus Indicators**
- **Files:** All pages
- **Issue:** No visible focus styles on interactive elements
- **Impact:** Keyboard users can't see which element is focused
- **Fix:** Add global focus styles:
  ```css
  button:focus, [role="button"]:focus {
    outline: 2px solid #007AFF;
    outline-offset: 2px;
  }
  ```
- **Severity:** MEDIUM

### 26. **LOW: Missing Autocomplete on Signup Form**
- **File:** `/app/src/pages/login/index.vue:28`
- **Issue:** Nickname input missing `autocomplete="username"` or `autocomplete="off"`
- **Impact:** Password managers may try to autofill
- **Fix:** Add `autocomplete="username"` for signup mode
- **Severity:** LOW

### 27. **LOW: No Dark Mode Support**
- **Files:** All pages
- **Issue:** App has no dark mode; no `prefers-color-scheme` media query
- **Impact:** Users with dark mode preference see bright white UI
- **Fix:** Add CSS variables and `@media (prefers-color-scheme: dark)` support
- **Severity:** LOW

### 28. **LOW: Missing Aria-Live for Toast Notifications**
- **Files:** Multiple pages
- **Issue:** Toast notifications don't have `aria-live="polite"` or `aria-live="assertive"`
- **Impact:** Screen reader users may not hear toast messages
- **Fix:** Add `aria-live="polite"` to toast container
- **Severity:** LOW

### 29. **LOW: Missing Aria-Label on Icon-Only Buttons**
- **Files:** Multiple pages
- **Issue:** Icon-only buttons (heart, share, etc.) missing `aria-label`
- **Examples:**
  - `/app/src/pages/detail/index.vue:136` - favorite button
  - `/app/src/pages/detail/index.vue:20` - share button
- **Impact:** Screen reader users don't know button purpose
- **Fix:** Add `aria-label="Save item"` to icon buttons
- **Severity:** LOW

### 30. **LOW: Missing Aria-Label on Decorative Icons**
- **Files:** Multiple pages
- **Issue:** Decorative icons (location dot, etc.) should have `aria-hidden="true"`
- **Examples:**
  - `/app/src/pages/detail/index.vue:50` - location dot
  - `/app/src/pages/messages/index.vue:47` - pin badge
- **Impact:** Screen readers announce decorative elements
- **Fix:** Add `aria-hidden="true"` to decorative elements
- **Severity:** LOW

---

## DETAILED FINDINGS BY CATEGORY

### I18N Coverage Gaps

#### Missing Translations
1. **Network Error** - `'No network connection'` in App.vue:36
2. **Composable Errors** - Multiple "Failed to..." messages in composables
3. **Time Ago Strings** - formatTime() returns English: "5m ago", "2h ago", etc.
4. **Currency Symbol** - Hardcoded $ in multiple places

#### Language Conditionals (Fragile Pattern)
- `lang.value === 'zh'` checks in 5+ files instead of using i18n keys
- Should use i18n for all user-facing strings

#### Date/Number Formatting
- `formatTime()` doesn't use locale
- `formatPrice()` hardcodes $ symbol
- No `toLocaleString()` usage for numbers

### Accessibility Gaps

#### Images Without Alt Text
- 24 `<image>` tags missing `alt` attributes
- Affects: product images, avatars, message images, item thumbnails

#### Form Issues
- Email input uses `type="text"` instead of `type="email"`
- Password inputs missing `autocomplete` attributes
- No `<label>` elements associated with inputs
- Missing `aria-label` on character counters

#### Contrast Issues
- #999 gray text on white (fails WCAG AA)
- #ccc dash separator (extremely low contrast)
- #bbb helper text (fails contrast)
- #8e8e93 labels (fails contrast)

#### Touch Targets
- Back buttons: 32px (should be 44px minimum)
- Close buttons: 32px (should be 44px minimum)
- Filter buttons: 32px (should be 44px minimum)

#### Keyboard Navigation
- Custom buttons don't respond to Enter/Space
- No focus indicators visible
- No keyboard trap prevention

#### Screen Reader Support
- No `aria-live` on toasts
- No `aria-label` on icon buttons
- No `aria-hidden` on decorative elements
- No `role="button"` on clickable divs

### UX Consistency Gaps

#### Loading States
- Inconsistent across pages
- Detail page missing loading state
- Some pages show spinner, some show nothing

#### Error States
- Detail page has no error state
- Seller page has no error state
- Inconsistent error messages

#### Empty States
- Inconsistent icons (some SVG, some CSS, some none)
- No unified empty state component

#### Toast Notifications
- Duration varies: 2000ms, 2500ms, 3000ms
- No consistent styling

#### Confirm Dialogs
- Some use i18n, some hardcoded
- Inconsistent button order

#### Back Button Behavior
- Consistent across pages ✓

#### Pull-to-Refresh
- Only on messages and profile pages
- Not on home, plaza, or other list pages

### Form & Input Issues

#### Required Field Indicators
- No visual indicator for required fields
- No `required` attribute on inputs

#### Validation
- Inline validation missing on most forms
- Submit-time validation only

#### Character Counters
- Present but not labeled for screen readers
- No aria-label

#### Autocomplete
- Email input missing `type="email"`
- Password inputs missing `autocomplete` attributes
- Signup nickname missing `autocomplete="username"`

#### Keyboard Hints
- Some inputs have `confirm-type="send"` ✓
- Some inputs have `confirm-type="search"` ✓
- Missing `inputmode` attributes for better mobile keyboards

### Mobile H5 Specifics

#### Safe Area Insets
- ✓ Properly implemented with `env(safe-area-inset-*)`
- Used in: CustomTabBar, all pages

#### Pull-to-Refresh
- Only on 2 pages (messages, profile)
- Should be on more list pages

#### Double-Tap-to-Zoom
- Not explicitly prevented
- May cause issues on interactive elements

#### 300ms Tap Delay
- Not addressed (uni-app handles this)

#### iOS Momentum Scrolling
- Not explicitly enabled
- Should add `-webkit-overflow-scrolling: touch`

#### Android Back Button
- Not explicitly handled
- Should implement back button handler

### Dark Mode

#### Current Status
- ❌ No dark mode support
- ❌ No `prefers-color-scheme` media query
- ❌ No CSS variables for theming

#### Recommendation
- Add CSS variables for colors
- Implement `@media (prefers-color-scheme: dark)` support
- Test with system dark mode

---

## RECOMMENDATIONS

### Immediate Actions (This Sprint)
1. Add alt attributes to all images
2. Fix email input type and password autocomplete
3. Fix contrast issues (#999, #ccc, #bbb, #8e8e93)
4. Add i18n key for network error
5. Increase touch target sizes to 44px minimum

### Short Term (Next Sprint)
1. Translate all error messages in composables
2. Add loading/error states to detail and seller pages
3. Add keyboard navigation to custom buttons
4. Add focus indicators
5. Add aria-labels to icon buttons

### Medium Term (2-3 Sprints)
1. Refactor time formatting to use i18n
2. Create consistent empty state component
3. Implement dark mode support
4. Add aria-live to toasts
5. Standardize toast durations

### Long Term (Ongoing)
1. Add form labels and aria-labels
2. Implement comprehensive keyboard navigation
3. Add screen reader testing to QA process
4. Add accessibility testing to CI/CD
5. Consider WCAG 2.1 AA certification

---

## TESTING CHECKLIST

- [ ] Screen reader testing (NVDA, JAWS, VoiceOver)
- [ ] Keyboard-only navigation
- [ ] Contrast checking (WebAIM, Axe DevTools)
- [ ] Touch target size verification
- [ ] Mobile keyboard testing (iOS, Android)
- [ ] Dark mode testing
- [ ] i18n testing (both EN and ZH)
- [ ] Error state testing
- [ ] Loading state testing
- [ ] Empty state testing

---

## TOOLS RECOMMENDED

- **Contrast:** WebAIM Contrast Checker, Axe DevTools
- **Accessibility:** Axe DevTools, WAVE, Lighthouse
- **i18n:** i18next, vue-i18n (consider migration)
- **Testing:** Cypress with accessibility plugins
- **Screen Readers:** NVDA (Windows), JAWS (Windows), VoiceOver (Mac/iOS)
