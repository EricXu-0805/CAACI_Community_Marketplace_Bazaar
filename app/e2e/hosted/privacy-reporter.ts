import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'

const SCENARIO_IDS = new Set([
  'AUTH-01',
  'AUTH-02',
  'RLS-01',
  'FAIL-01',
  'DEDUPE-01',
  'SWITCH-01',
])

function scenarioId(testCase: TestCase): string {
  for (const segment of testCase.titlePath()) {
    if (SCENARIO_IDS.has(segment)) return segment
  }
  return 'UNKNOWN'
}

function safeStatus(status: string): string {
  return new Set([
    'passed',
    'failed',
    'timedOut',
    'timedout',
    'interrupted',
    'skipped',
  ]).has(status) ? status : 'unknown'
}

/**
 * Deliberately discards errors, call logs, paths, URLs, attachments and test
 * values. The fixed scenario code and result are the entire durable signal.
 */
export default class HostedRealtimePrivacyReporter implements Reporter {
  private passed = 0
  private failed = 0

  onTestEnd(testCase: TestCase, testResult: TestResult): void {
    const status = safeStatus(testResult.status)
    if (status === 'passed') this.passed += 1
    else this.failed += 1
    process.stdout.write(
      `[HOSTED-CANARY] ${scenarioId(testCase)} ${status}\n`,
    )
  }

  onError(): void {
    process.stdout.write('[HOSTED-CANARY] HARNESS failed\n')
  }

  onEnd(result: FullResult): void {
    const status = safeStatus(result.status)
    process.stdout.write(
      `[HOSTED-CANARY] SUMMARY ${status} pass=${this.passed} fail=${this.failed}\n`,
    )
  }
}
