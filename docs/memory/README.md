# Engineering notes (archive + durable gotchas)

> **History.** This directory was the **May-2026 OpenCode / Cowork-era memory
> mirror** — a Windows team workflow (Kenny / Zach) with sync conventions back
> when chat assistant + build agent were separate tools. That workflow is
> retired: the project is now maintained in **Claude Code**, with working memory
> kept by the assistant locally and project docs in `docs/` + `RUNBOOK.md` +
> `ENV_CHECKLIST.md`. The ~60 granular note files were consolidated here on
> 2026-06-25; their full text is in git history
> (`git log --all -- docs/memory/`).

What survives below is the subset of **durable engineering gotchas** still worth
keeping in-repo for any developer touching this codebase.

## uni-app (Vue 3) — H5 + mp-weixin

- **`<input>` is a wrapper, not the native element.** A `.input` SCSS class
  targets the outer `<uni-input>` custom element; the framework hard-codes
  `uni-input { height: 1.4em; overflow: hidden }`. Set an explicit
  `height: 44–48px`; **never** add a unitless `line-height` — it re-computes on
  the inner real input via inheritance and overflows.
- **`.uni-input-placeholder` is a separate absolutely-positioned overlay**, not
  the value text. When a visible sibling label exists, hide it with
  `:deep(.uni-input-placeholder) { display: none }` or it overlaps the value.
- **Conditional compilation** (`// #ifdef H5` / `#ifndef H5` / `#ifdef
  MP-WEIXIN`): mp-weixin WXSS support is partial (e.g. `>` child + `:nth-child`
  combinators), so H5-only CSS features should sit inside `#ifdef H5` and let mp
  degrade gracefully.
- **`uni build` does NOT type-check.** A green build ≠ types OK — run
  `vue-tsc --noEmit` separately. Don't read a build's exit code through `| tail`
  (PIPESTATUS is masked by tail's 0).
- **App.vue has no `<template>`**, so it can't host an app-wide overlay on mp;
  on H5 a second `createApp` is mounted on `document.body` for the global toast.

## iOS Safari

- **Real-device gate.** Mac Chrome + Mac Safari cannot reproduce iOS
  RenderThemeIOS internals or soft-keyboard behavior. Platform-specific UI fixes
  (keyboard occlusion, glyph clipping) need a Vercel preview + a real iPhone
  before merge.
- **Soft-keyboard occlusion.** Lift bottom composers via `useKeyboardHeight`
  (`window.visualViewport`) + `translateY(-kb.height)` with
  `:adjust-position="false"`. Subtract `visualViewport.offsetTop` or it
  over-lifts.

## Process

- **Stop blind iteration after 3 failed attempts** on the same bug → pause and
  reassess scope (the onboarding glyph-clip sprint burned 3 attempts before the
  flow was removed entirely).
- **Patch full element blocks**, not single-line `:class=` edits — a one-line
  patch invites silently dropping a sibling static class.
- Pre-push: `vue-tsc` + `build:h5` + `build:mp-weixin` all green. PRs
  squash-merge. `main` has branch protection (required status checks) — no
  direct push.

Anything operational (env, auth dashboard, launch sequence, runbook) lives in
`ENV_CHECKLIST.md` + `RUNBOOK.md`, not here.
