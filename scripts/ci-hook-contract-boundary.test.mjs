import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ROOT = new URL('../', import.meta.url)

const source = async path => readFile(new URL(path, ROOT), 'utf8')

test('pre-push runs deterministic boundary tests for executable non-client changes', async () => {
  const hook = await source('.githooks/pre-push')

  assert.match(hook, /node --test \.\.\/api\/\*\.test\.mjs \.\.\/scripts\/\*\.test\.mjs smoke\/\*\.test\.mjs/)
  assert.match(hook, /needs_boundary_tests\(\)[\s\S]*\.github\/\*[\s\S]*\*\)[\s\S]*return 0/)
  assert.match(hook, /needs_client_builds\(\)[\s\S]*\.github\/\*\|\.githooks\/\*\)[\s\S]*return 1/)
  assert.match(hook, /supabase\/migrations\/\*\.sql\)[\s\S]*return 1/)
  assert.match(hook, /api\/\*\)[\s\S]*return 1/)
  assert.match(hook, /scripts\/\*\.mjs\|scripts\/\*\.sh\)[\s\S]*return 1/)
  assert.doesNotMatch(hook, /only docs\/migrations\/scripts\/api changed[^\n]*skipping/)
})

test('pre-push uses an isolated output directory for concurrent invocations', async () => {
  const hook = await source('.githooks/pre-push')

  assert.match(hook, /mktemp -d \/tmp\/illini-pre-push\.XXXXXX/)
  assert.match(hook, /UNI_OUTPUT_DIR="\$PRE_PUSH_TMP\/h5"/)
  assert.match(hook, /UNI_OUTPUT_DIR="\$PRE_PUSH_TMP\/mp-weixin"/)
  assert.doesNotMatch(hook, /\/tmp\/pre-push-(?:gate|typecheck|build)/)
})

test('public smoke skips missing configuration while account smoke is protected main-only', async () => {
  const ci = await source('.github/workflows/ci.yml')

  assert.match(ci, /id: smoke-config[\s\S]*can_run=false/)
  assert.match(ci, /Install Playwright \(webkit\)[\s\S]*if: steps\.smoke-config\.outputs\.can_run == 'true'/)
  assert.match(ci, /name: Smoke \(logged-out page sweep only\)[\s\S]*id: smoke-run/)
  const publicJob = ci.slice(ci.indexOf('  public-smoke:'), ci.indexOf('  authenticated-smoke:'))
  assert.doesNotMatch(publicJob, /SMOKE_EMAIL|SMOKE_PASSWORD/)
  assert.match(ci, /authenticated-smoke:[\s\S]*?environment: staging-smoke/)
  assert.match(ci, /github\.event_name == 'push'[\s\S]*?refs\/heads\/main[\s\S]*?github\.event_name == 'workflow_dispatch'[\s\S]*?refs\/heads\/main/)
  assert.match(ci, /SMOKE_EXPECTED_SUPABASE_PROJECT_REF:[\s\S]*?SMOKE_EXPECTED_USER_ID:/)
  assert.match(ci, /Protected smoke refused:[\s\S]*?exit 1/)
  assert.doesNotMatch(ci, /continue-on-error:\s*true/)
  assert.match(ci, /SMOKE_ACCOUNT_IS_SYNTHETIC:\s*\$\{\{ secrets\.SMOKE_ACCOUNT_IS_SYNTHETIC \}\}/)
  assert.match(ci, /SMOKE_DATASET_IS_SYNTHETIC:\s*\$\{\{ secrets\.SMOKE_DATASET_IS_SYNTHETIC \}\}/)
  assert.doesNotMatch(ci, /actions\/upload-artifact/)
  assert.doesNotMatch(ci, /app\/test-results/)
})

test('deterministic builds use an explicit non-production app origin', async () => {
  const [ci, hook] = await Promise.all([
    source('.github/workflows/ci.yml'),
    source('.githooks/pre-push'),
  ])

  assert.match(ci, /VITE_BASE_URL: https:\/\/ci-app-stub\.invalid/g)
  assert.equal((ci.match(/VITE_BASE_URL: https:\/\/ci-app-stub\.invalid/g) || []).length, 2)
  assert.match(hook, /VITE_BASE_URL="\$\{VITE_BASE_URL:-https:\/\/pre-push-app-stub\.invalid\}"/)
  assert.doesNotMatch(ci, /VITE_BASE_URL:\s*https:\/\/illinimarket\.com/)
  assert.doesNotMatch(hook, /VITE_BASE_URL[^\n]*illinimarket\.com/)
})

test('CI and pre-push verify built artifacts instead of checking only for a directory', async () => {
  const [ci, hook] = await Promise.all([
    source('.github/workflows/ci.yml'),
    source('.githooks/pre-push'),
  ])

  assert.match(ci, /verify-build-artifact\.mjs dist\/build\/h5 ci/)
  assert.match(ci, /verify-build-artifact\.mjs dist\/build\/mp-weixin none/)
  assert.match(hook, /verify-build-artifact\.mjs "\$PRE_PUSH_TMP\/h5" local/)
  assert.match(hook, /verify-build-artifact\.mjs "\$PRE_PUSH_TMP\/mp-weixin" none/)
})
