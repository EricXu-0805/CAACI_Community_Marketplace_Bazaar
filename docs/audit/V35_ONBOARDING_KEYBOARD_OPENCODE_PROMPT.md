# Sprint: v3.5 onboarding keyboard occlusion · Audit-only

> OpenCode audit-only prompt. Authored by chat-Claude 2026-05-12 for post-wipe pre-beta polish run.
> Scope: **one markdown file**, no code, no commits to source. Deliverable is `docs/audit/V35_onboarding_keyboard_audit.md`.
> Precedent: `docs/audit/N7redux_D3_keyboard_dock_audit.md` (D3 keyboard dock, 2026-05-09 to 05-10) — audit-only first caught 7 cross-platform quirks before any code was written. Reuse that audit's structural rigor.

## 一、Context

Eric reported during 2026-05-12 post-wipe smoke test: on the post-signup onboarding flow, step 1 (nickname entry), tapping the nickname `<input>` raises the soft keyboard and the keyboard **partially covers the input field or the bottom CTA buttons**. Reported as launch-blocker-adjacent — not in v3.5 P0, but tracked separately.

This bug was **deliberately descoped** from the v3.5 launch-blocker bundle (PR #13, squash 2243751) to preserve audit-only discipline. Keyboard handling has burned this project before — the D3 plaza composer keyboard dock sprint needed a full audit pass to surface platform divergence quirks. The same discipline applies here.

This sprint is **audit-only**. The decision rule (`docs/memory/sprint_form_audit_only_vs_one_pass.md`) triggers because:
1. Cross-platform code paths diverge (H5 `visualViewport` API vs mp-weixin `uni.onKeyboardHeightChange` / `cursor-spacing` / `adjust-position`)
2. Quirky platform API: iOS Safari historical behavior on `position: fixed`, mp-weixin Skyline quirks
3. Prior precedent (D3 keyboard dock) was audit-only first → caught quirks → cheap fix

**Wrong fix chosen here without audit risks introducing layout bugs on the other platform** (e.g. a blanket `cursor-spacing="100"` set in template would behave differently on H5 vs mp-weixin and could push the input above the viewport entirely on some devices).

## 二、Required reading before starting

Read these in order. Do NOT begin the audit until each reference still matches the codebase; note any drift in your handoff.

1. `docs/memory/backlog_onboarding_keyboard_occlusion.md` — backlog item with bug symptom, code area, prior reasoning. **Note**: this memory states the root-cause family is "`position: fixed` `.bottom` interacting with soft keyboard rise". **This was a hypothesis written before file inspection; the current `.bottom` in `app/src/pages/onboarding/index.vue:237` is `display: flex; gap: 10px; padding-top: 16px;` — i.e. a flex child of `.page`, NOT `position: fixed`.** Your audit must re-derive the root-cause family from scratch, not anchor to the memory's guess.
2. `docs/audit/N7redux_D3_keyboard_dock_audit.md` — D3 keyboard dock audit; reuse §-section structure (Current behavior baseline, Position/z-index map, Keyboard-up actual behavior, root-cause table, fix candidates table) where applicable
3. `docs/memory/sprint_form_audit_only_vs_one_pass.md` — decision rule for audit-only vs one-pass; confirms this sprint is audit-only
4. `docs/memory/workflow_audit_first.md` — workflow norms; final report must include 5 sections (adapted below for audit-only — see §五)
5. `docs/memory/opencode_no_self_decided_history_rewrite.md` — if anything goes wrong, STOP and ask Eric; no amend / rebase / reset+recommit / force-push
6. `docs/memory/pre_push_three_green.md` — even though this is audit-only, run `vue-tsc --noEmit` at the end to confirm you didn't accidentally modify any `.vue` / `.ts` file; the build commands (`build:h5` / `build:mp-weixin`) are not required for audit-only

Then read the source files:
- `app/src/pages/onboarding/index.vue` — the bug surface (entire file, ~253 lines)
- `app/src/pages/login/index.vue` — sibling auth surface; check whether it has its own keyboard handling for the email/code input (if so, that's a reference pattern)
- `app/src/pages/plaza/index.vue` — composer fullpage textarea has `:adjust-position="true"` (around line 328 per D3 audit); reference for how mp-weixin keyboard props are used elsewhere in repo
- `app/src/composables/` — list the directory; check if there is any `useKeyboard.ts` / keyboard composable (the D3 sprint discussed building one — verify whether it actually shipped or was descoped)
- `app/App.vue` — confirm safe-area / status-bar tokens (`--status-bar-height`, `env(safe-area-inset-*)`) are defined; the page uses them in `.page` padding

## 三、Branch + workflow + red lines

- **Branch**: `audit/v35-onboarding-keyboard` from `main` (single-purpose branch for cleanliness even though only 1 md is added)
- **Commits**: 1 commit only — `docs(audit): v3.5 onboarding keyboard occlusion audit`
- **No code changes.** Only the new `docs/audit/V35_onboarding_keyboard_audit.md` is added. If you find yourself wanting to edit a `.vue` / `.ts` / `.scss` file mid-audit, **STOP** — note the desired change in §§5 fix candidates of the audit instead. The fix is a separate sprint.
- **Do NOT push. Do NOT open PR. Do NOT merge.** Eric pushes manually (proxy via Zach or Kenny-JT per `docs/memory/zach_git_proxy.md`).
- **Do NOT amend / rebase / force-push / reset+recommit.** If the commit message has a typo, leave it; Eric squashes on merge per `docs/memory/pr_merge_squash_policy.md`.
- npm install (if needed): `--legacy-peer-deps` (project convention) — but you should not need npm for audit-only
- Multi-line commit message: use `git commit -F <tempfile>`, NOT `-m` (Windows cmd.exe drops body on multi-line `-m` per `docs/memory/windows_cmd_multiline_commit_gotcha.md`)

## 四、Audit md required structure

Write `docs/audit/V35_onboarding_keyboard_audit.md` with the following sections. Each section must cite file:line evidence — no claim without a code reference. Where you cannot verify on real devices, mark the claim **(reasoned, not real-device verified)** explicitly.

### Front matter

```
# v3.5 — Onboarding step 1 keyboard occlusion · Audit

> Audit-only sprint. **No code changes** — only this markdown.
> HEAD: <commit sha + subject>
> Audited: 2026-05-12
> Scope: `app/src/pages/onboarding/index.vue` step 1 nickname input + `.bottom` CTA + keyboard interaction across H5 / mp-weixin
> Out of scope: actual fix code (next sprint), step 2 (chips, no input), step 3 (avatar picker, no input), other pages, schema
```

### §1 Current layout baseline

Describe the `.page` → step block → `.bottom` flow as it actually is in the file today. Do NOT carry over the memory's "position: fixed" assumption. Cover:

- DOM tree of `.page` with all 3 steps + `.bottom` (ASCII tree like D3 audit §1)
- Position / z-index map table for every block:
  - `.page` — what's its position / overflow / min-height / padding-bottom / safe-area handling? Cite lines.
  - `.step` (each of v-if step===1,2,3) — what's the flex behavior, padding? Cite lines.
  - `.field` (the wrapper around the `<input>`) — position, gap? Cite lines.
  - `.input` — width, padding, border, font-size? Cite lines.
  - `.bottom` — IS IT `position: fixed`? Read line 237 and report verbatim. If not fixed, where does it sit in the flex column?
- What `padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px))` on `.page` actually solves (home-bar overlap, closed-keyboard state) vs doesn't (keyboard up)

### §2 Input element attributes audit

Enumerate every attribute on the `<input>` at line 16-22 verbatim. Specifically check for:

| Attribute | Present? | Value | Platform that honors it |
|---|---|---|---|
| `v-model` | ? | ? | both |
| `placeholder` | ? | ? | both |
| `class` | ? | ? | both |
| `maxlength` | ? | ? | both |
| `autocomplete` | ? | ? | H5 only (mp ignores) |
| `adjust-position` | ? | ? | **mp-weixin only**; default `true` if absent |
| `cursor-spacing` | ? | ? | **mp-weixin only**; px gap above keyboard |
| `confirm-type` | ? | ? | **mp-weixin only**; affects "done" button on keyboard |
| `hold-keyboard` | ? | ? | mp-weixin |
| `auto-focus` / `focus` | ? | ? | both, differently |
| `@focus` / `@blur` / `@input` | ? | ? | both |

Note: the table tells you both what IS set and what is silently using platform defaults. uni-app's `<input>` defaults to `adjust-position="true"` on mp-weixin, which means the system tries to scroll the focused input into view above the keyboard — but this can interact unpredictably with the flex column scroll context of `.page`.

### §3 Cross-platform keyboard-up behavior (reasoned)

For each platform, walk through what happens when user taps the nickname input. Mark each claim as **(verified by spec)** or **(reasoned, not real-device verified)**.

#### §3.1 H5 (browser, mobile Safari + Chrome)

- Does the browser auto-resize the viewport when keyboard rises? (Hint: no — that's why `visualViewport` API exists)
- The `.page` has `min-height: 100vh` — what's `100vh` after keyboard rises on iOS Safari? (Historical: stays at full screen viewport; on Chrome Android: may shrink — verify against current behavior assumptions)
- The `<input>` has no `adjust-position` (H5 ignores anyway). Does the browser scroll the focused input into view? (Usually yes, but only the input element itself — not the `.bottom` CTAs sitting below)
- Result: which element gets occluded? Predict for both step==1 (input only, `.bottom` separately) and the case where user has scrolled before tapping

#### §3.2 mp-weixin

- `adjust-position` default behavior (true if absent) — what does it do? Scrolls the focused input above the keyboard, by `cursor-spacing` px (default 0 if not set)
- Does `adjust-position` move `.bottom` (a SIBLING of `.field` in `.step` block) or only the `<input>` itself?
- What is the actual viewport in mp-weixin when keyboard is up? (`uni.onKeyboardHeightChange` available; `wx.getSystemInfoSync().windowHeight` reflects post-keyboard height on some versions)
- Skyline vs WebView rendering — does this page run Skyline? (Check `app/src/pages.json` for `renderer: "skyline"` on `pages/onboarding/index`)
- Result: which element gets occluded?

#### §3.3 Cross-platform divergence summary

Table: For each potentially occluded element (`.input`, `.bottom`, `.step` sub-content), mark H5 vs mp-weixin behavior. This is what makes the bug audit-worthy — same template renders differently.

### §4 Root-cause hypotheses (ranked)

Rank 3-4 hypotheses for the bug's root cause. For each:

- **Mechanism** (one sentence: how the broken behavior arises from the current code)
- **Evidence** (file:line citations from §1-3)
- **Confidence** (high / medium / low + why)

Anchors to consider (do NOT default to the memory's `position: fixed` hypothesis since that's already disproven):
- H1: `.page`'s `min-height: 100vh` + flex column means `.bottom` sits at the natural bottom of the viewport; when keyboard rises, `.bottom` doesn't move because nothing is listening to keyboard height
- H2: `<input>` lacks `adjust-position` / `cursor-spacing` explicit values → mp-weixin default behavior may scroll input but not the sibling `.bottom`; on H5 there is no equivalent and input scroll-into-view is browser-dependent
- H3: `.page` has `max-width: 480px; margin: 0 auto;` — on landscape or wide screen could change layout assumptions
- H4: <your own additional hypothesis if evidence supports>

### §5 Fix candidates (ranked)

Propose 3-5 distinct fix paths. For each:

| # | One-line description | Files touched | Platform compat | Risk | Commit size estimate |
|---|---|---|---|---|---|
| F1 | <e.g. add `cursor-spacing="20"` and `:adjust-position="true"` to `<input>`> | 1 | mp-weixin only (H5 ignores) | low | 1 line |
| F2 | <e.g. listen to `uni.onKeyboardHeightChange` + apply `padding-bottom: <kbHeight>px` to `.page`> | 1 file + maybe a new composable | both | medium (composable scope) | 30-50 lines |
| F3 | <e.g. swap `<input>` for `<textarea :adjust-position auto-height :show-confirm-bar>`> | 1 | mp-weixin behavior different, H5 looks different | medium-high | 10-20 lines + visual review |
| F4 | <e.g. wrap step body in `scroll-view :scroll-into-view`> | 1 | both, but mp behavior nuanced | medium | 20-30 lines |
| F5 | <reuse / extract `useKeyboard` composable from D3 if it exists> | check D3 status first | both | low IF composable exists, medium if must build | depends |

For each fix, note:
- What happens to the OTHER platform (H5 fix that breaks mp, or vice versa, is **not acceptable**)
- Whether step 2 (campus chips) or step 3 (avatar) are affected
- Whether i18n / dark-mode tokens / accessibility are touched

### §6 Recommended fix path

Pick ONE fix from §5. Justify in 4-8 sentences:
- Why this is the smallest atomic fix that solves the H1/H2/etc. hypothesis at the top of §4
- Why it's safe for the OTHER platform
- Whether it can be implemented as a 1-commit fix-only sprint or needs to be split (e.g. composable extraction + apply)
- What the post-fix verification checklist should be (smoke test steps on H5 + mp-weixin)

### §7 Open questions / unknowns

List anything you couldn't determine without real-device testing. Examples:
- "Does Skyline renderer change `adjust-position` behavior on this page?" — needs `pages.json` check + real device
- "Does `visualViewport` fire on iOS Safari 15+ with `<input>`?" — needs real device
- "Does keyboard auto-dismiss on `.bottom` tap (next button)?" — needs real device

Eric / chat-Claude will resolve these in the fix-sprint scoping conversation.

## 五、Final handoff format

At the end of your run, output a handoff message in chat (paste to Eric). Adapted 5-section format from `docs/memory/workflow_audit_first.md` for audit-only sprints:

1. **Files read** — list every file you opened (paths only, no contents); note any drift from prompt-cited line numbers
2. **Files written** — should be exactly one: `docs/audit/V35_onboarding_keyboard_audit.md` (plus the commit). If anything else changed, STOP and report — that's a transgression
3. **Static reasoning summary** — 5-8 bullets summarizing §4 hypotheses + §6 recommendation (don't restate the whole audit, just the punchline)
4. **Git state** — `git status` (should be clean post-commit), `git log --oneline -3` (HEAD should be your new audit commit on `audit/v35-onboarding-keyboard`), `git branch --show-current`, AND result of `vue-tsc --noEmit` (should be clean — no `.vue`/`.ts` file modified, so no type errors introduced)
5. **Anomalies** — anything surprising:
   - Did the memory's `position: fixed` guess turn out to match or diverge from reality? (chat-Claude already noted the divergence, but confirm)
   - Did you discover a hypothesis that wasn't in the prompt's anchor list?
   - Any file from "Required reading" missing or relocated?
   - Did `useKeyboard.ts` (or similar) from D3 sprint actually ship, or is the file absent?

## 六、Hard-stops (verbatim from `docs/memory/opencode_no_self_decided_history_rewrite.md`)

- **No code changes outside the new audit md.** If a `.vue` / `.ts` / `.scss` file shows as modified in `git status`, STOP and report. You are not authorized to edit source for this sprint.
- **Any one red (vue-tsc fails despite no source change) → STOP and ask Eric.** No self-decided in-place fix. No `git reset` / `git commit --amend` / `git rebase`. If a fix is needed, forward-add a new commit.
- **No push, no PR, no merge.** Eric handles those manually.
- **Do not invent a fix while writing the audit.** If §5 / §6 require implementation detail you don't know, mark the fix candidate with "(needs spec)" and move on. The fix sprint will spec it.

---

**Acknowledge this prompt before starting** by replying with:
1. The decision-rule classification ("audit-only because cross-platform AND quirky API AND prior precedent")
2. The branch name + commit message + deliverable path you'll produce
3. Confirmation that you will not modify any source file
4. The 5 hard-stop rules paraphrased

Only after that ack, begin reading the Required reading list.
