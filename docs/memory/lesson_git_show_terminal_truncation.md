---
name: Lesson — `git show <ref>:file` output in cmd.exe can be silently truncated by terminal scroll buffer
description: Don't trust visual line count of `git show <ref>:file` output in Windows cmd.exe — terminal scroll buffer can clip later lines without indicator, making a 30-line file look like 21 lines. Always count programmatically before drawing conclusions.
type: feedback
originSessionId: b350322d-3f7f-470f-b423-3a74dd2cb691
---
**Rule**: When inspecting a file's content at a specific git ref via `git show <ref>:path/to/file` in Windows cmd.exe, do NOT rely on the visual end of output to determine the file's full content. The terminal scroll buffer can silently truncate displayed lines without any `(more)` indicator or end-of-content marker.

**Why:** 2026-05-12 incident during `docs/memory-sync-pre-fix-sprint` branch triage (Round 2 cleanup PR #16). Ran `git show 33f2c77:docs/memory/MEMORY.md` in cmd.exe; output appeared to end cleanly at the "Google OAuth — supabase.co page is correct" line (entry 21) with a blank line + prompt below — no truncation indicator. Chat-Claude concluded the branch had a 9-entry drift from Cowork local (which actually has 30 entries) and proposed a catchup-commit plan. Subsequent `xcopy` + `git diff` analysis revealed the branch's MEMORY.md was content-identical to Cowork local (modulo `originSessionId` backfill across 30 files); the terminal had truncated the `git show` output mid-file. One analysis cycle wasted on a phantom drift.

**How to apply:** When verifying file content at a specific git ref in cmd.exe:

1. **Count programmatically, not visually:**
   - `git show <ref>:file | findstr /R /C:"^- \[" | find /v "" /c` — counts MEMORY.md-style index entries
   - `git show <ref>:file | find /v "" /c` — counts total lines
   - bash equivalent: `git show <ref>:file | wc -l`
2. **Pipe to file, then inspect with a real editor / pager:**
   - `git show <ref>:file > %TEMP%\inspect.md` then `type %TEMP%\inspect.md | more`
   - Or open the temp file in VS Code / notepad for guaranteed full visibility
3. **Cross-check against `git diff --stat`** — if the stat says "N lines changed" but visual diff suggests otherwise, trust the stat (operates on full content, no terminal truncation)
4. **Compare hashes when you only need equality, not visualization:**
   - `git show <ref>:file | git hash-object --stdin` vs `git hash-object <working-tree-file>` — equal hashes mean identical content

**Cousin lessons:**
- `lesson_spec_token_check_actual_values.md` — verify CSS token values from file, not from assumption
- `lesson_template_binding_full_block.md` — quote full element block, not single-line snippet
- `lesson_memory_dual_write_must_verify.md` — verify BOTH MEMORY.md + .gitignore filter, don't trust silent matches

**Generalization**: whenever using a terminal to inspect content you'll draw conclusions from, prefer programmatic verification over visual scanning. Visual scanning fails for files larger than the cmd.exe scroll buffer (default ~9000 lines but truncation can happen earlier when `git show` is piped through pager-like behavior); programmatic count + hash compare is O(1) reliability.
