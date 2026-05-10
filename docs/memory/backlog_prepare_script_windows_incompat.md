---
name: Backlog — package.json prepare script Windows-incompat
description: Unix shell syntax in prepare script breaks Windows npm install; pre-push hook may not auto-install on fresh Windows clone; Kenny machine works via manual setup
type: project
---

`package.json` prepare script uses Unix shell syntax: `cd .. && git config core.hooksPath .githooks 2>/dev/null || true`. Windows cmd.exe doesn't recognize `2>/dev/null` redirect or `|| true` operator, so npm install fails on the prepare step on Windows machines unless `--ignore-scripts` flag is used.

**Side effect:** pre-push three-green hook may not auto-install on fresh Windows clones. Kenny machine works because `git config core.hooksPath .githooks` was manually run previously (proven by D3 push triggering hook 2026-05-10).

**Why:** surfaced 2026-05-09 in D3 sprint 1 OpenCode anomaly #1 — OpenCode used `--ignore-scripts` to bypass prepare failure during npm install. Did not block the sprint (hook was already installed) but is latent bug for any future Windows contributor.

**How to apply:** not a launch blocker (both proxy machines work currently — Zach macOS works natively, Kenny Windows manual setup done). Cleanup options for any low-stakes sprint:
- Rewrite prepare to cross-platform syntax (e.g. `node -e "..."` invocation)
- Move logic to `scripts/setup-hooks.cjs` and call from prepare via node
- Document Windows manual setup explicitly in README

Track for V1.x cleanup batch.
