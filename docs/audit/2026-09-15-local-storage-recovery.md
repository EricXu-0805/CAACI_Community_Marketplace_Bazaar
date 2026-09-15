# Local Storage recovery regression — 2026-09-15

The local recovery rehearsal found that matching object-file byte hashes did
not establish a working Storage restore. BusyBox `cp -a` in the tested image
omitted Linux extended attributes. The Storage file backend subsequently failed
to read the content-type/cache-control metadata and returned HTTP 500 with
`ENODATA` for otherwise intact images.

`scripts/copy-storage-file-backend.mjs` now copies and verifies object bytes and
extended attributes using the pinned Storage image's own `fs-xattr` module.
It requires a quiesced, read-only source and an empty, separate destination;
it refuses overwrite, symlinks, special files and missing required metadata.
The operational sequence and failure handling are in
[the recovery runbook](../../RUNBOOK.md#local-storage-file-backend-snapshots).

## Evidence

The test used three synthetic accounts and real local GoTrue, PostgREST and
Storage HTTP services, with Postgres 17.6. It ran inside an isolated internal
Docker network, without sending email or using production business data.
This was a file-backend test, not a managed Storage/S3 restore.

- The initial database restore matched content hashes for 84 tables and
  matched schema, RLS, grants, constraints and functions. The 177 total rows
  included service migration metadata; they were not 177 business records.
- The first service test exposed the missing-image-metadata failure. That
  failure was retained, then the target was recreated from the same synthetic
  database archive and the image volume was copied using the fixed helper.
- After correction, 16 service checks passed: a pre-snapshot session refresh;
  three password logins; both participants' message history; outsider message
  and listing-write denial; preserved listing and anonymous search; public and
  private image hash checks; two quarantine-access denials; cross-owner upload
  denial; and a new owner upload followed by a successful byte check.
- The cross-owner upload returned a generic HTTP 500. It was counted as denied
  only after the exact request log identified the owner-path guard, the
  database function confirmed that guard's `22023` error, and the attempted
  object was absent. A 500 by itself is not a passing authorization check.
- Both 69-byte image objects retained their byte and attribute hashes. The
  final helper was also tested against a fresh ephemeral destination and
  refused an existing nonempty destination before writing.

The fixture size does not establish large-object throughput, concurrency,
recovery time objectives, hosted backup recovery, production data completeness,
OAuth/email configuration, Realtime delivery, or device/browser acceptance.
Record those separately. The helper is not an incremental backup tool and does
not roll back a partial copy.

The four owned containers, two named object volumes and isolated network were
removed after verification. Temporary schema, synthetic archive, local secrets
and private diagnostics were removed; the unrelated pre-existing service was
preserved. Detailed non-sensitive receipts remain in the ignored local
`output/playwright/zero-cost-followup-20260915/` directory.
