# Audit archive

During build-out (Apr–Jun 2026) the marketplace went through several audit
rounds — accessibility / i18n / UX, security, performance, and the V3 / V3.5
visual-refresh + onboarding sprints. Those reports describe what each round
intended to ship; they are historical evidence, not proof that the current
production schema/bundle still has every fix.

The current detailed release-candidate and production-gap reports are retained
in the private operational handoff, not this public repository. They may contain
deployment-state detail that should be disclosed only after the corresponding
fixes are deployed and reviewed. Older “resolved/shipped” labels therefore must
not be used as a current release gate by themselves.

The ~28 individual reports were consolidated into this summary on 2026-06-25 to
keep the tree readable. The full text of every original report is preserved in
git history, e.g.:

```bash
git log --all --oneline -- docs/audit/SECURITY_AUDIT.md
git show <commit>:docs/audit/SECURITY_AUDIT.md
```

## What the historical rounds covered

- **Security** — RLS coverage, `anon` EXECUTE grants (REVOKE FROM PUBLIC is not
  enough — must also revoke from `anon`), admin RPC auth (timing-safe token
  compare), storage object policies, MIME/currency input specs. Hardened across
  migrations + QA rounds 2–6. Re-verify the current production object
  definitions, grants and Advisor output before relying on those claims.
- **Accessibility / i18n / UX** — contrast, aria labels, bilingual (zh/en)
  coverage, empty + skeleton states. The current audit adds keyboard/dialog
  regressions and retains real-device screen-reader verification as a gate.
- **Performance** — bundle size, image/thumbnail handling, list rendering.
  Addressed in the V3 refresh.
- **V3 / V3.5 visual refresh + onboarding** — design-system migration
  (icon/button infra, tokens), dark mode, onboarding wizard (later removed
  entirely — "O1"). Shipped in PRs #12–#82.

## Where current state lives

For the public operational contract, use:

- `RUNBOOK.md` — operations + the "Launch day — in order" sequence
- `ENV_CHECKLIST.md` — env vars + Supabase auth setup + diagnostics
- `docs/QA_DEVICE_CHECKLIST.md` — real-device / two-account verification
- `docs/SECURITY_SETUP.md` — historical activation context plus current safety
  warnings

Release owners must also consult the private dated audit before staging or
production changes. Publishing that report requires a separate disclosure
review after deployment.
