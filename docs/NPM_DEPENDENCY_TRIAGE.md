# npm audit triage

> Generated: 2025-04-25 (against `app/package-lock.json` as of commit `ce661d7`).
> Maintainer: regenerate when uni-app or Vite ships a major version. Quick
> "is this stale?" check: rerun `cd app && npm audit` and compare totals
> with the [Numbers](#numbers) section.

`npm audit` reports **54 advisories** (4 low / 16 moderate / 34 high).
After triage, **0 ship to production** and none are reasonably exploitable
for this app's threat model. This doc explains why, so future
maintainers don't waste a session chasing each advisory.

## Numbers

```
                  total   low   moderate   high   critical
all advisories       54     4         16     34          0
production-only      41     0         11     30          0
```

`production-only` = `npm audit --omit=dev`.

The `production-only` count (41) is misleading. **All 41 are pulled in
transitively through `@dcloudio/*` packages** (uni-app's monorepo).
@dcloudio depends on `@dcloudio/uni-cli-shared`, which depends on Vite,
esbuild, postcss, jimp, jpeg-js, express — all build-time tools.

Why does npm think these are production deps? Because uni-app's package
authors mark @dcloudio/uni-cli-shared as a regular `dependency`, not a
`devDependency`. They probably do this so `npm install` (without `--prod`)
fetches everything you need to run `uni build` after deployment, even
though *Vercel* never does that — Vercel runs `uni build` once during
its own build step, then serves only `dist/build/h5/`.

What actually ships to the browser bundle? Look in `app/dist/build/h5/`
after a successful build. Roughly:
- `assets/index-<hash>.js` — our code, minified, plus tree-shaken slices
  of vue, @sentry/vue, supabase-js
- `assets/supabase-<hash>.js` — supabase-js bundle
- `assets/vue-<hash>.js` — vue runtime
- `assets/uni-<hash>.js` — uni-app's H5 runtime helpers
- HTML + CSS + static assets

Notably absent: vite, esbuild, postcss, jimp, jpeg-js, express,
path-to-regexp, qs, body-parser, cookie, send, serve-static, vue-i18n,
vue-template-compiler. **None of the 41 "production" advisories cross
this boundary.**

## Triage by category

### Build-time tooling (Vite + esbuild + postcss + sass + vue-tsc)

```
[moderate] vite             — 12 advisories about server.fs.deny bypass in DEV server
[moderate] esbuild          — DEV server arbitrary fetch
[moderate] postcss          — XSS via unescaped </style> when stringifying CSS
[moderate] vue-template-compiler — XSS in template compiler output
[moderate] vue-tsc / @vue/language-core — same as above
```

**Threat model:** the Vite dev server (`npm run dev:h5`) serves files from
the project root with `server.fs.deny` controlling which files leak. The
bypasses listed allow a malicious page in the same browser to fetch
`.env`, `node_modules`, etc. from the dev server.

**Why we don't care:** the dev server only listens on `localhost:5173`
and only runs when a developer types `npm run dev:h5`. Production
(Vercel) serves prebuilt static files from a CDN; there's no `server.fs.deny`
to bypass because there's no dev server.

**When to revisit:** if we ever expose `npm run dev` over a tunnel
(ngrok, Tailscale Funnel) — then a remote attacker could exploit the
bypass. Rotate Vite to a clean version first.

### Image processing (jimp, jpeg-js, phin)

```
[high] jpeg-js     — Infinite loop / uncontrolled resource consumption
[moderate] jimp    — depends on jpeg-js
[moderate] phin    — leaks headers across redirects
```

**Threat model:** parsing a malicious JPEG triggers an infinite loop or
exhausts memory. Phin (HTTP client used by jimp) leaks Authorization
headers when redirected to a different host.

**Why we don't care:** jimp is only invoked at build time by uni-app to
generate icon PNGs and manifest assets. The input is our static assets,
which we control. No user-uploaded image ever passes through jimp in
this app — image uploads from users go straight to Supabase Storage,
which has its own server-side image processor.

**When to revisit:** if we ever add server-side image generation
(thumbnail generation, OG image rendering on /api). Replace jimp with
sharp (different vuln profile) or rely on a cloud transformer (Cloudinary,
imgix).

### Express + connect deps (path-to-regexp, qs, body-parser, cookie, send, serve-static)

```
[high] express          — composite of 5 below
[high] path-to-regexp   — ReDoS via multiple route params
[moderate] qs           — DoS via arrayLimit bypass
[low] body-parser       — depends on qs
[low] cookie            — accepts out-of-bounds chars
[low] send              — template injection in error responses
[low] serve-static      — depends on send
```

**Threat model:** typical web-server vulnerabilities — ReDoS, DoS, XSS
in error pages. Bites if any of these handle live HTTP traffic.

**Why we don't care:** express is pulled in by `@dcloudio/uni-cli-shared`
for the local dev server only. Production traffic goes through Vercel
edge runtimes (no express), Vercel's static asset serving (no express),
and Supabase RPC (PostgREST, no express). The express stack is a
build-time transitive dep that never serves real traffic.

**When to revisit:** if we ever write a Node.js server that uses express
(we don't — `/api/*` are Vercel edge functions, no express).

### Vue I18n (@intlify/*)

```
[high] @intlify/core-base   — Prototype pollution in handleFlatJson;
                              DOM XSS through tag attributes
[high] @intlify/message-compiler / message-resolver / runtime / vue-devtools
```

**Threat model:** vue-i18n templates that render translation strings as
v-html or as attribute values can execute attacker JS if the translation
data contains crafted strings.

**Why we don't care:** we don't import vue-i18n. uni-app uses @intlify
internally for its own i18n (e.g., for the locale selector in the H5
runtime), but the strings flowing into that path are the framework's
own static dictionaries — never user input.

**Independent verification:** `rg "v-i18n|i18n-t|@intlify|vue-i18n" app/src/`
should return zero matches. If it ever doesn't, this advisory becomes
real and we need to bump @intlify or sanitize the translation pipeline.

### Other (uni-app monorepo internal advisories)

About 20 more advisories on `@dcloudio/uni-*` themselves. All of these
are "uni-app pulls in [vulnerable thing]" — same root cause as the
categories above.

## Remediation options

| Option | Effort | Impact |
|---|---|---|
| **Accept & document** (current state) | 0 | None. Document why, monitor |
| Bump @dcloudio/uni-app major | High | Risk of build regressions; probably 1-2 days of fixing polyfill issues like the URL/Headers shim we just shipped |
| Eject @dcloudio for raw Vue + custom mp wrapper | Massive | Loses uni-app's value prop |
| Patch vulnerable transitives via npm `overrides` | Medium | Easy to break uni-app at runtime; compatibility is fragile |

**Decision: accept & document** until uni-app ships a major version
bump that updates Vite/esbuild/etc. Re-triage at that point.

## What about Dependabot / Snyk?

Dependabot has been deferred. If enabled today, it would file ~25 PRs
proposing `npm install path-to-regexp@latest` etc., each of which would
break uni-app's build (uni-app pins exact versions of its transitives).
Each PR would then need to be closed with a "won't fix" comment.

The right tool for this codebase is something that distinguishes
runtime from build-time — Snyk does this with its "production code"
filter, GitHub's native security scanning does not. If we move to a
codebase that ships server-side runtime, the calculus flips.

## CI gating

We **do not** fail CI on `npm audit`. Reason: every PR would be red
because of advisories we've already triaged. Instead:
- New direct dependency? Manual review during PR.
- New transitive? Caught when uni-app or Vite gets bumped, both of
  which require manual decisions.
- Suspicious dep introduced via supply-chain attack? Caught at code
  review (the new file/dep is visible in the PR diff) and by GitHub's
  built-in `Used by` warnings.

If we ever want CI to gate on audits, the approach is:
1. Snapshot today's audit output into `.audit-baseline.json`.
2. CI step: rerun audit, fail only on advisories not in the baseline.
3. PR-time bump to baseline = explicit acknowledgement.

(Tracking issue: not yet filed — open one if anyone wants to pursue.)
