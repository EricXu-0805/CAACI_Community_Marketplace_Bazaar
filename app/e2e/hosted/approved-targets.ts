/**
 * Source-controlled allowlist for the write-capable hosted Realtime canary.
 *
 * This list is intentionally empty until Eric approves a dedicated,
 * synthetic-only staging Supabase project and its server-owned dataset
 * lineage. Operator-provided environment variables cannot add a target.
 *
 * Adding an entry is a separate review decision, not a setup convenience:
 *
 *   {
 *     projectRef: '<20-char public staging ref>',
 *     datasetLineage: '<server-owned app_metadata lineage>',
 *     appOrigin: 'https://<exact-immutable-preview>.vercel.app',
 *     commit: '<exact-40-character-reviewed-sha>',
 *     entryDocumentSha256: '<reviewed-preview-index-html-sha256>',
 *     appAssets: [
 *       { path: '/assets/index-<hash>.js', sha256: '<exact-sha256>' },
 *       // Every same-origin lazy JS/CSS/static asset must be listed.
 *     ],
 *     environmentSentinelId: '<server-owned-staging-sentinel-uuid>',
 *     fixtureRevision: 1,
 *     // SHA-256 of UTF-8 fields joined by ASCII Unit Separator (0x1f):
 *     // caaci-hosted-fixture-v1, projectRef, datasetLineage, sentinel UUID,
 *     // revision, member-a + A UUID, member-b + B UUID, member-c + C UUID,
 *     // `ab` + AB UUID, then `ac` + AC UUID.
 *     fixtureManifestSha256: '<reviewed-fixture-manifest-sha256>',
 *     providerDisableProofSha256: '<reviewed-control-plane-proof-sha256>',
 *     providerProofExpiresAt: '<exact-UTC-ISO-expiry>',
 *   }
 *
 * Never add the production ref or `illinimarket.com`.
 */
export interface ApprovedHostedRealtimeTarget {
  readonly projectRef: string
  readonly datasetLineage: string
  readonly appOrigin: string
  readonly commit: string
  readonly entryDocumentSha256: string
  readonly appAssets: readonly Readonly<{
    path: string
    sha256: string
  }>[]
  readonly environmentSentinelId: string
  readonly fixtureRevision: number
  readonly fixtureManifestSha256: string
  readonly providerDisableProofSha256: string
  readonly providerProofExpiresAt: string
}

export const APPROVED_HOSTED_REALTIME_TARGETS: readonly ApprovedHostedRealtimeTarget[] =
  Object.freeze([])
