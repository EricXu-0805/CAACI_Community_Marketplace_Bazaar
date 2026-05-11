# OpenCode prompt — V3 P1 follow-up: i18n missing keys + messages dark/swipe fixes

**Paste this entire document into your OpenCode session as the kickoff message. This is a follow-up to the original V3 P1 sprint — same branch (`feat/v3-p1-dark-mode-fixes`), 2 additional atomic commits.**

---

## Context

You're continuing work on the v3 P1 dark-mode-fixes branch. The original P1 build (commits `cca517d → 94dbf31` plus a `8f33bd6` docs commit) is **on the branch but NOT yet pushed or merged** — Eric's local visual smoke surfaced 2 follow-up issues that should land on the same branch as additional commits before he pushes the PR:

1. **i18n missing keys** — chat-Claude audited 7 missing i18n keys after Eric saw `plaza.tapToExpand` rendering as raw key in the UI. All 7 are `t('xxx.yyy')` references with no matching definition in `app/src/composables/i18n/messages/zh.ts` or `en.ts`. 6 of them have a dead `|| 'fallback'` pattern in the call site that doesn't actually fire (because `t()` returns the truthy raw key string, not falsy).

2. **Messages page dark adaptation + swipe-action leak bug** — Eric's screenshot shows colored thin lines bleeding from beneath conversation rows in dark mode. Root cause: `.conv-row { overflow: hidden }` + `.conv-item { transform: translateX(0) }` creates sub-pixel rendering gaps where the underlying `.swipe-actions` (orange/amber/red bg) leak through. Plus the row chrome is generally underadapted for dark.

These are bundled into the same P1 PR because they were discovered during P1 visual smoke, are small in scope, and fixing them on a separate branch would delay the same dark-mode user benefit. Two atomic commits on the existing branch.

---

## Branch state

```bash
git checkout feat/v3-p1-dark-mode-fixes
git log --oneline -10  # should show 7 commits ending at 8f33bd6 (docs commit)
```

If the branch isn't checked out or HEAD has drifted, STOP and ask Eric.

---

## Commit 8 · i18n missing keys (6 new + 7 dead-fallback removals)

### Add to `app/src/composables/i18n/messages/zh.ts`

Find the existing key groups and insert these into the matching section (alphabetical/grouped by prefix). Suggested insertion points based on chat-Claude's grep:

```ts
// Insert in plaza.* group (around line 425, near 'plaza.collapseComments'):
'plaza.tapToExpand': '点击展开',
'plaza.collapse': '收起',
'plaza.uploadFailed': '图片上传失败 — 请重试',

// Insert in login.* group (around line 90):
'login.resetFailTitle': '无法发送重置邮件',

// Insert in resetPw.* group (find by grep):
'resetPw.notRecovery': '请从重置邮件中的链接打开此页',

// Insert in chat.* group (find by grep):
'chat.imageUploadFailed': '图片上传失败 — 请重试',
```

### Add to `app/src/composables/i18n/messages/en.ts` (mirror at same line numbers)

```ts
'plaza.tapToExpand': 'Tap to expand',
'plaza.collapse': 'Collapse',
'plaza.uploadFailed': 'Image upload failed — please retry',
'login.resetFailTitle': "Couldn't send reset email",
'resetPw.notRecovery': 'Open this page from the password-reset email link',
'chat.imageUploadFailed': 'Image upload failed — please retry',
```

(EN strings should match the existing `|| 'fallback'` text in the call sites — chat-Claude's grep showed those English strings are reasonable; use them verbatim.)

### Remove dead `|| 'fallback'` patterns (7 sites)

Now that the keys exist, the dead fallback strings are noise. Remove them:

| File | Line | Current | Change to |
|---|---|---|---|
| `pages/plaza/index.vue` | 65 | `{{ t('plaza.tapToExpand') \|\| 'tap to expand' }}` | `{{ t('plaza.tapToExpand') }}` |
| `pages/plaza/index.vue` | 90 | `:aria-label="t('plaza.collapse') \|\| 'Collapse'"` | `:aria-label="t('plaza.collapse')"` |
| `pages/plaza/index.vue` | 770 | `throw new Error(t('plaza.uploadFailed') \|\| 'Image upload failed — please retry')` | `throw new Error(t('plaza.uploadFailed'))` |
| `pages/reset-password/index.vue` | 351 | `title: t('resetPw.notRecovery') \|\| 'Open this page from the password-reset email link',` | `title: t('resetPw.notRecovery'),` |
| `pages/login/index.vue` | 195 | `title: t('login.resetFailTitle') \|\| 'Could not send reset email',` | `title: t('login.resetFailTitle'),` |
| `pages/settings/index.vue` | 207 | `title: t('login.resetFailTitle') \|\| 'Could not send reset email',` | `title: t('login.resetFailTitle'),` |
| `pages/chat/index.vue` | 690 | `const fallback = t('chat.imageUploadFailed') \|\| 'Image upload failed — please retry'` | `const fallback = t('chat.imageUploadFailed')` |

(Read each file to confirm the exact current line — the patterns above are paraphrased from grep, not verbatim. Match the actual indentation and surrounding code.)

### Verify

- `npm run type-check` clean
- `npm run build:h5` clean
- Manually verify in template: `t('plaza.tapToExpand')` should now render as `点击展开` (zh) or `Tap to expand` (en)

### Commit message

```
fix(i18n): add 6 missing keys + remove dead || 'fallback' patterns

Surfaced during v3 P1 visual smoke when plaza.tapToExpand rendered as
raw key in UI. The dead fallback pattern doesn't fire because t() returns
the truthy raw key string, not falsy.

- plaza.tapToExpand, plaza.collapse, plaza.uploadFailed
- login.resetFailTitle (used in login + settings)
- resetPw.notRecovery
- chat.imageUploadFailed
- 7 call sites cleaned of dead || 'fallback' suffixes
```

---

## Commit 9 · Messages page dark adaptation + swipe-action leak fix

### File: `app/src/pages/messages/index.vue`

Read the existing `.conv-row`, `.conv-item`, `.swipe-actions`, `.swipe-act` rules around lines 365-475.

**Change 1 — fix the swipe-action color leak** (the visible bug Eric saw):

The current `.conv-row { overflow: hidden }` + transformed `.conv-item` allows sub-pixel gaps to expose the absolutely-positioned `.swipe-actions` underneath (which have brand-orange / amber / red backgrounds). Fix by giving `.conv-row` an explicit background that matches `.conv-item` background — any pixel gap is then filled with the matching color rather than the swipe-action colors.

```scss
.conv-row {
  position: relative;
  overflow: hidden;
  border-bottom: 0.5px solid var(--line-hair);
  background: var(--bg-elev-1);  /* NEW: closes sub-pixel gaps to swipe-actions */
}
```

**Change 2 — make divider visible in dark** (P0 of dark adaptation):

`--line-hair` in dark is `rgba(240,232,214,0.06)` — basically invisible. Switch to `--border` which in dark is `rgba(240,232,214,0.10)` — still subtle but visible.

```scss
.conv-row {
  /* ... */
  border-bottom: 0.5px solid var(--border);  /* CHANGED from --line-hair */
}
```

**Change 3 — swipe-actions stacking robustness**:

Make sure swipe-actions are explicitly behind everything, not just lower z-index. Add an explicit `z-index: 0` and ensure `.conv-item` z-index of 2 stays:

```scss
.swipe-actions {
  position: absolute; top: 0; bottom: 0;
  display: flex;
  z-index: 0;  /* CHANGED from 1, explicitly behind .conv-row bg */
}
```

(The `.conv-item { z-index: 2 }` stays as-is — it sits on top of conv-row's new bg, which sits on top of swipe-actions.)

**Change 4 — avatar circle background in dark**:

Current `.conv-avatar { background: var(--bg-subtle) }` — in dark `--bg-subtle` after P1 is `#36322B` (good), but the avatar circle currently has no border. Add a hairline so even with no fallback image loaded, the circle reads as a defined element:

```scss
.conv-avatar {
  width: 48px; height: 48px;
  border-radius: 50%;
  background: var(--bg-subtle);
  flex-shrink: 0;
  border: 0.5px solid var(--border);  /* NEW: defines circle in both themes */
}
```

### Verify

- `npm run type-check` clean
- `npm run build:h5` clean
- Visual check: with Eric's local `.env`, run `npm run dev:h5`, navigate to `/pages/messages/index`, switch to dark mode (DevTools Rendering → Emulate prefers-color-scheme = dark), verify:
  - No colored line bleeding from below any conv-row
  - Divider between rows visible (subtle but present)
  - Avatar circles have a defined edge

### Commit message

```
fix(messages): close swipe-action color leak + improve dark divider

Surfaced during v3 P1 visual smoke. The .conv-row overflow:hidden +
.conv-item transform combo allowed sub-pixel gaps where the absolutely-
positioned .swipe-actions backgrounds (brand orange, amber, danger red)
leaked through the conv-item bg edges in dark mode.

- conv-row gets explicit bg-elev-1 background to fill any gap
- divider switched from --line-hair (~invisible in dark) to --border
- swipe-actions z-index made explicit (0) for stacking clarity
- conv-avatar gets hairline border so empty fallback reads as defined
```

---

## Workflow guardrails

- **Same branch:** `feat/v3-p1-dark-mode-fixes` — do NOT create a new branch
- **2 atomic commits**, in this order: i18n first, messages second (independent enough to be separate)
- **Do NOT push** — Eric pushes
- **Do NOT rewrite history** per memory `opencode_no_self_decided_history_rewrite` — no amend, no rebase, no reset
- **Red lines unchanged** from original P1 prompt (no migrations, no Auth, no logo, no light-mode tokens)
- **mp-weixin compat NOT required** per spec §CC-1 (deferred to v3.5) — but this commit's changes are pure CSS + i18n strings + JS object literal additions, all mp-compatible by nature

---

## Failure-mode protocol

If `vue-tsc` or `build:h5` reds after either commit:
1. Read the error
2. If trivial (typo, missing comma, wrong path), fix forward in a new commit
3. If non-trivial or unexpected, STOP and surface to Eric — do not invent a fix

If you discover the i18n message file structure differs from chat-Claude's grep (e.g. nested objects instead of flat keys), STOP and surface — the insertion strategy assumed flat `'group.key': 'value',` records.

If you discover that some of the listed dead-fallback removal sites have additional logic chained (e.g. `t('xxx') || someOtherCall()`), do NOT remove the `||` blindly — surface the surprise.

---

## Hand-off

When done, output to chat:
- 2 commit SHAs
- Files touched
- Build status (vue-tsc + build:h5)
- Confirmation that branch is at `feat/v3-p1-dark-mode-fixes` with clean working tree
- Updated diff stats vs main (should be ~+30 lines on top of the 7 existing commits)
- Recommend: Eric re-runs visual smoke for messages page in dark to confirm bug fix

---

## Quick-reference

- Repo: `C:\Users\kenny\source\repos\CAACI_Community_Marketplace_Bazaar`
- Working dir: `app/`
- Package manager: `npm` (not pnpm — uses `--legacy-peer-deps`)
- Build: `npm run type-check` + `npm run build:h5`
- Branch: `feat/v3-p1-dark-mode-fixes` (already exists, 7 commits)
- Windows cmd.exe: per memory `windows_cmd_multiline_commit_gotcha`, use `git commit -F filepath` for multi-line bodies, or multiple `-m` flags

Good luck. Stop at "branch ready, working tree clean."
