# Recovery rehearsal: database, Auth and Storage

Database export alone is not a complete marketplace backup. Preserve the managed
Auth/Storage rows and service migration history explicitly; the CLI's default
application-schema dump omits these. File bytes need a separate private manifest
bound to object ID, original version, size and hash. Keep backup credentials and
production data out of Git and public reports.

## Compatibility finding

The September 19 isolated rehearsal restored the production schema without
replacing its indexes or weakening its policies. Older Storage API images could
read restored files but failed new uploads with PostgreSQL `42P10`: their upsert
conflict target did not match the versioned object indexes in the backup.

Official Storage API `v1.79.4` supports that index layout. Pin the tested image
digest `sha256:6c1ad2d0cdd7be95d780a0e4083c1445af0d13ab30df0e25cc456c7dfe831998`
when reproducing this rehearsal. Never add an artificial global unique index to
the restored schema just to make an older service appear healthy.

Source: [official Storage v1.79.4](https://github.com/supabase/storage/releases/tag/v1.79.4)
and [version-aware upsert implementation](https://github.com/supabase/storage/blob/v1.79.4/src/storage/database/pg.ts).

## Acceptance sequence

1. Create a separate local database and internal container network, without
   published ports, external SMTP or active restored scheduled jobs.
2. Restore the complete schema, rows and managed-service migration metadata.
   Existing NOT VALID historical constraints must retain that status; restoring
   them as validated constraints can reject historical source rows. Record any
   narrowly scoped load-time handling and restore the original definitions.
3. Restore original object versions into the supported file backend. Compare
   every available file byte-for-byte through the actual Storage HTTP service.
   Record missing source files explicitly, including whether live content still
   references them. Do not delete source records as a side effect of a rehearsal.
4. Start compatible Auth, PostgREST and Storage services. Verify restored counts,
   disposable account creation/sign-in, a new upload/download/delete, and private
   attachment access for sender, recipient, anonymous and unrelated identities.
5. Record the backup acquisition window, complete rehearsal elapsed time,
   unavailable files, and independent gates: real owner OAuth, video fixtures,
   offsite retention, and production cutover. SQL load time is not an RTO.
6. Remove only the rehearsal's labelled containers, volumes and disposable
   credentials. Preserve an access-restricted evidence manifest and the backup
   according to its retention policy.

This rehearsal passed available-file integrity, new file writes, restored Auth
reads, synthetic password login and private-image access checks. Source bytes
were missing for three unreferenced historical object rows. No actual owner OAuth
login, production cutover or production video restoration was performed. These
limits remain open; the result is not a claim of full disaster-recovery readiness.
