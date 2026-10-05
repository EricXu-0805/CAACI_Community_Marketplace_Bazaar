# Source-built toolchain maintenance

These inputs maintain a narrowly scoped backport for the private braces 3.0.3 implementations bundled into Vite 6.4.3 and Rollup 4.60.2. They are locally maintained builds, **not new upstream security releases**. Package names and upstream versions remain visible to dependency auditing. The independent DCloud compatibility packages are documented separately in the parent directory.

`../braces-source/` is the reviewed build input. Its original npm metadata, public entry point, README and MIT license are retained. The six modified library files add a maximum depth of 100, cycle termination on traversed parent chains, bounded recursive array handling, and a single read of each operation's `maxDepth` option. Normal parsing/escaping behavior comes from the released 3.0.3 source, without the unreleased parser changes in upstream PR 72. `01-pr72-security-only.patch` and `02-array-depth.patch` reconstruct these inputs from the integrity-pinned official source identified by `source-manifest.json`.

These bounds address the reviewed recursion defect and associated direct-AST traversal cases. They intentionally reject deeper/cyclic inputs; they do not bound every possible expansion product or execute arbitrary user-defined getters/coercion methods safely. Current project glob/watch use is covered separately by the DCloud adapters and the actual private-watcher verification.

Build only from the exact official source tags and locks recorded in the accompanying provenance. Apply the braces patch to source dependency inputs before running the official build commands. Preserve the upstream package's existing non-dist runtime files, metadata, optional native dependencies and licenses; replace the generated dist directory as a complete unit. Never overlay a new chunk on an old package or edit generated application output to manufacture a passing check. Content-addressed tarballs and lock integrity must be regenerated together so a warm npm cache cannot install old bytes.

Any source, toolchain version, compiler/lock, tarball or installed-byte change requires renewed source review, official source rebuild, private-bundle verification, ordinary watcher regression, clean install, strict full npm audit, type-check, H5/Weixin builds, artifact checks, compiled browser acceptance and the complete boundary suite. The portable source checks are in `scripts/bundled-braces-source.test.mjs`; their execution alone is not a complete release gate.

## Rebuild and package inputs

- [Vite recipe](vite/README.md): official commit `6c2c881f15495738ff03bc1d67cc052c07e0cac4`, pnpm 10.8.1, official build command; 15 generated files reproduced byte for byte in two builds.
- [Rollup recipe](rollup/README.md): official commit `a6be82b8abd747458afdc7484319f7b5deb92535`, unchanged official source lock, official JavaScript build command; 36 generated files reproduced byte for byte in two builds. No native binary is rebuilt or substituted.
- [Final archive manifest](../../vendor/source-builds/manifest.json): exact SHA256, npm SHA512 integrity, package identity, complete file sets and per-file hashes for both installed archives. Each package retains official non-dist files and adds a patch notice and provenance record. Recipe output is an input to this packaging step; the recipes do not publish or change app dependencies.

The final archive names include their content hashes. To replace a package, assemble a clean copy of its official npm archive, replace the complete `dist` tree with verified recipe output, retain official metadata/licenses, and regenerate the local patch notice/provenance, archive manifest, content-addressed name and app lock together. Verify complete package contents in fresh npm 10 and npm 11 installs before running the gates above. Never reuse an archive filename for changed bytes.

`package-build.py` reproduces an already reviewed archive using Python 3.9 or newer. Supply the official npm archive from the manifest's `provenance.officialReleaseEnvelope.tarball` URL and the complete recipe-generated `dist` directory. From this directory:

```sh
python3 package-build.py --manifest ../../vendor/source-builds/manifest.json \
  --package vite --official-archive /path/to/official-vite-6.4.3.tgz \
  --dist /path/to/vite/source/packages/vite/dist --output /path/to/repacked
python3 package-build.py --manifest ../../vendor/source-builds/manifest.json \
  --package rollup --official-archive /path/to/official-rollup-4.60.2.tgz \
  --dist /path/to/rollup/rollup-4.60.2/dist --output /path/to/repacked
```

The script downloads and executes nothing. It verifies the official archive, all generated files, unchanged official metadata/licenses, existing provenance/notice, and the complete final archive against the reviewed manifest before writing. It rejects different bytes at an existing output path; an identical archive is left intact. This is an exact reconstruction step, not a way to approve changed inputs or generate a new review manifest. Both current archives were reproduced byte for byte with Python 3.11.5 on macOS arm64; a different compression implementation may fail the final digest check. No app manifest, lock, or committed archive is changed by the script.

The October 5 packages keep Vite 6.4.3 and Rollup 4.60.2 identities visible. All 25 Rollup platform-optional lock records remain on official 4.60.2. The only app lock records changed by this packaging step are the root, Vite and Rollup entries; the separate adapter change is documented in the parent README.

The packaged recipes were syntax/input checked; the underlying source build commands were run twice, but the packaged wrappers were not re-executed end to end. Reproducibility hashes are tied to the recorded toolchain and macOS arm64 environment. CI uses the committed archives, not a network source rebuild. Future official fixed releases should replace this maintenance obligation after equivalent verification.
