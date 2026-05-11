---
name: Design system asset — "Illini Market Design System" zip
description: Vision-archive snapshot (v2.0) of 米白书院 design system. Prod App.vue:972+ already migrated; do NOT import zip CSS files. Use only as visual reference / brand reveal material
type: reference
---

The "Illini Market Design System" zip is a **historical / vision-archive snapshot** of the 米白书院 design language (made ~2025–2026, pre-migration). It contains tokens.css (light+dark vars), SKILL.md, README.md, colors_and_type.css, HTML mockups (brand_reveal, product_card_v3, motion, logo_system, journey, states, safety_flow), screenshots/, ui_kits/{ivory_academy, marketplace}/.

**Source of truth is now `app/src/App.vue:972-1146` (`:root { }` block) + `app/src/uni.scss` + `[data-theme="dark"]` block at App.vue:1164+.** Prod is on 米白书院 hybrid v5 — `--brand` `--canvas` `--surface` `--ink` `--accent-warn #D4923C` are all wired, legacy aliases (`--bg-page`, `--accent-action`) map back to new names via `var(--brand)`, `--campus-blue/--campus-orange` namespaced for the 5 verified-official surfaces only, webfonts self-hosted via `@fontsource-variable/{fraunces,noto-serif-sc,noto-sans-sc}` (H5 only), mp-weixin double-`:root`+`page` block solves the WXSS scope bug.

**Do NOT** `@import` any CSS file from this zip into prod, and do NOT mirror prod token changes back into the zip — they will diverge by design. Use the zip ONLY for: brand reveal materials, mockup screenshots, design lead reviews, OG card art. See `Illini Market Design System/LEGACY.md` (in zip) for the full archive policy.

Zip lives at `<workspace>\Illini Market Design System\Illini Market Design System\` after extraction; original on Eric's D drive.
