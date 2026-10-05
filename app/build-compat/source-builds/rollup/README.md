# Rollup source rebuild recipe

This recipe rebuilds official Rollup 4.60.2 with the reviewed braces source backport. It preserves the official source lock and does not edit generated bundles. The two underlying builds produced identical sets of 36 generated files; the official watcher suite also passed 41 tests.

Requirements: macOS arm64, Node 22.23.3, npm 11.21.0, Python 3 and `patch`. Keep `rebuild.sh`, `build-provenance.json`, `braces-security.patch` and `braces-source-manifest.json` together. Download the official source archive from `https://codeload.github.com/rollup/rollup/tar.gz/refs/tags/v4.60.2` into this directory as `rollup-v4.60.2-source.tar.gz`. The script requires SHA256 `5ae70a325f019a98e59cf73cc26c5d117212fd70921bb14a3e7f3684eca13203`; mismatches fail before extraction. The archive is a rebuild input and is not committed.

```sh
sh rebuild.sh /path/to/new-rollup-rebuild \
  /path/to/node-v22.23.3-darwin-arm64/bin/node \
  /path/to/npm-11.21.0/bin/npm-cli.js
```

The output directory must not exist. Installation needs npm registry access. It uses `npm ci --legacy-peer-deps --ignore-scripts` because the archived official lock has peer conflicts; the lock remains unchanged. The official patch-package step runs explicitly, followed by the reviewed six-file braces patch and the official `build:js:node` command. The script verifies the source hashes, lock hash and exact generated file set. `SOURCE_DATE_EPOCH` is fixed to the recorded upstream commit time. Archive builds lack `.git`, so generated banners say the commit is unknown; provenance records the verified upstream commit separately.

The bootstrap Rollup version comes from the official source lock (4.60.1); the resulting package version is 4.60.2. The recipe does not build Rust or package native binaries. Preserve the official 4.60.2 platform-optional dependencies when assembling the final app archive. Build-only dependency audit results are not claimed to match the app's clean audit.

Integrity checks use explicit failures rather than Python assertions, so `PYTHONOPTIMIZE` cannot disable them. The focused regression exercises matching and mismatching inputs with optimization off and on. The corrected wrapper was rerun end to end on October 5 in a fresh tree/cache with `PYTHONOPTIMIZE=1`: all 36 generated files matched and packaging reproduced the same complete archive. Build commands, source patches, dependency locks and vendor archive bytes were unchanged. The recipe assumes a trusted local toolchain and build environment; it does not sandbox arbitrary executables or configuration supplied by the caller.

The underlying commands were executed twice. On October 5, this exact committed wrapper also passed end to end in a new directory with a fresh dependency tree/cache: all 36 generated files matched provenance, and the committed packager reproduced the exact final archive from the new output. An initial runner configuration error supplied `/dev/null` as both npm user and global config and stopped before output creation; the unchanged recipe passed with distinct empty config files in a new directory. No previous dist or installed dependencies were reused. The wrapper stops after build verification; packaging and app validation remain separate steps in the parent maintenance contract.
