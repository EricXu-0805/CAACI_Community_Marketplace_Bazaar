---
name: Lesson — chat-Claude's memory dual-write must verify BOTH MEMORY.md + audit .gitignore
description: From 2026-05-11 memory sync recovery. Two oversights compounded — chat-Claude updated Cowork local MEMORY.md but never mirrored to repo; .gitignore audit patterns (uppercase) silently matched 4 lowercase memory filenames on Windows core.ignorecase=true. Going forward, every memory update must explicitly Write BOTH MEMORY.md files in the same response + audit new memory filenames against .gitignore before committing
type: feedback
---

After ~25 memory writes across the v3 P1 sprint, Zach pulled main expecting Cowork-readable memory and surfaced two compounding gaps. Both are violations of `docs_memory_mirror_convention.md` that chat-Claude should have prevented.

## Root cause 1 — MEMORY.md index drift

chat-Claude treated `MEMORY.md` (the index) differently from individual memory entries. When adding a new memory file:
- Wrote entry file to Cowork local ✓
- Wrote entry file to repo mirror ✓
- **Edited MEMORY.md ONLY in Cowork local** ✗

Result: repo `docs/memory/MEMORY.md` lagged 4+ entries behind Cowork local across the sprint. Zach pulled the stale index, saw it reference files that *did* exist in repo (because their entry files were correctly dual-written), but missed v3 P1 entries entirely from the index even though their entry files were committed.

**How to apply:** every memory operation that touches MEMORY.md must Edit BOTH paths in the same response — chat-Claude's reflex is "Cowork local first then repo" for entry files but the MEMORY.md edit usually feels like a one-line index housekeep that gets attached only to the local update. Force the discipline: if MEMORY.md is being touched at all, schedule two Edit/Write calls back to back.

## Root cause 2 — `.gitignore` silent collision

Repo `.gitignore` (lines 48-69) contains audit-scratch ignore patterns intended for OpenCode background-agent output:

```
*_AUDIT_*.md
DESIGN_SYSTEM_*.md
DARK_MODE_*.md
PERFORMANCE_*.md
... etc
```

On Windows with default `core.ignorecase=true`, these uppercase patterns **silently match** lowercase memory filenames:
- `workflow_audit_first.md` → matched `*_AUDIT_*.md` (substring `_audit_`)
- `sprint_form_audit_only_vs_one_pass.md` → matched `*_AUDIT_*.md`
- `design_system_asset_zip.md` → matched `DESIGN_SYSTEM_*.md`
- `design_system_two_track.md` → matched `DESIGN_SYSTEM_*.md`

`git add` for these files silently no-op'd for weeks. They sat as ignored-not-untracked, invisible to `git status` default output.

**How to apply:** when writing any new memory entry file, mentally scan the filename against `.gitignore` patterns (especially the uppercase audit-scratch block). Watch for substrings:
- `_audit_` anywhere in the name → matches `*_AUDIT_*.md`
- `design_system_*`, `dark_mode_*`, `performance_*`, `ui_*`, `image_*` as prefix → matches uppercase glob siblings
- `_summary`, `_report`, `_fixes` as suffix → also matches

If a planned filename collides, either rename the memory entry (e.g. `sprint_audit_first_vs_one_pass.md` → `sprint_form_audit_vs_one_pass.md` — though even this still has `_audit_`; cleaner: `workflow_audit_first.md` → `workflow_audit-first.md` to break the underscore boundary, or just rename the concept). Or rely on the `!docs/memory/**` whitelist (added 2026-05-11) — but the whitelist is brittle to future `.gitignore` reorders.

**Sanity check before declaring a dual-write done:** ask Eric to run `git status docs/memory/` (not just visual confirmation that the file was written). If a memory entry doesn't show up in untracked-or-modified after the Write tool succeeded, it's getting eaten by `.gitignore`.

## The recovery (2026-05-11)

- Added `!docs/memory/` + `!docs/memory/**` whitelist exception at end of repo `.gitignore` after the audit-scratch block
- Re-synced `docs/memory/MEMORY.md` to match Cowork local current state (24 entries)
- Committed the 4 previously-silenced memory files via `docs/memory-sync-fix` branch
- Confirmed Zach's pull will now see complete memory

## Cross-ref

- Triggering convention: `docs_memory_mirror_convention.md`
- The 4 files affected: `workflow_audit_first.md`, `sprint_form_audit_only_vs_one_pass.md`, `design_system_asset_zip.md`, `design_system_two_track.md`
- Whitelist patch lives in repo `.gitignore` (last block)
