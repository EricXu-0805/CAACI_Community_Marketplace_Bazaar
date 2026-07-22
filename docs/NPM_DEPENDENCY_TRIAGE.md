# npm audit triage

> Refreshed: 2026-07-18 against the current `app/package-lock.json`, after
> applying only compatibility-checked transitive overrides. Re-run the two
> audit commands below before relying on these numbers; registry advisories
> can change without a repository change.

> Release boundary: this is the local release-candidate lockfile snapshot. The
> overrides and the CI workflow changes are not proof of a production deploy or
> a remote CI run; verify the deployed build hash and CI run URL at release time.

## Current numbers

| Snapshot | Total | Low | Moderate | High | Critical |
|---|---:|---:|---:|---:|---:|
| Before this hardening pass | 68 | 35 | 21 | 12 | 0 |
| Before, `--omit=dev` | 43 | 22 | 13 | 8 | 0 |
| **Current full tree** | **2** | **0** | **1** | **1** | **0** |
| **Current `--omit=dev`** | **0** | **0** | **0** | **0** | **0** |

Commands used:

```bash
cd app
npm audit
npm audit --omit=dev
```

The full-tree command still exits non-zero because the pinned Vite development
toolchain remains. `npm audit --omit=dev` now exits zero. Do not turn that
production-labelled result into a claim that every build-time risk is closed.
The important changes are:

- no critical finding in either view;
- the production-labelled view has no remaining finding;
- the one remaining high finding in the full tree is the direct Vite 5.2.8
  development/build dependency; the one moderate node is its direct
  `@dcloudio/vite-plugin-uni` dependent.

`npm audit` counts affected dependency nodes, not user-reachable exploits. The
numbers are still useful as an upgrade signal, but severity and reachability
must be evaluated separately.

## What changed in this pass

`app/package.json` now pins compatible patched transitives through `overrides`:

- adm-zip 0.6.0 (CVE-2026-39244 allocation bound; DCloud's used
  `addLocalFile` / `writeZip` / `extractAllTo` paths passed both builds);
- Babel core/SystemJS transform 7.29.7;
- Intlify core/compiler/shared 9.14.5 and vue-devtools 9.14.1;
- Express 4.22.2;
- esbuild 0.25.12 (clears the development-server cross-origin advisory that
  had also caused 27 duplicate DCloud/uni-app nodes in `--omit=dev`);
- form-data 3.0.5;
- jpeg-js 0.4.4 and phin 3.7.1;
- postcss 8.5.10;
- brace-expansion 5.0.6;
- js-yaml 3.15.0;
- the affected ws 8.18.0 node is overridden to 8.21.1.

The type-checking toolchain was also moved together to TypeScript 5.9.3,
`vue-tsc` 3.3.7 and `@vue/tsconfig` 0.9.1. That removes the vulnerable Vue 2
template-compiler chain. It also immediately caught a real runtime bug that
the previous checker missed: onboarding passed a block-scoped `accountToken`
before its declaration during avatar upload. The call now passes the captured
`submitAccountToken`, and the upgraded checker passes.

The lockfile was regenerated with those exact overrides. The compatibility
gate is not just `npm install`: type-check, H5 build, mp-weixin build, and the
API/client boundary tests must all pass together after any override change.

We deliberately did **not** run `npm audit fix --force`. npm's proposed DCloud
downgrades/major changes do not preserve this project's uni-app contract.

## Why the production-labelled view used to report build tools

Here, npm's “production” classification does not mean “executed in the
browser after deployment.” Several `@dcloudio/*` packages declare their CLI
and compiler toolchain as regular dependencies so a consumer can run
`uni build`. That graph includes bundlers, compilers, image tooling, and local
development-server packages.

Vercel executes that graph during the build, then serves
`app/dist/build/h5/` as static output. The browser bundle contains application
code plus selected Vue, uni-app runtime, Supabase, and Sentry code; it does not
ship the Node Express server, Vite dev server, or image-build CLI as a server
process.

This boundary reduces runtime reachability, but it does **not** make the
findings irrelevant:

- build systems process trusted repository inputs and therefore remain part of
  the software supply chain;
- a developer who exposes `npm run dev:h5` through a tunnel changes the threat
  model and may expose Vite/esbuild development-server issues;
- adding server-side image processing or Express routes would make previously
  build-only packages runtime-reachable;
- a future uni-app/DCloud upgrade can add, remove, or reclassify the same nodes.

## Remaining full-tree high finding: Vite

The current direct Vite version is 5.2.8. The live 2026-07-18 audit reports it
as the only high entry in the full dependency tree. The current official
DCloud `vue3` tag still declares the exact peer `vite: 5.2.8`; merely moving to
the latest 5.4.x also does not clear the current advisory range.

An isolated Vite 6.4.3 experiment was performed rather than guessed: H5,
mp-weixin, the upgraded type-checker, and a zero-finding npm audit all passed.
It was deliberately not adopted because `npm ls vite` then reports an invalid
dependency graph: the Uni plugin requires exactly 5.2.8, while its Vue/legacy
plugins require Vite 5 ranges. Passing two builds is not enough evidence to
override all of those vendor compatibility contracts.

Treat the Vite/DCloud upgrade as a separate migration:

1. choose a DCloud release that officially supports a non-affected Vite line;
2. install from a clean lockfile on Node 22;
3. run type-check, H5 and mp-weixin builds;
4. run all boundary and browser smoke tests;
5. compare generated H5/mp assets and real-device behaviour before merging.

Until then, the candidate adds an executable boundary rather than relying on
operator memory alone:

- Vite binds to `127.0.0.1` with `strictPort`;
- the first development middleware rejects non-loopback hosts, cross-site
  `Origin`/`Referer`/`Sec-Fetch-Site`, and all `__open-in-editor` requests;
- CORS is limited to loopback origins;
- deterministic tests cover the policy; a live temporary server returned 200
  for same-origin and 403 for both a cross-site request and the editor route.

Do not expose it via ngrok, public tunnels, or shared untrusted networks. These
controls reduce reachability; they do not relabel Vite 5.2.8 as patched.

## Operational controls

- Use the repository's exact Node 22 baseline (`.nvmrc`; package engine
  `22.x`). Node 20 is past both upstream EOL and Supabase client support.
- Install deterministically with `npm ci --legacy-peer-deps`; this is the same
  install mode used by CI and `vercel.json`.
- Review every direct dependency addition in the PR diff.
- Re-run both audit views whenever `app/package-lock.json`, DCloud, Vite, or a
  direct dependency changes.
- Never silence a new critical/high finding solely by updating this document.
  Either patch it or record a concrete reachability analysis and owner.

## CI policy

The candidate CI boundary job now runs
`npm audit --omit=dev --audit-level=moderate` after its deterministic install.
That gate is clean on this lockfile and will fail on any newly classified
production dependency advisory. The full-tree Vite exception is not silently
suppressed: it remains documented here and is constrained by the tested local
server boundary until DCloud publishes a compatible fixed line.

Continue to track advisory IDs and affected ranges, require review for any
baseline change, and refresh the live result even when dependencies did not
change.

The next required dependency project is the coordinated DCloud/Vite upgrade;
the safe transitive patches above are already applied.

## Software-license boundary

The 2026-07-19 lockfile inventory covers the full locked package graph. Three legacy
transitives omit a `package.json` license field, but their bundled files provide
exact MIT (`dom-walk`, `exif-parser`) or Apache-2.0 (`qrcode-terminal`)
evidence. The release-candidate production-dependency graph now has no
dependency declaring a copyleft or source-available license. The former H5
fallback decoder was removed; H5 keeps native HEIC decoding and rejects
unsupported browsers explicitly instead of uploading original HEIC bytes or
distributing a decoder.

`scripts/license-boundary.test.mjs` makes this inventory drift visible: a new
missing SPDX field or a new copyleft/source-available license fails the
deterministic boundary suite until it receives an exact version review. This
is a change-control guard, not legal advice.
