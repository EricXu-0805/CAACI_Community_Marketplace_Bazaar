# Third-party software notices

This application is built from the dependency graph locked in
`app/package-lock.json`. The lockfile and each installed package remain the
authoritative version and license inventory; this file records the exceptional
items that need an explicit release decision instead of silently treating an
`npm audit` result as a license review.

## HEIC conversion

The H5 image pipeline dynamically loads `heic-to` 1.4.2 when a browser cannot
decode an HEIC/HEIF image natively.

- Project: <https://github.com/hoppergee/heic-to>
- Declared license: GNU Lesser General Public License v3.0 (`LGPL-3.0`)
- Upstream license text: <https://github.com/hoppergee/heic-to/blob/v1.4.2/LICENSE>
- Upstream source for the locked release:
  <https://github.com/hoppergee/heic-to/tree/v1.4.2>

The package is currently unmodified and emitted as an on-demand H5 chunk. A
link and notice alone are not a legal conclusion about the obligations for a
particular distribution. Before a public production distribution, the release
owner must choose and document one of these paths:

1. confirm with qualified counsel that the planned delivery, source offer,
   relinking/replacement mechanism, license copies, and installation
   information satisfy the LGPL/GPL terms; or
2. replace/remove the decoder and re-run HEIC behavior, bundle-size, H5,
   mini-program, browser, and real-device tests.

Until that decision is recorded, dependency security gates may pass but the
software-license gate remains open.

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
