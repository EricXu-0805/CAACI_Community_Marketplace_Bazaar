import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { APPROVED_HOSTED_REALTIME_TARGETS } from './e2e/hosted/approved-targets'
import {
  assertHostedBrowserExecutable,
  loadHostedRealtimeContract,
} from './e2e/hosted/realtime-contract'

const contract = loadHostedRealtimeContract(
  process.env,
  APPROVED_HOSTED_REALTIME_TARGETS,
)
const outputDir = resolve(
  process.env.CAACI_HOSTED_CANARY_OUTPUT_DIR || '',
)
const isolatedRunRoot = resolve(tmpdir())
const browserExecutable = assertHostedBrowserExecutable(
  process.env.CAACI_HOSTED_CANARY_BROWSER_EXECUTABLE,
)
if (
  dirname(outputDir) !== isolatedRunRoot
  || !basename(isolatedRunRoot).startsWith('caaci-hosted-realtime-run-')
  || !basename(outputDir).startsWith('caaci-hosted-realtime-')
) throw new Error('hosted_realtime_output_boundary_failed')

export default defineConfig({
  testDir: './e2e/hosted',
  testMatch: 'realtime-reliability.spec.ts',
  globalSetup: resolve(__dirname, 'e2e/hosted/global-setup.ts'),
  reporter: [[resolve(__dirname, 'e2e/hosted/privacy-reporter.ts')]],
  globalTimeout: 20 * 60 * 1_000,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  maxFailures: 1,
  preserveOutput: 'never',
  outputDir,
  use: {
    baseURL: contract.appOrigin,
    ...devices['Desktop Chrome'],
    locale: 'en-US',
    colorScheme: 'light',
    headless: true,
    launchOptions: {
      executablePath: browserExecutable,
      args: ['--no-proxy-server'],
    },
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [{
    name: 'chromium-realtime',
    use: { browserName: 'chromium' },
  }],
})
