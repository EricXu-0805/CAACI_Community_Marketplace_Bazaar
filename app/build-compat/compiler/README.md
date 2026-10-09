# Compiler dependency adapter

The pinned Uni CLI aliases Vue's compiler to DCloud's bundled compiler. Its CJS
output embeds older selector parsers and a legacy source-map merger backend.
Registry overrides do not replace those embedded copies. The official Vue
3.4.21 and 3.5.42 compilers contain the same algorithms, so replacing DCloud's
compiler wholesale would both retain the issue and risk its custom behavior.

`bootstrap.cjs` registers a synchronous Node module load hook **before** Uni loads
its aliases or compiler. It requires Node **22.15 or newer within Node 22**; CI was
verified with 22.23.3. Every project Uni dev/build script uses `uni.cjs`. The first
import of `vite.config.ts` also installs the adapter, covering direct Vite config
loading and the Playwright preview server. A process-wide registration prevents
Vite's bundled copy of the config from installing the same hook twice.
That registration is bound to the canonical application root: another application
in the same process cannot silently reuse a hook for the wrong files. Both module
matching and early-load checks canonicalize symlinks, including Node's
`--preserve-symlinks` mode.

The hook handles only four canonical filenames listed in `provenance.json`:

- DCloud's normal and vapor compiler CJS bundles.
- The official root Vue compiler CJS bundle, used by direct Vite entry points.
- DCloud's alias initialization module.

It verifies the installed package identities and locked registry provenance,
fixed external dependency versions and resolutions, full input SHA-256 hashes,
replacement counts, and transformed output SHA-256 hashes. Unknown inputs or
modules loaded before the hook stop the build. Compilers execute lazily with
their original filenames, after DCloud establishes the appropriate aliases.

The compiler edits change only dependency bindings:

1. All scoped-style and CSS Modules parser clients use the installed
   `postcss-selector-parser@7.1.6`. Vapor has three separate lazy parser calls;
   all three are redirected.
2. The existing preprocessor map merger uses the installed
   `source-map-js@1.2.2` consumer/generator. Its merge algorithm is retained.
3. DCloud's normal alias map no longer globally redirects `@vue/shared` and its
   bundler entry. Node resolves each package's own compatible shared dependency.
   This allows the patched server renderer to use its fixed shared helper while
   DCloud's Vue 3.4 runtime keeps its original property-descriptor semantics.

All other DCloud compiler behavior, aliases, comments, and license notices stay
unchanged. The npm archives, registry integrity values, original compiler bytes,
and original version identities are recorded; **nothing writes to node_modules**.
The loaded source still contains unused old helper bodies, but the inspected
compiler entry points no longer call them. Browser ESM compiler distributions and
arbitrary manual Node invocations that omit the bootstrap are outside this
adapter. A clean npm audit alone does not establish the adapter's protection.

Run from the repository root after a clean app install:

```sh
node --test scripts/dependency-security-compat.test.mjs scripts/compiler-security-adapter.test.mjs
```

The latter uses real compiler exports after the actual Uni alias initialization,
traces calls into the external parser/map package, checks scoped/deep/slotted CSS,
both CSS Modules clients and composition exports, valid preprocessor maps, huge
and nested-offset rejection, long flat selectors, and fail-closed behavior.
Run complete H5 and MP builds plus application browser regressions whenever
changing a compiler, parser, source-map, alias, or adapter input.

The shared-alias fix does not migrate DCloud's compiler-core/compiler-dom family
to Vue 3.5. The application uses static H5 and MP builds. Uni runtime-template SSR
is not enabled or covered by this compatibility claim.

For a future upstream upgrade, review the new sources and all call sites first.
Prefer an upstream compiler that removes these embedded algorithms. Otherwise
update the reviewed replacement anchors and hashes deliberately, retaining the
registry package provenance and licenses, then repeat those behavioral checks.

Upstream sources and notices:

- DCloud Uni CLI: https://github.com/dcloudio/uni-app (Apache-2.0).
- Bundled Vue compiler: https://github.com/vuejs/core (MIT, notice retained in source).
- Selector parser: https://github.com/postcss/postcss-selector-parser (MIT).
- source-map-js: https://github.com/7rulnik/source-map-js (BSD-3-Clause).
- Embedded legacy source-map includes Mozilla's BSD notice; it is retained.
