# npm audit triage

Refreshed 2026-09-06 (Chicago) using Node 22.23.2, a clean install and both
full-tree and production-labelled npm 11 audit views. This replaces the July
snapshot: the current lockfile uses Vite 6.4.3, not Vite 5.2.8.

## Current candidate

| Audit view | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| Complete dependency tree | 0 | 0 | 0 | 0 | 0 |
| `--omit=dev` | 0 | 0 | 0 | 0 | 0 |

These are registry-advisory results for this lockfile, not a claim that the
application has no exploitable bugs. Re-run them after dependency changes and
on the weekly schedule. The release receipt must bind the result to the actual
main SHA and deployment.

## September release follow-up

Main's production-labelled scan found 27 low-severity dependency nodes, all
from postcss-selector-parser. Updating that parser removed them. A separate
full-tree scan then exposed 4 moderate and 2 high nodes hidden by `--omit=dev`:
qs and brace-expansion plus their dependents. All are patched in the candidate.

| Package | Previous | Selected patch | Advisory |
|---|---|---|---|
| postcss-selector-parser, major 6 | 6.1.2 | 6.1.3 | [GHSA-w9m9-85wc-3x92](https://github.com/advisories/GHSA-w9m9-85wc-3x92) |
| postcss-selector-parser, major 7 | 7.1.1 | 7.1.3 | Same advisory |
| brace-expansion | 5.0.7 | 5.0.9 | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| qs | 6.15.3 | 6.16.0 | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) |

Scoped overrides retain both parser major versions and the existing uni-app
release. No forced DCloud downgrade or blanket `npm audit fix --force` was
used. The lockfile changes only these four package versions across five nodes.
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
