---
name: Session startup — state check before accepting work
description: Every new chat session, chat-Claude reads memory + git state + handoff docs FIRST, reports current state to Eric, only THEN accepts next-step instruction
type: feedback
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
When starting a new chat session, chat-Claude MUST verify current state before accepting any sprint task or answering any non-trivial question. **Don't ask Eric "what do you want to do" before reporting state.**

**Step 1 — Memory verification**: confirm `MEMORY.md` (auto-loaded) lists all expected entries (≥18 as of 2026-05-10). Source-of-truth: Cowork local at `<user>\AppData\Roaming\Claude\local-agent-mode-sessions\...\spaces\...\memory\`. Mirror: repo `docs/memory/`. If memory looks empty / partial, surface to Eric immediately before doing anything else.

**Step 2 — Git state**: confirm current `main` HEAD (`git log -1 --oneline`) and compare against the last-known sprint close in memory or recent handoff package. If drift, flag.

**Step 3 — Sprint state**: check `git branch -a` for in-progress feature branches; `ls docs/audit/` for ongoing audit-only sprints; recent PR / merge state on GitHub.

**Step 4 — Handoff package check**: if Eric pasted a 接力包 at session start, that supersedes any inferred drift. Reconcile against memory + git state and surface conflicts.

**Step 5 — Report back to Eric**: give a concise state snapshot in this 4-line format:
- **Prod HEAD**: `<hash>` (squash of last PR / commit subject)
- **Last closed sprint**: <name> (PR # if applicable)
- **Pending / in-progress**: <branch / audit / decision queue>
- **Next-step candidate per launch blocker queue**: <highest-priority unblocked sprint>

Then wait for Eric's instruction — don't pre-emptively start a sprint.

**Why:** D3 sprint took 2 days across multiple chat sessions (2026-05-09 to 05-10). Without explicit state check at session start, drift accumulates between memory / repo / Eric's mental model, creating confusion (e.g. assuming sprint is closed when it's not, mis-numbering N12/N13 reused IDs, missing that an audit md is sitting untracked). The 4-line state snapshot lets Eric calibrate "Chat-Claude is on the same page" in 10 seconds rather than re-explaining context.

**How to apply:** every new chat session, run steps 1-5 before answering. Do NOT skip step 5 — the report-back is the contract. If Eric pastes a long handoff package at session start, do steps 1-4 silently and step 5 explicitly as the first user-facing response.

**Exception**: trivial conversational replies ("hi", "thanks") don't need full state check. Anything that touches code / SQL / sprint planning does.
