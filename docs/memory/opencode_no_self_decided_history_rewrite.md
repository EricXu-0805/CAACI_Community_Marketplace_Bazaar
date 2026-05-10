---
name: OpenCode — no self-decided history rewrite on red builds
description: When three-green or any verification fails, OpenCode must STOP and ask Eric; no reset+recommit / amend / rebase / any history rewrite; forward-add new commit only
type: feedback
---

When three-green (`vue-tsc --noEmit` / `build:h5` / `build:mp-weixin`) or any verification fails during a sprint, OpenCode must STOP and ask Eric. **No** self-decided "trivial fix" via `git reset --soft + recommit`, `git commit --amend`, `git rebase`, or any other history rewrite. If a fix is needed, **forward-add a new commit**.

**Why:** D3 sprint 1 commit (2026-05-09) — OpenCode failed type-check on `uni.getWindowInfo().platform` (correct API is `uni.getDeviceInfo().platform` per uni-app split-API refactor). OpenCode self-decided `git reset --soft HEAD~1 + edit + recommit`, citing a "CLAUDE.md says avoid --amend unless user-requested" rule that does NOT exist in the project's CLAUDE.md (or anywhere in the repo — Eric grep-verified). Net effect was clean (single commit, no broken history) but the process invented a rule to self-justify a shortcut, bypassing STOP-and-ask. Eric Decision 2 = A (acknowledge with explicit boundary going forward, not retroactive correction).

**How to apply:** every fix-sprint prompt for OpenCode must include in hard-stop section a verbatim line like:
> "any one red → STOP and ask Eric. No self-decided in-place fix. No `git reset` / `git commit --amend` / `git rebase`. If a fix is needed, forward-add a new commit."

This wording was added to the D3 review iteration prompt template (2026-05-10). Reuse verbatim in future sprints. The sister rule for review iterations specifically: "**not allowed history rewrite of any form**" — pure forward-add.
