import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const smoke = readFileSync(new URL('./pages.smoke.spec.ts', import.meta.url), 'utf8')
const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8')

test('authenticated smoke requires both synthetic account and dataset attestations', () => {
  assert.match(workflow, /SMOKE_ACCOUNT_IS_SYNTHETIC:\s*\$\{\{ secrets\.SMOKE_ACCOUNT_IS_SYNTHETIC \}\}/)
  assert.match(workflow, /SMOKE_DATASET_IS_SYNTHETIC:\s*\$\{\{ secrets\.SMOKE_DATASET_IS_SYNTHETIC \}\}/)
  assert.match(smoke, /process\.env\.SMOKE_ACCOUNT_IS_SYNTHETIC === 'true'/)
  assert.match(smoke, /process\.env\.SMOKE_DATASET_IS_SYNTHETIC === 'true'/)
  assert.match(smoke, /SMOKE_EXPECTED_SUPABASE_PROJECT_REF/)
  assert.match(smoke, /SMOKE_EXPECTED_USER_ID/)
  assert.match(smoke, /!EMAIL \|\| !PASSWORD \|\| !ACCOUNT_IS_SYNTHETIC \|\| !DATASET_IS_SYNTHETIC \|\| !EXACT_STAGING_TARGET/)
  assert.match(smoke, /sessionUserId[\s\S]*?toBe\(EXPECTED_USER_ID\)/)
})

test('PR-capable smoke receives no account secret and authenticated smoke is protected main-only', () => {
  const publicJob = workflow.slice(
    workflow.indexOf('  public-smoke:'),
    workflow.indexOf('  authenticated-smoke:'),
  )
  const authenticatedJob = workflow.slice(workflow.indexOf('  authenticated-smoke:'))
  assert.doesNotMatch(publicJob, /SMOKE_EMAIL|SMOKE_PASSWORD|SMOKE_ACCOUNT_IS_SYNTHETIC|SMOKE_DATASET_IS_SYNTHETIC/)
  assert.match(authenticatedJob, /environment: staging-smoke/)
  assert.match(authenticatedJob, /github\.event_name == 'push'[\s\S]*?github\.ref == 'refs\/heads\/main'/)
  assert.match(authenticatedJob, /github\.event_name == 'workflow_dispatch'[\s\S]*?github\.ref == 'refs\/heads\/main'/)
  assert.doesNotMatch(authenticatedJob, /github\.event_name == 'pull_request'/)
  assert.match(authenticatedJob, /must exist only in the protected `staging-smoke` GitHub Environment, not[\s\S]*?as repository secrets/)
  assert.match(authenticatedJob, /SMOKE_EXPECTED_SUPABASE_PROJECT_REF:\s*\$\{\{ vars\.SMOKE_EXPECTED_SUPABASE_PROJECT_REF \}\}/)
  assert.match(authenticatedJob, /SMOKE_EXPECTED_USER_ID:\s*\$\{\{ vars\.SMOKE_EXPECTED_USER_ID \}\}/)
  assert.match(authenticatedJob, /Supabase URL does not match the reviewed staging project ref[\s\S]*?exit 1/)
  assert.doesNotMatch(authenticatedJob, /can_run=false/)
})

test('CI authenticated smoke produces and uploads no browser artifacts', () => {
  assert.match(config, /const isCi = process\.env\.CI === 'true'/)
  assert.match(config, /screenshot: isCi \? 'off' : 'only-on-failure'/)
  assert.match(config, /trace: 'off'/)
  assert.match(config, /video: 'off'/)
  assert.doesNotMatch(workflow, /actions\/upload-artifact/)
  assert.doesNotMatch(workflow, /app\/test-results/)
})
