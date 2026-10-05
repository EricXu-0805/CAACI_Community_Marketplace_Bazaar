# Bounded DCloud build compatibility

This candidate removes the independent `braces` dependency chain used by the pinned DCloud H5/Weixin build tools. It does **not** remove the separately embedded copies in Vite/Rollup, and is not yet release-ready. The application, production configuration, and database are unchanged.

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

Vite 6.4.3 and Rollup 4.60.2 still contain three unchanged private braces copies. Full elimination needs corrected upstream bundles or a separately reviewed commitment to maintain bundle patches. Also, the full PostgreSQL regression gate must pass in a host with available shared-memory slots. Neither remaining issue is waived by the adapter tests. This candidate must not be merged or deployed while those release conditions remain unresolved.
