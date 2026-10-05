# Exact Vite source rebuild recipe

This recipe rebuilds the locally reviewed braces source patch inside official Vite 6.4.3. It does not represent an official upstream patched release. Keep these five files together:

- `rebuild-vite.py`
- `manifest.json`
- `vite-source-change.patch`
- `braces-source.patch`
- this README

Requirements: Python 3.9 or newer, the system `patch` utility, and the verified Node **22.23.3 / macOS arm64** runtime. Other runtimes and platforms are rejected because the recorded output hashes were verified on this platform. No build package manager is installed globally.

Supply the two official archives listed in `manifest.json`:

- Vite source commit `6c2c881f15495738ff03bc1d67cc052c07e0cac4` archive.
- Official npm `pnpm-10.8.1.tgz` archive.

The script does not download these archives. It validates their SHA256 values, and the pnpm archive's npm SHA512 integrity, before creating the output directory. Archived inputs can be reused. Subsequent frozen dependency installation uses `https://registry.npmjs.org` and needs network access.

```sh
python3 rebuild-vite.py \
  --vite-archive /path/to/vite-source.tgz \
  --pnpm-archive /path/to/pnpm-10.8.1.tgz \
  --node /path/to/node-v22.23.3-darwin-arm64/bin/node \
  --output "$PWD/new-vite-rebuild"
```

`--output` must not exist, including as a symlink; its parent must exist. Failed runs remain intact for inspection. The script never deletes an existing directory. Official build scripts may clean their own `dist` directory inside the newly created source tree.

The source patch registers the dependency patch, updates the frozen source lock, and introduces `patches/braces@3.0.3.patch`. The separately included `braces-source.patch` must match that introduced file byte for byte. **Do not also apply it directly to generated bundles.** pnpm applies it to the original dependency sources during installation.

Installation uses the verified pnpm version, frozen lock, `--ignore-scripts`, `--ignore-pnpmfile`, a task-local empty npm user configuration, and task-local store/cache/state directories. It preserves the official dependency versions and verifies the patched input files and six loaded braces source modules before running the official `pnpm --filter vite run build` command.

Success requires the exact complete set of **15** `dist` files in `manifest.json`, including their byte lengths and SHA256 hashes. Logs are in the new output's `logs/`; the final comparison is `verification.json`. This recipe stops after source build verification. It does not pack, publish, modify the application, or change a database.

The underlying source build was already executed twice successfully with identical output bytes. **This packaged script was syntax-checked and its inputs/manifests were statically verified; it was not executed end to end again.** Its execution remains a separate verification step if the packaging mechanism changes or a later rebuild is needed.
