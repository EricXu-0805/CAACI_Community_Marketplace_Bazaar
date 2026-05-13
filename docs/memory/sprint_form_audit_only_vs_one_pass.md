---
name: Workflow — audit-only first vs audit+fix 一把过 decision rule
description: Audit-only first when cross-platform / new module / quirky API / animation / view-dependent schema; audit+fix 一把过 for single-file UI / well-understood pattern / state cleanup
type: feedback
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
**Audit-only first** (audit md output → Chat-Claude reviews + Eric decides → fix is a separate sprint) is required when the sprint has ANY of:
- Cross-platform code paths that diverge (e.g. H5 `visualViewport` vs mp-weixin `uni.onKeyboardHeightChange`)
- New composable / module without project precedent (greenfield code)
- Quirky platform API with documented quirks (iOS Safari visualViewport, mp-weixin Skyline fold-collapse)
- Interactive animation timing (transform / transition contracts where wrong timing = jank)
- Schema migration touching views / functions / materialized views (per N7-redux D2 mig 041 v1 view-dependency lesson — DROP COLUMN/TABLE must enumerate dependencies via `pg_depend` before fix)

**Audit+fix 一把过** (single sprint covers both phases) is acceptable when:
- Single-file UI bug, scope ≤ 1 file
- Well-understood pattern reused (e.g. N5.1 token reuse in N13)
- State cleanup / defense-in-depth (e.g. N14 3-layer fix on plaza/index.vue only)

**Why:** D3 keyboard dock (2026-05-09 to 05-10) used audit-only first because cross-platform + new composable + iOS Safari quirks. Audit caught the `.cs-x` scoping anomaly + 7 platform quirks before any code was written. N13 + N14 (2026-05-09) used audit+fix one-pass because single file + well-understood patterns. N7-redux D2 (pre-2026-05-09) was one-pass that should have been audit-only — agent missed view dependency, mig 041 v1 failed.

**How to apply:** when scoping a new sprint with Eric, classify by the ANY-of list above. If ANY check matches, propose audit-only first; explain the reason. If none match, default to audit+fix one-pass with explicit scope cap. The penalty for getting this wrong is either (a) audit fatigue when one-pass would suffice, or (b) shipping a half-baked fix when audit was needed.

Past examples for calibration:
- N13 + N14 (2026-05-09): audit+fix one-pass ✓
- N7-redux D2 multi-chip composer (pre-2026-05-09): one-pass that should have been audit-only ✗
- N7-redux D3 keyboard dock (2026-05-10): audit-only first ✓
- N1' translation (TBD): probably audit-only — multiple modules + i18n architecture
- 位置认证 audit (TBD): probably audit-only — multi-page UI + DB validation
