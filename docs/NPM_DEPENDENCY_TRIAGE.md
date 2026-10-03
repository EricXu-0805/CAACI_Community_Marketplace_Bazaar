# npm audit triage

Refreshed 2026-10-03 UTC using Node 22.23.3 and npm 11.21.0. The current
lockfile uses Vite 6.4.3. Historical clean audit results below do not describe
the current registry advisory state.

## Current candidate

| Audit view | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| Complete dependency tree, 2026-10-03 | 0 | 0 | 32 | 0 | 32 |

The 32 affected dependency nodes share one root advisory:
[braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
affecting versions through 3.0.3. The registry's latest braces remains 3.0.3,
and the advisory lists no patched release. The existing moderate-severity
audit gate therefore remains a release blocker. This is not 32 distinct
vulnerabilities or proof of browser/runtime exploitation.

Update the existing brace-expansion override from 5.0.9 to the official
5.0.12 patch. It addresses the new
[quadratic rewrite](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[nested brace](https://github.com/advisories/GHSA-qhr7-859c-m2p7), and
[comma parser](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) advisories.
The lockfile update changes only that package. Full-tree audit still fails on
braces after this update; do not suppress it, downgrade DCloud, or use
`npm audit fix --force` to manufacture a passing release.

[Upstream braces PR #72](https://github.com/micromatch/braces/pull/72) is an
unmerged proposal, not an official package release. Any local patch requires
independent validation of string and AST entry points, ordinary glob behavior,
and compiler bundles that contain their own copy. A package override alone
does not establish that Vite/Rollup's bundled code is fixed. No local fork or
advisory exclusion is included in this candidate.

These are registry-advisory results for this lockfile, not a claim that the
application has no exploitable bugs. Re-run them after dependency changes and
on the weekly schedule. The release receipt must bind the result to the actual
main SHA and deployment.

## Historical September release follow-up

The 2026-09-06 Node 22.23.2/npm 11 scan reported zero findings for both the
complete tree and `--omit=dev`. That was a dated result, superseded by the
October advisory state above.

Main's production-labelled scan found 27 low-severity dependency nodes, all
from postcss-selector-parser. Updating that parser removed them. A separate
full-tree scan then exposed 4 moderate and 2 high nodes hidden by `--omit=dev`:
qs and brace-expansion plus their dependents. Those then-known advisories were
patched in the September candidate.

| Package | Previous | Selected patch | Advisory |
|---|---|---|---|
| postcss-selector-parser, major 6 | 6.1.2 | 6.1.3 | [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92) |
| postcss-selector-parser, major 7 | 7.1.1 | 7.1.3 | Same advisory |
| brace-expansion | 5.0.7 | 5.0.9 | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| qs | 6.15.3 | 6.16.0 | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) |

Scoped overrides retain both parser major versions and the existing uni-app
release. No forced DCloud downgrade or blanket `npm audit fix --force` was
used. That September update changed four package versions across five nodes.
Use clean installation, type-check, both builds, boundary tests and browser
regression together to verify compatibility; an audit result alone is not a
functional acceptance result.

## Build and runtime exposure

DCloud declares some compiler tools as ordinary dependencies. Conversely,
`--omit=dev` excludes some build/dev-server risks. Neither dependency label is
a reliable browser reachability classification. Vercel runs the build tools,
then serves compiled H5 assets; the local Vite and Express development servers
are not deployed as the public application server.

Keep the existing development boundary: loopback binding, strict port, denied
cross-site Origin/Referer/Fetch-Site requests and disabled open-in-editor route.
Do not expose development servers through public tunnels. The build artifact
scanner continues to reject privileged keys, source maps and removed native
image-decoder material in public assets.

## CI and operations

- Node remains 22.x; the npm 11 audit client uses the registry bulk-advisory
  endpoint. Updating the audit client does not change the application runtime.
- Install using `npm ci --legacy-peer-deps` and the committed lockfile.
- CI now audits **production and build dependencies together**, with a
  moderate severity failure threshold. It runs on main, scheduled checks and
  dependency-changing PRs. Deterministic tests always run independently.
- Registry failures remain failures, with bounded retries only for connection
  errors/timeouts. Real advisories fail immediately; no severity downgrade or
  ignore rule was added.
- Current low findings are also zero. Review new low advisories by reachability
  and fix availability instead of assuming the CI threshold settles them.
- Preserve the existing license inventory and executable license-boundary
  checks; dependency upgrades must not introduce undocumented licenses.

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
