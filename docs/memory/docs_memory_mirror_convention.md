---
name: Memory mirror in repo `docs/memory/`
description: Cowork local memory is source-of-truth; repo `docs/memory/` is mirror for backup + team reference; chat-Claude must sync BOTH on every memory update; Cowork wins on conflict
type: project
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
- Eric / Kenny commit + push the repo mirror change after chat-Claude writes

**Conflict resolution**: Cowork local is source-of-truth. If two paths drift, Cowork local wins; repo mirror gets force-overwritten on next sync.

**How to apply (every future session):**
- Before writing any memory, mentally note: "I will write this twice"
- After all memory writes, give Eric the `git add docs/memory/ && git commit && git push` command for the mirror update
- Don't `.gitignore` `docs/memory/` — it's meant to be tracked
- Don't tell Chat-Claude in next session to read repo mirror as primary — Cowork local auto-loads MEMORY.md, mirror is backup not input
