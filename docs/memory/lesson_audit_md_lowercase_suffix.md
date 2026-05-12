---
name: Lesson — `.gitignore *_AUDIT.md` pattern is mis-scoped; whitelist `docs/audit/` is the class fix (lowercase suffix alone does NOT save new files on Windows)
description: From 2026-05-12 V3.5 onboarding keyboard audit two-stage STOP. First STOP made chat-Claude wrongly endorse rename-to-lowercase (B); second STOP empirically disproved B via `git check-ignore -v` and `git add --dry-run`. Existing `docs/audit/*_AUDIT.md` deliverables (15+) survive only via index grandfathering; new files need either the `!docs/audit/**` whitelist or `git add -f`. Same class-bug as docs/memory/ (commit 1f8b0f0 / PR #11).
type: feedback
originSessionId: 7c545014-c563-4f53-a719-b9b368b41a62
---

**Rule:** for any new audit md deliverable destined for `docs/audit/`:
1. Confirm `.gitignore` line 77-78 has `!docs/audit/` + `!docs/audit/**` whitelist (added 2026-05-12 in the V3.5 onboarding keyboard audit's chore commit). If absent, the whitelist must land FIRST as a separate atomic chore commit on the audit branch before the audit md is added.
2. Filename casing is **stylistic, not corrective**: lowercase `_audit.md` is preferred for parity with D3 precedent (`N7redux_D3_keyboard_dock_audit.md`) but uppercase `*_AUDIT.md` also tracks correctly once the whitelist is in place.
3. Never rely on rename-to-lowercase alone as the gitignore workaround. It doesn't work on Windows.

**Why (empirical, from 2026-05-12 second STOP):**

OpenCode ran the diagnostic battery on Eric's Windows machine:
- `git config core.ignorecase` → `true`
- `git ls-files --error-unmatch docs/audit/N7redux_D3_keyboard_dock_audit.md` → tracked (in index)
- `git check-ignore -v` on the same D3 file → empty (NOT matched, because tracked files bypass `.gitignore`)
- `git check-ignore -v docs/audit/V35_onboarding_keyboard_audit.md` (lowercase, new) → `.gitignore:48:*_AUDIT.md  docs/audit/V35_onboarding_keyboard_audit.md` — matched
- `git add --dry-run` on same lowercase new file → `paths are ignored ... Use -f`

Mechanism: on Windows with `core.ignorecase=true`, gitignore pattern matching is case-insensitive. `*_AUDIT.md` matches `*_audit.md` / `*_Audit.md` / etc. all the same. The ~15 existing tracked deliverables in `docs/audit/` (SECURITY_AUDIT.md, ACCESSIBILITY_I18N_UX_AUDIT.md, PERF_AUDIT_ROUND2.md, MASTER_REPORT.md, CRITICAL_FIXES.md, AUDIT_INDEX.md, N7redux_D3_keyboard_dock_audit.md, etc.) all predate the `.gitignore:48-70` audit-scratch block — they're grandfathered via `git ls-files`. New audit deliverables added after the rule landed are silently dropped regardless of case.

The `.gitignore:48-70` block was scoped to catch ad-hoc background-agent scratch dumps at project root (`MASTER_AUDIT.md`, `PERF_AUDIT.md`, etc. left in root by Cursor/Aider/etc.). Its pattern is path-agnostic (`*_AUDIT.md`, no leading `/`), which causes the collision with intentional content in `docs/audit/`. Same class-bug as `docs/memory/` (commit 1f8b0f0 / PR #11), which Eric fixed with an analogous `!docs/memory/**` whitelist exception.

**How to apply:**
1. **Writing a new audit prompt**: deliverable filename can be either case post-whitelist. Use lowercase `_audit.md` for D3 parity convention. Do NOT cite "lowercase avoids gitignore" as the rationale — that was the wrong mental model from this sprint's first STOP.
2. **Verifying ANY new file under `docs/audit/`** ships: the authoritative test is `git add --dry-run <path>` — output `add 'path'` means trackable, output `paths are ignored ... Use -f` means blocked. Do NOT rely on `git check-ignore -v <path>` alone: whitelist matches (`!docs/audit/**`) return exit code 0 AND print the negation pattern, which looks superficially like "the file is ignored" but actually means "the file matched a negation rule and is NOT ignored". This semantics quirk burned one diagnostic round in the 2026-05-12 STOP. Belt-and-suspenders: run BOTH `git add --dry-run` AND `git status docs/audit/` (file should appear in untracked list, not invisible). Same sanity-check discipline as `docs/memory/` from `lesson_memory_dual_write_must_verify.md`.
3. **If the whitelist somehow gets removed in a future `.gitignore` reorder**: do NOT silently reach for `git add -f` per case. Restore the whitelist as a separate chore commit. The `-f` shortcut is acceptable only as a one-shot emergency under explicit Eric direction.
4. **The proper long-term fix** (not yet done): pattern-restrict the audit-scratch block to project root with leading `/` (e.g. `/*_AUDIT.md` instead of `*_AUDIT.md`). This would let the block keep its defensive value against root-level slop without colliding with any subdirectory deliverable. Tagged 2026-05-12 by OpenCode in §五 anomalies as a follow-up beyond this sprint's whitelist patch.

**Cross-ref:**
- Class precedent: `docs/memory/` whitelist commit 1f8b0f0 / PR #11
- Sibling lesson for memory dir: `lesson_memory_dual_write_must_verify.md` — same `.gitignore` mis-scope class, different directory
- Triggering sprint: V3.5 onboarding keyboard audit, branch `audit/v35-onboarding-keyboard`, two STOPs (rename attempt → diagnostic → whitelist)
- D3 lowercase precedent (saved by grandfathering, NOT case): `docs/audit/N7redux_D3_keyboard_dock_audit.md`
- Hard-stop discipline that surfaced this twice: `docs/memory/opencode_no_self_decided_history_rewrite.md` (OpenCode correctly STOPped both times instead of `-f`-ing or self-editing `.gitignore`)
- chat-Claude's own correction: on first STOP I endorsed B (rename) with weak hedging; second STOP empirically forced the correct C answer. Lesson: when a hedge is present in the recommendation, treat the hedge as a load-bearing concern, not boilerplate. Either resolve the uncertainty empirically before recommending, or recommend the un-hedged option.
