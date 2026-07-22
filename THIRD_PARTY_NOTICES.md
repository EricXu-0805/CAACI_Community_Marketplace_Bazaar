# Third-party software notices

This application is built from the dependency graph locked in
`app/package-lock.json`. The lockfile and each installed package remain the
authoritative version and license inventory; this file records the exceptional
items that need an explicit release decision instead of silently treating an
`npm audit` result as a license review.

## Current copyleft boundary

The current release-candidate production-dependency graph contains no package
declaring a copyleft or source-available license. The former H5 fallback decoder was removed on
2026-07-19; HEIC now uses only browser-native decoding and fails closed with an
explicit unsupported-format message where native decoding is unavailable.

The deterministic license boundary test rejects any newly introduced
AGPL/GPL/LGPL/SSPL/BUSL/MPL/EPL/CDDL package until it receives an explicit
review. This is dependency-inventory and change-control evidence, not a legal
conclusion about any future distribution.

## Packages without a package.json `license` field

The current lock contains three older transitive packages whose metadata omits
the SPDX field. Their distributed license evidence was checked separately:

| Package | Locked version | License evidence |
|---|---:|---|
| `dom-walk` | 0.1.2 | README declares MIT |
| `exif-parser` | 0.1.12 | bundled `LICENSE.md` contains the MIT License |
| `qrcode-terminal` | 0.12.0 | bundled `LICENSE` contains Apache License 2.0 |

The deterministic license boundary test fails if a new metadata gap or a new
copyleft/source-available license enters the lock without an explicit review.
