---
name: Memory mirror in repo `docs/memory/`
description: Cowork local memory is source-of-truth; repo `docs/memory/` is mirror for backup + team reference; chat-Claude must sync BOTH on every memory update; Cowork wins on conflict
type: project
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
Memory files (chat-Claude's persistent context layer) live in two places:

**Source-of-truth**: Cowork local at
`C:\Users\<user>\AppData\Roaming\Claude\local-agent-mode-sessions\<session>\<space>\spaces\<id>\memory\`

**Mirror**: repo `docs/memory/` (tracked in git, pushed to GitHub)

**Why mirror exists:**
- Cross-device / cross-account backup — Cowork session reset / device migration shouldn't lose memory
- Team visibility — Kenny / Zach can read the workflow agreements + project state Eric and chat-Claude have locked in
- Faster cross-session handoff — new chat can be pointed to repo mirror if Cowork local is empty

**Sync convention (chat-Claude must follow):**
- Every memory update operation (add / edit / delete) writes to BOTH locations in the same message
- The `MEMORY.md` index in both locations must stay identical
- Repo mirror lands in main via **PR + squash-merge**, never via direct `git push origin main`

**Conflict resolution**: Cowork local is source-of-truth. If two paths drift, Cowork local wins; repo mirror gets force-overwritten on next sync.

**PR-flow requirement (added 2026-05-13 after branch-protection incident):**

Main branch has GitHub branch protection enforcing "3 of 3 required status checks". Direct `git push origin main` is **rejected** with `GH006: Protected branch update failed`, even for doc-only commits. Memory mirror updates therefore must follow one of these patterns:

1. **Pre-sprint memory bundle (recommended)**: chat-Claude writes memory updates BEFORE the OpenCode sprint kicks off. Memory files sit uncommitted in Eric's working tree. OpenCode branches from main, makes its build commits, then Eric commits the memory files as an additional commit on the SAME feature branch (or bundles via cherry-pick). One PR contains code + memory + audit docs together. Squash-merge.

2. **Post-sprint cherry-pick (fallback if pattern 1 missed)**: if memory wasn't pre-bundled and the sprint is mid-flight, commit memory to local main first; then `git branch _mem-tmp` to mark; `git reset --hard origin/main`; switch to the fix branch; `git cherry-pick _mem-tmp` to move the doc commit onto the fix branch top; push fix branch. Used 2026-05-13 for v3.5 PR #13.

3. **Doc-only PR (rare)**: open a separate PR with only memory + audit changes. Squash-merge. Use only when no concurrent sprint is in flight and memory can't wait.

**Anti-pattern (do NOT do)**:
- `git checkout main; git add docs/memory/; git commit; git push origin main` — will be rejected by branch protection. Wasted setup work.
- Telling Eric to push memory direct to main from a fresh terminal — same rejection.

**How to apply (every future memory update):**
- Before writing any memory, mentally note: "I will write this twice + it must flow through a PR"
- After all memory writes, give Eric the bundle/cherry-pick command sequence (per pattern 1 or 2 above), NOT a direct `git push origin main`
- Repo mirror staleness (Cowork local ahead of repo) is acceptable temporarily; OpenCode reads from local working tree so it sees new memory even before PR merges
- Don't `.gitignore` `docs/memory/` — it's meant to be tracked
- Don't tell Chat-Claude in next session to read repo mirror as primary — Cowork local auto-loads MEMORY.md, mirror is backup not input
