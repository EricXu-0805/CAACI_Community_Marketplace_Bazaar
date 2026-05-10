---
name: PR merge policy — squash-merge (atomic on branch, squashed on main)
description: Squash-merge chosen 2026-05-08; atomic commits "修一个验收一个" live on feature branches; main holds one squash per feature for clean bisect/cherry-pick; recover atomic commits via reflog or gh pr view
type: feedback
---

PR merge policy is squash-merge (chosen 2026-05-08). Atomic commits ("修一个验收一个") live on feature branches; main holds one squashed commit per feature for clean bisect / cherry-pick. To recover atomic commits, find the deleted feature branch via reflog or gh pr view.
