# Bounded DCloud build compatibility

The [compiler security adapter](compiler/README.md) separately redirects the
pinned compilers' embedded selector/map operations to reviewed official fixes.
It also removes DCloud's two global `@vue/shared` aliases so the repaired server
renderer and existing page runtime each keep their matching shared dependency.
The project's Uni npm scripts and Vite configuration load this hash-checked adapter; Node
22.15 or newer within Node 22 is required. This does not upgrade the page runtime
or enable DCloud SSR.

This implementation removes the independent `braces` dependency chain used by the pinned DCloud H5/Weixin build tools. Separately, [source-built Vite/Rollup packages](source-builds/README.md) apply a bounded, reviewed backport to their three private copies. These are locally maintained builds, not new upstream security releases. Production configuration and the database are unchanged.

Two first-party packages adapt the observed consumers without copying or renaming the vulnerable implementation:

- [`glob`](glob/README.md) replaces the callable async and sync operations used by four DCloud packages and unimport. It uses official fdir, glob-parent, picomatch, and bounded fill-range enumeration.
- [`watch`](watch/README.md) implements the DCloud FileWatcher/easycom contract over the unmodified official Chokidar 4 runtime. It watches directories and filters real events instead of relying on Chokidar 3 brace expansion.

The adapters deliberately accept bounded pattern subsets. Unsupported syntax fails explicitly; it is not counted as compatibility success. The individual contracts document those limits. Upgrading DCloud, unimport, or their call sites requires reviewing those contracts again.

## Installation and audit visibility

The root app manifest uses version-scoped **local-file** replacements for `fast-glob@3.3.3` and `chokidar@3.6.0`. This wiring installs the actual new implementations; it does not make upstream major versions API-compatible. Sass retains its existing Chokidar 4 dependency.

`app/.npmrc` sets `install-links=true`. npm therefore installs ordinary package directories with their true `@illini-market/*` manifest names. Both the adapters and their official runtime dependencies enter npm's audit payload. Local directory links would be skipped by npm audit and are not acceptable here.

Run a clean install after changing either local package:

```sh
cd app
npm ci --legacy-peer-deps
node --test ../scripts/build-compat.test.mjs ../scripts/disabled-cloud-zip.test.mjs
```

The repository's normal boundary suite includes these tests. They check installed identities, all five glob consumers, the runtime version, byte equality between reviewed and installed entry points, and absence of independent braces/micromatch/old fast-glob/Chokidar 3 nodes. Source bytes are committed because local directory lock entries do not contain a tarball integrity hash.

`install-links=true` also packs the existing controlled ZIP denial package. Its guard now verifies the installed identity and bytes plus the original fail-before-filesystem behavior, rather than requiring a symlink. Existing legacy peer-version conflicts are unchanged and must not be described as a clean `npm ls --all` result.

## Lock maintenance

The initial npm 10 refresh incorrectly reused old registry nodes for new `file:` overrides; a targeted update also resolved relative paths against a consumer directory. The successful refresh used an isolated metadata-only directory, preserved the rest of the existing lock, and let npm resolve only these seven missing entries:

```text
node_modules/fast-glob
node_modules/chokidar
node_modules/unimport
node_modules/@dcloudio/uni-cli-shared
node_modules/@dcloudio/uni-app-uts
node_modules/@dcloudio/uni-cloud
node_modules/@dcloudio/vite-plugin-uni
```

After regeneration, the two original `picomatch@4.0.4` lock records under `uni-cli-shared` and `vite-plugin-uni` were restored and npm normalized the lock again. They remain necessary for the unchanged nested auto-import consumers. No unrelated dependency version was upgraded. Both npm 10 and npm 11 consumed the final lock in clean installs. This procedure is a resolution workaround, not proof of compatibility: clean installation, graph inspection, source-byte checks, the strict full audit, and actual build/behavior tests remain mandatory.

## Release boundary

The isolated implementation has real filesystem comparisons and dynamic watcher tests. Unsupported baseline patterns remain listed separately. H5/Weixin builds and compiled-H5 browser acceptance are separate integration checks; an audit reporting zero does not certify custom code or inspect bundled private parsers.

The October 5 integrated candidate passed the complete boundary suite (1,677 passed, one existing optional artifact-inventory skip), including real isolated PostgreSQL tests; type-check; both builds; artifact scans; 32 compiled-browser checks; and the strict full dependency audit (zero findings). Independent verification also exercised all three rebuilt private modules and real native watcher/config-reload behavior. This dated local evidence does not replace CI on the pushed commit, production configuration checks, or the owner's real Admin, email and WeChat-device acceptance. No production migration, merge or deployment is authorized by these results.
