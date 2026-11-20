# Vite 6.4.6 source rebuild

This separate recipe upgrades the local Vite archive to published upstream
6.4.6. The historical `../vite/` recipe and its 6.4.4 inputs remain intact.
The runtime is the tony-ws test container's **Node 22.23.5 / linux-x64**.
Python 3.9 or newer and Git are also required. No package manager is installed
globally, and generated bundles are never patched.

`manifest.json` pins upstream tag `v6.4.6`, commit
`129b54cb423c69048f6a9b5d5766033c0173ef77`, source archive SHA256,
pnpm 10.8.1 archive SHA256 and npm integrity, both source patches, patched root
metadata and frozen lock, six reviewed braces source modules, complete generated
dist inventory, and the official npm release envelope.

The braces 3.0.3 patch was regenerated from its official npm archive against
`../../braces-source/`, checking every original and reviewed file hash against
`../source-manifest.json`. Its bytes still equal the reviewed depth backport.
The enclosing Vite patch was regenerated against 6.4.6 and changes only the
braces patch registration and lock references. It does not refresh dependency
versions or deprecation metadata. This backport retains the hard depth bound;
it does not claim a new upstream braces security release.

Download the three official archives named in the manifest, then run the
following from the repository root inside the test container. `$INPUTS` and
`$OUTPUTS` must be accessible in the container; both build output directories
must be absent. Serialize container use with the workstation's container lock.

```sh
RECIPE=app/build-compat/source-builds/vite-6.4.6
python3 "$RECIPE/rebuild-vite.py" \
  --vite-archive "$INPUTS/vite-source.tgz" \
  --pnpm-archive "$INPUTS/pnpm.tgz" \
  --node "$(command -v node)" --output "$OUTPUTS/build-1"
python3 "$RECIPE/rebuild-vite.py" \
  --vite-archive "$INPUTS/vite-source.tgz" \
  --pnpm-archive "$INPUTS/pnpm.tgz" \
  --node "$(command -v node)" --output "$OUTPUTS/build-2"
python3 "$RECIPE/package-vite.py" \
  --official-archive "$INPUTS/vite-official.tgz" \
  --build-one "$OUTPUTS/build-1" --build-two "$OUTPUTS/build-2" \
  --output "$OUTPUTS/packages"
cmp "$OUTPUTS"/packages/build-1/*.tgz "$OUTPUTS"/packages/build-2/*.tgz
```

Each source build creates a separate source tree, pnpm installation, empty npm
configuration, dependency store, cache, state and data directories. Git applies
the source patch before pnpm performs a frozen install with scripts and
pnpmfile hooks disabled. The recipe checks patched inputs before and after
installation and checks the actual six braces modules resolved through Vite's
private Chokidar dependency before executing the official build. Logs and
`verification.json` stay in each build directory.

For commissioning a future reviewed inventory, `--record-inventory` explicitly
records unapproved output instead of accepting it. Review that inventory and
compare a second independent clean build before sealing `expected_dist` and
`verified_rebuilds`. This option does not bypass input, runtime or source checks.
Ordinary reproductions must omit it. The packager always requires both complete
inventories to equal the sealed manifest and each other.

`package-vite.py` uses the unchanged deterministic tar/gzip helpers in
`../package-build.py`. It retains all official non-dist bytes, metadata and
licenses; replaces the entire dist tree; and adds provenance and a patch notice.
It independently packages both build outputs, compares the complete archives,
and emits `artifact.json` for review before updating the vendor manifest.
Provenance records the Node platform and Python/zlib packaging runtime. Neither
the provenance nor the patch notice contains the final archive's own hash.
The original `../package-build.py` remains the exact reconstruction verifier for
the committed vendor manifest.

2026-11-20: This recipe targets 6.4.6, the newest published 6.4.x patch when its
inputs were resolved. The application keeps the upstream version visible to
audit. Local logs and size measurements remain outside the public repository;
the supervisor independently re-verifies the draft PR before approval.
Two clean container builds produced identical complete inventories and archives:
37 package files, including 15 dist files, in a 633,464-byte archive with SHA256
`55927b45dd34273c55cdbb093a4ce00c85795104733cd74a2da436239b1b36c6`.
Packaging used Python 3.12.3 and zlib 1.3. The first build recorded the initial
inventory; the second enforced it. Both inventories and all their bytes were
checked again against the sealed manifest by the packager before archive
comparison.
