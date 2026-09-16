# Indexed search — deployment completed

The reviewed search package has been deployed and post-deployment search checks passed. This document retains the implementation and isolated-test evidence. Detailed deployment receipts remain in private operational records. The existing CI deploys frontend code; it does not execute files under `supabase/_ops/`.

## Problem and behavior

Twelve-term fuzzy searches over 10,001 varied items could hit PostgreSQL statement timeouts under concurrent load. A flat title index supplies fully scored candidates; safe upper bounds and the unchanged date/ID tie-break prove whether unseen results can enter the page. If completeness cannot be proven, the query uses the full scorer. It keeps descriptions, translations, filters, native rank/threshold behavior and caller row-level visibility.

Short descriptions need separate treatment: exact folded matches seed the page, while trigram-union bounds retain potentially better description results. Recent title matches use the existing feed cursor index; insufficient recent matches fall back to the full contains scan. `force_custom_plan` is scoped to the search function because reused generic plans made the twelve-term workload about four times slower in the measured case. The caller's plan setting is restored after the function returns.

## Reviewed SQL

The files in [indexed_search_candidate](../../supabase/_ops/indexed_search_candidate/) preserve the reviewed manual release package. Their candidate comments and original bytes remain unchanged for checksum verification:

- `fields.sql`: maintained flat search fields and their indexes. It follows the cached-field migration and is not a standalone production install.
- `query.sql`: invoker search scorer and v2 RPC. It also requires the cached and indexed fields.
- `INSTALL.sql`: complete reviewed transaction for a production database that does not yet have `search_private`/`intarray`.
- `ROLLBACK.sql`: complete reviewed rollback after a successful install.
- `manifest.sha256`: exact reviewed SQL bytes.

The earlier production approval hold has been resolved. Installation and post-deployment checks covered cache consistency, result parity, access restrictions and the browser search/filter/recovery journey. Do not reapply this installer or its component fragments to an already-upgraded database; consult the private deployment record before later database work.

The installer refuses an unexpected existing schema/extension or more than 100 items. The item-count guard is repeated after acquiring the write lock to cover concurrent publications. Install and rollback wait at most 2 seconds for locks and set a 15-second statement timeout. The transaction briefly blocks item writes during backfill; an error aborts the transaction. Read traffic remains available. These are per-operation bounds, not a promised total release duration.

Hosted Supabase can ignore extension `VERSION` clauses. The installer uses the default installation and verifies the actual intarray version inside the same transaction, before cache definitions/backfill. An untested actual version aborts and rolls back. [Supabase change notice](https://supabase.com/changelog/extension-version-pinning-ignored).

Source package revision 3 tightens the inherited rollback timeout from 120 seconds to 15 seconds and repeats the size guard under the write lock. Search logic remains unchanged from the successful hosted rehearsals; only trailing blank lines were removed from `query.sql`.

## Evidence

[Recorded results](2026-09-16-indexed-search-evidence.json) retain the read-only and mixed-workload receipts, source hashes and cleanup boundary. These are synthetic staging measurements, not a peak-user or production SLA.

| Workload | Correct load requests | Twelve-term p95 at 10 concurrent reads |
|---|---:|---:|
| Unique long descriptions | 262/262 | 1315ms |
| 2000 short descriptions | 268/268 | 1190ms |
| 2000 older exact short descriptions + 2000 unrelated short descriptions | 227/227 | 1872ms |

The mixed run used the last distribution, three real synthetic Auth sessions and ten anonymous/member read loops: 240/240 reads and 6/6 chat writes succeeded; twelve-term p95 was 1734ms. Both actual image uploads/publications succeeded (one during read load), six messages arrived through Realtime and polling, outsider reads/overwrites were denied, four target notifications were correct, private image bytes matched and the original public URL was inaccessible. The worker completed with zero backlog.

Database/Auth/Storage/Realtime were hosted services. Background and polling handlers loaded the current source locally against staging; Vercel cold starts and production cross-region behavior were not measured. Images were one-pixel fixtures, not HEIC/system-photo-picker tests. Historical SQL fixtures suppressed triggers only within their seed transaction; the two HTTP publications ran normal user permissions and triggers.

Cleanup restored staging to two items, six profiles and six Auth users; all test accounts/sessions/items/messages/notifications/media records and objects were absent, temporary search objects removed, queue backlog zero, and the original RPC definition hash unchanged. Temporary credentials were removed.

## Repeatable code verification

From `app/`, run:

```sh
node --test --test-concurrency=1 ../scripts/indexed-listing-search.test.mjs ../scripts/indexed-search-release.test.mjs
```

PostgreSQL 17 is required (CI already installs it). The first test file compares complete native results across libc/ICU, three identities, nine thresholds, Unicode/wildcards, filters, pagination, live edits/translations, suspensions, concurrent writers and rollback/reinstall. The second exercises the exact manual installer, rejects oversized targets and an unverified extension version, verifies effective timeout settings and live edits/deletes, dumps/restores into a second local database, checks restored privileges/results and subsequent update maintenance, then rolls back.

The source tests passed locally with no skips: both locale regressions plus eight exact-install/restore/rollback scenarios. All four SQL checksums matched.

The logical restore uses a shared local cluster role bootstrap. It does not replace a full production database/Auth/Storage restore or establish hosted recovery time.

## Remaining release conditions

Production search activation and its smoke acceptance are complete. Real device input/photo/background behavior, WeChat real-account/configuration/review, complete production restore, native signing/store review, and the new Google authorization-email check remain separate unclosed gates. The synthetic staging capacity results above remain separate from production activation.
