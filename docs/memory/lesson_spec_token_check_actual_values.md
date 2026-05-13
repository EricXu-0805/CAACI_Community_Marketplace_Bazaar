---
name: Lesson — spec CSS gradient/animation must check actual token VALUES, not just token existence
description: When chat-Claude proposes CSS that depends on color differences between design tokens (gradients, shimmer animations, etc.), look up actual VALUES in App.vue; legacy aliases may share the same canonical value (per v3 P1 mirror) and produce a visual no-op despite both tokens existing
type: feedback
originSessionId: b953b797-5c97-4889-9ddc-e30f716e29b0
---
When proposing CSS that depends on a **color difference** between two or more design tokens (e.g. `linear-gradient(--token-a, --token-b)`, `shimmer` keyframe with multi-stop gradient, hover-state contrast, focus ring vs background, etc.), the spec MUST check the **actual numeric values** of those tokens in `app/src/App.vue`, not just confirm the tokens exist.

**Why:** 2026-05-13 incident. Spec for v3.5 banner-skeleton fix proposed `linear-gradient(90deg, var(--bg-subtle) 0%, var(--paper-2) 50%, var(--bg-subtle) 100%)` to replace hardcoded light hex (`#eaeaef`/`#f2f2f7`). The spec verified both tokens "are defined in BOTH `:root` and `[data-theme="dark"]` blocks" — checked existence, not values. OpenCode's audit caught that `--bg-subtle` ≡ `--paper-2` within each theme (v3 P1 legacy alias extension mirrored multiple aliases to the same canonical value: `#F0E9DA` in light, `#36322B` in dark). The proposed gradient resolved to a solid color in both themes, turning the `shimmer` animation into a visual no-op. The launch-blocker (bright white stripes on dark canvas) was still fully resolved by the change, but the motion polish was lost. A 1-line follow-up (`--paper-2` → `--bg-inset`) is needed to reactivate motion.

**Root cause (chat-Claude side):** I read `v3_p1_dark_mode_shipped.md` line 23 noting "Legacy `--bg-*` aliases extended to **mirror** the new values" but didn't make the connection that *mirroring means equal values*, and that equal values defeat a multi-stop gradient. Verifying token existence (which file:line defines the token) is not the same as verifying token values differ.

**How to apply:**

1. Whenever a spec proposal includes a gradient, animation, or any rule where two tokens MUST have different values to produce the intended effect, open `app/src/App.vue` and **read the actual hex values** in:
   - `:root { ... }` (light defaults)
   - `[data-theme="dark"]` (manual-dark override)
   - `@media (prefers-color-scheme: dark) :root:not([data-theme="light"]) { ... }` (system-dark mirror, if present)
2. Compute approximate ΔE (or just eyeball the hex values for obvious equality). If two tokens have identical or near-identical values, the gradient/animation is a no-op — pick a different token pair.
3. State the actual values in the spec, e.g. "Light: `--bg-subtle` = `#F0E9DA`, `--paper-2` = `#F0E9DA` — **same value, gradient will be solid, pick different tokens**".
4. For shimmer-style animations specifically, target a ΔE of at least 7-10 between gradient stops to keep motion perceptible.
5. When P1 / future phases extend "legacy aliases", note explicitly in the ship memo that multiple aliases share a value; this lesson is a downstream consequence of that pattern.

**Why this matters operationally**: per `actors_three_role_model.md`, chat-Claude writes the spec, OpenCode executes literally per `opencode_no_self_decided_history_rewrite.md`. If chat-Claude's spec is wrong but doesn't violate hard constraints, OpenCode will ship the wrong thing (correctly). The spec is the contract; getting it wrong costs a follow-up PR.

**Related**:

- `v3_p1_dark_mode_shipped.md` — alias mirror context (line 23, line 62-63)
- `v35_launch_blocker_shipped.md` — the incident
- `actors_three_role_model.md` — chat-Claude vs OpenCode role split
- `opencode_no_self_decided_history_rewrite.md` — OpenCode follows spec literally, surfaces observations
