# npm audit triage

Refreshed 2026-10-05 UTC using Node 22.23.3 and npm 11.21.0. The status below
is dated 2026-11-20; the 2026-10-05 snapshot after it is historical.

## Status 2026-11-20

- The app installs a locally rebuilt vite 6.4.4
  (`app/vendor/source-builds/vite-6.4.4-local.8dafccdc5cd1a5ac.tgz`, through
  `file:` in `app/package.json`). It is official 6.4.4 source with the bounded
  braces 3.0.3 backport described below; see the
  [maintenance contract](../app/build-compat/source-builds/README.md).
- npm audit reports GHSA-8g5g-mxqh-grgj (vite `server.fs.deny` bypass,
  moderate) against it. CI lets that one advisory through until 2026-12-13
  (UTC), only on the `vite` package and only at moderate or below; after that
  date it fails again with a warning. Every other moderate-or-worse advisory
  still fails the audit step, and so does a failed audit that reports nothing
  this rule lets through.
- Upstream fixed the advisory in vite 6.4.5. The way out (route B) is to redo
  the braces 3.0.3 backport on vite 6.4.5 or 6.4.6 and rebuild the local
  archive. Installing 6.4.5 straight from the registry would turn the audit
  green but silently drop the braces backport that limits recursion depth.
  GHSA-vfj7-8cjw-p6xm, which route B used to cite, was withdrawn by GitHub on
  2026-10-23, so the value of the braces backport is limiting recursion depth
  itself.
- The 2026-10-05 snapshot below predates vite 6.4.4 and this advisory.

## Historical 2026-10-05 snapshot

| Audit view | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| Complete dependency tree, 2026-10-05 | 0 | 0 | 0 | 0 | 0 |

The independent braces chain was replaced by bounded first-party glob/watch
adapters with their real package identities exposed to npm audit. Vite 6.4.3
and Rollup 4.60.2 now use integrity-pinned local archives rebuilt from official
source with a bounded braces backport. Their upstream package names, versions,
licenses and native optional dependencies are retained. These are locally
maintained builds, not official upstream patched releases. No advisory is
excluded and the moderate-severity threshold is unchanged.

The registry still lists braces 3.0.3 and no official patched release for
GHSA-vfj7-8cjw-p6xm. Audit does not inspect private bundled source: all three
embedded copies therefore have separate source, generated-byte, ordinary
compatibility and actual watcher validation. See the
[maintenance contract](../app/build-compat/source-builds/README.md) and
[archive manifests](../app/vendor/source-builds/manifest.json).

The integrated local gates passed: 1,677 boundary tests, zero failures and one
existing optional artifact-inventory skip; type-check; H5/Weixin builds and
artifact scans; and 32 compiled-browser checks. Five existing peer-version
conflicts remain, so `npm ls --all` is not clean. A zero audit is dated registry
evidence, not a claim that every possible denial of service or application
vulnerability is fixed. Repeat the gates after dependency changes and bind
release evidence to the actual commit and deployment.

## Historical October 3 candidate

The following findings describe the earlier lock and unmodified embedded
copies. They are preserved as history, superseded by the October 5 candidate.

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
advisory exclusion was included in that October 3 candidate.

At 17:49 UTC on October 3, upstream PR #72 had advanced to
`28d440b5dd449dbf1fe6f3506cf94ecca4d02660`, still unmerged and unreleased.
Independent bounded comparisons confirm its new parent-cycle rejection and
restore the five previously failing `escapeInvalid` samples. A deliberately
malformed direct AST with a self-referencing value array still overflows the
expansion stack; this is not evidence of a normal string-glob exploit path.
The complete unpublished branch also changes parser output relative to 3.0.3.
These findings supersede the earlier candidate-specific failures; they do not
change the advisory or justify adopting an unpublished fork.

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
