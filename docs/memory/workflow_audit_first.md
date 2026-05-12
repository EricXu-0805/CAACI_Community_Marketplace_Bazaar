---
name: Workflow — debug → OpenCode → smoke test → memory → push (atomic commits, 5-section handoff)
description: Eric's required sprint flow as of 2026-05-12 — debug → OpenCode runs → smoke test → update memory → push + PR. Smoke test is HARD pre-push gate. Memory updates from the sprint ride with the deliverable branch (no separate Round 2 memory-sync PR). Atomic commits, "修一个验收一个". Final handoff = 5 sections.
type: feedback
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---

**Sprint flow (5 steps, each gates the next):**

1. **Debug** — Eric scopes the bug or feature; chat-Claude writes the audit prompt or fix spec
2. **OpenCode runs** — audit md OR atomic-commit fix on a feature branch; OpenCode runs vue-tsc + build:h5 + build:mp-weixin (per `pre_push_three_green.md`) before declaring handoff. Three-green is the *technical* pre-push gate, separate from step 3
3. **Smoke test (HARD pre-push gate)**:
   - **Audit sprints**: chat-Claude reviews the audit md for soundness — hypotheses ranked correctly? fix candidates platform-safe? open questions actionable? anomalies (especially memory-falsifications) captured?
   - **Fix sprints**: Eric reproduces the *original* bug in H5 dev build AND mp-weixin devtool to confirm the smoke scenario is real, then verifies the fix resolves it on both platforms. For dark-mode / theme work, smoke BOTH themes. For keyboard / safe-area / responsive work, smoke at least one small-screen device profile (e.g. iPhone SE)
   - **Fail path**: hand back to chat-Claude → re-spec or hand back to OpenCode. No push until smoke passes
4. **Update memory** — capture lessons learned, backlog status changes, sprint phase tracker updates, new memory entries on the SAME branch as the deliverable; dual-write per `docs_memory_mirror_convention.md`. **No more "Round 2 memory sync" PR** — that pattern allowed memory to drift from code state (driving incident: 2026-05-12 V3.5 onboarding keyboard audit, where memory deltas would have sat in WIP for >1 push cycle had Eric not collapsed it)
5. **Push + PR** — Eric pushes via proxy per `zach_git_proxy.md`, opens PR, squash-merges per `pr_merge_squash_policy.md`. Multi-line commit messages use `-F filepath` per `windows_cmd_multiline_commit_gotcha.md`. PR title is single-line and becomes the squash subject on main

**Scope discipline:**
- "修一个验收一个" — atomic commits on feature branch, squashed on main
- Audit-first for cross-platform / new composable / quirky API / animation / view-dependent schema sprints (decision rule in `sprint_form_audit_only_vs_one_pass.md`)
- Bundle THIS sprint's memory deltas + enabling-changes (e.g. `.gitignore` whitelist when the audit needs it to ship, composable extraction when the fix consumes it) onto the deliverable branch; leave unrelated WIP from prior sprints for its own cycle — don't muddy current sprint's PR

**Final handoff: 5 sections** — files read + files written + static reasoning summary + git state + anomalies.

**Lineage:** prior flow was "audit → spec → build → review → push → verify" with verify at the END after push. The 2026-05-12 V3.5 onboarding keyboard audit aftermath surfaced two problems: (a) verify-after-push meant smoke failures became hotfixes requiring forward-add or amend, fighting `opencode_no_self_decided_history_rewrite.md`; (b) memory updates landed as a separate Round 2 PR, letting lessons drift behind the code that prompted them. New ordering moves smoke test BEFORE push (failures stay on feature branch, no history rewrite) and collapses memory updates into the same push cycle.
