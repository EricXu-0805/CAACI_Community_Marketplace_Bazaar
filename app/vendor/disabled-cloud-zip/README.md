# Disabled encrypted-plugin archive operations

This package intentionally provides **no ZIP functionality**. It replaces the
transitive `adm-zip` dependency used exclusively by DCloud's encrypted
`uni_modules` upload/extraction path. This project has no encrypted plugins and
does not use that HBuilderX cloud compilation feature. H5 and mp-weixin are
verified independently after this replacement.

Reason: [GHSA-vwc7-r8mq-g2x9](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9)
affects the latest published adm-zip 0.6.0; on 2026-09-09 the registry had no
patched release. The vulnerable library is removed, not relabeled or ignored
by the audit. npm audit continues to run without an allowlist or lowered
threshold. Every attempted constructor call fails before any archive or
filesystem access.

Enabling encrypted uni_modules later requires replacing this package with a
reviewed archive implementation, testing symlink/path traversal defenses, and
verifying that compilation failures return a nonzero exit status.
