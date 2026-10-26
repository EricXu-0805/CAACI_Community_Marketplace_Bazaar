# Build dependency security update — 2026-10-26

The main-branch release check failed after all 1,988 boundary tests passed because the full npm audit found newly published advisories. Dependency-unchanged pull requests do not run that audit; the push-to-main check correctly blocked release.

The fix updates body-parser 1.20.6 → 1.20.9, follow-redirects 1.16.0 → 1.16.1 and the locally maintained Vite 6.4.3 archive → Vite 6.4.4. The app lock changes only those three records and the root record. Application source, DCloud versions, Rollup, native optional packages and all CI gates remain unchanged.

Vite is rebuilt from the official `v6.4.4` tag, commit `5f0d9a4aaa31124695e7cf6ffe349e9d0a4b705e`. The existing braces source patch (`8889beb3edfb82a8a0c9b6354f0b4e6d15212ab79e03cbb399946d116b7f1a3a`) applies unchanged. Two independent fresh installations using Node 22.23.3 and pnpm 10.8.1 produced byte-identical sets of all 15 dist files. The packager reproduced the content-addressed archive `vite-6.4.4-local.8dafccdc5cd1a5ac.tgz`; its full SHA-256 is `8dafccdc5cd1a5acc7fa73250d38f9c2b21de7437c5c85c487262679a598f311`. Official non-dist files, metadata and licenses are preserved. The version stays 6.4.4 so dependency auditing retains its normal meaning.

Validation completed locally so far:

- Clean npm 10 and npm 11 installations; all installed package bytes match the reviewed manifest. npm 11 uses the repository's existing `install-links=true` setting.
- Full npm 11 audit: zero vulnerabilities, including build dependencies.
- 179 private Vite bundle / real watcher checks pass, with no timeout or modified package file; ordinary output matches the prior patched Vite bundle.
- 40 focused source, compiler and dependency compatibility tests pass.
- Complete boundary suite: 1,988 pass, zero fail, one existing skip because a Vercel Build Output inventory is absent locally.
- Type-check, H5 and Weixin builds, and matching artifact-boundary verification pass. H5 is a nondeployable local artifact with synthetic configuration; Weixin is also a synthetic test build.
- All 52 compiled browser acceptance tests pass across Chromium and WebKit device profiles. These are controlled emulation, separate from physical-device verification. Remote CI and production release are tracked separately.

Official advisory sources: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [follow-redirects array headers](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8), [follow-redirects custom headers](https://github.com/advisories/GHSA-8r9p-f939-6h3c), [Vite middleware](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), and [Vite file access](https://github.com/advisories/GHSA-rq7h-c2jc-7f22).

This change is not a production deployment or a claim of physical iPhone/iPad acceptance. Release still requires the exact merged main commit's complete seven-check gate and the supervised handoff.

The repaired dependency PR twice reached the H5 browser installation step, then exhausted the existing 45-minute job limit while downloading signed Ubuntu packages from the runner's Azure mirror. Neither attempt started compiled browser tests. A single H5-only preparatory step now changes exact Azure Ubuntu URI entries in `/etc/apt/apt-mirrors.txt` to the official Ubuntu archive. It preserves protocol, trailing slash, priority metadata, suites, components and signing configuration; a missing file or nonmatching URI is unchanged. Node, browser versions, installation/test commands, checks and timeout are unchanged. Seven fixture cases cover replacement, whitespace, trailing slash, EOF and no-op boundaries. This addresses the observed download path; only a completed install and the existing compiled acceptance can establish the CI result.
