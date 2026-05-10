---
name: Actors — Eric / Chat-Claude / audit-build agent three-role model
description: Eric=red-line/decisions/push, Chat-Claude=PM/specs/review, audit-build agent (OpenCode current, Claude Code through 2026-05-09) executes audit+build, never pushes/PRs/merges
type: feedback
---

3-actor model: Eric makes decisions + manually pushes commits + manually runs SQL (red-line ops). Chat-Claude is PM/specs/review/prompt-strategy. Audit/build agent executes audit + build, commits to feature branch, but NEVER pushes / NEVER creates PR / NEVER merges — Eric does those manually via GitHub UI. Long chats compress to handoff packages ("接力包") that get pasted into new chat windows.

**Audit/build agent identity:** OpenCode (current, since 2026-05-10). Was Claude Code through 2026-05-09 N13/N14 sprint. Address the agent by current name (OpenCode) when writing prompts.

**Why the switch matters:** prior agent transgressions carry forward as cautionary context — Claude Code's PR #4 self-merge and N7-redux D2 mig 041 v1 view-dependency miss are baked into hard-stop wording in every prompt. OpenCode inherits the rules; new transgressions (e.g. D3 sprint 1 reset+recommit on type-check fail, 2026-05-09) get folded into the same hard-stop discipline.
