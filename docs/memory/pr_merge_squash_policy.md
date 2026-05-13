---
name: PR merge policy — squash-merge, all changes via PR (main is protected)
description: Squash-merge chosen 2026-05-08; main has GitHub branch protection (3 required status checks); ALL changes including docs-only must go through PR (direct push rejected with GH006)
type: feedback
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
PR merge policy is squash-merge (chosen 2026-05-08). Atomic commits ("修一个验收一个") live on feature branches; main holds one squashed commit per feature for clean bisect / cherry-pick. To recover atomic commits, find the deleted feature branch via reflog or `gh pr view`.

**All changes go through PR — no direct push to main.** main has GitHub branch protection enabled requiring 3 status checks; direct push (`git push origin main`) is rejected with `error: GH006: Protected branch update failed`. Even docs-only / mig-only changes must go through a feature branch + PR + squash-merge.

**Pre-push hook is NOT a bypass.** The local pre-push hook's "smart skip" for docs/migrations/scripts/api-only changes only skips the LOCAL three-green (vue-tsc + build:h5 + build:mp-weixin); it doesn't talk to GitHub. Branch protection is server-side and applies regardless of what the local hook did.

**Recovery flow when stuck with commits on local main that can't push:**
```cmd
git checkout -b <feature-branch>     :: take the commits with you
git checkout main
git reset --hard origin/main          :: revert local main to remote
git checkout <feature-branch>
git push -u origin <feature-branch>
gh pr create --title "..." --body-file <path>
```

Use `--body-file` (not `--body "multi\nline"`) on Kenny machine — Windows cmd.exe drops multi-line `-b` body. See `windows_cmd_multiline_commit_gotcha.md`.

**Surfaced 2026-05-10** — Eric tried to direct-push 3 docs commits (memory mirror + D3 audit + Windows cmd gotcha) to main; remote rejected. Chat-Claude wrote prompts referencing "docs direct push to main" based on misread of pre-push hook behavior; corrected.
