import {
  fetchAndVerifyHostedDeploymentManifest,
  fetchAndVerifyHostedAssets,
  fetchAndVerifyHostedEntryDocument,
  hostedDeploymentManifestProof,
  loadHostedRealtimeContract,
} from './realtime-contract'
import { APPROVED_HOSTED_REALTIME_TARGETS } from './approved-targets'

export default async function globalSetup(): Promise<void> {
  const contract = loadHostedRealtimeContract(
    process.env,
    APPROVED_HOSTED_REALTIME_TARGETS,
  )
  await fetchAndVerifyHostedEntryDocument(contract)
  await fetchAndVerifyHostedDeploymentManifest(contract)
  await fetchAndVerifyHostedAssets(contract)
  process.env.CAACI_HOSTED_CANARY_MANIFEST_PROOF =
    hostedDeploymentManifestProof(contract)
}
