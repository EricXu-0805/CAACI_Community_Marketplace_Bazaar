import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Liking something you already liked must not add a second one to the count.
 *
 * Both toggles treat a 23505 unique violation as success — correctly, because
 * the row is already there — and then incremented the local count anyway. The
 * count is maintained by a trigger (migrations 010 and 040), so the server had
 * already counted that like: the number on screen went one above the truth
 * until the next fetch.
 *
 * It is reachable without anyone misbehaving. The like-membership read that
 * decides which hearts are filled discards its error, so one failed read leaves
 * every post looking un-liked; the next tap on a post you had liked lands
 * exactly here.
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = rel => readFileSync(resolve(appRoot, rel), 'utf8')

function moduleDataUrl(input) {
  return `data:text/javascript;base64,${Buffer.from(input).toString('base64')}`
}

function compiledDataUrl(input) {
  return moduleDataUrl(ts.transpileModule(input, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText)
}

const UID = 'user-a'

/*
 * `insertError` is what the insert resolves with — null for a first like, a
 * 23505 for one that was already there.
 */
async function loadPlaza(insertError) {
  const accountScopeUrl = compiledDataUrl(source('src/composables/accountScope.ts'))
  const accountScope = await import(accountScopeUrl)
  const reported = []

  globalThis.__likeDriftSupabase = {
    from() {
      const chain = {
        insert: async () => ({ error: insertError }),
        delete: () => chain,
        select: () => chain,
        eq: () => chain,
        in: async () => ({ data: [], error: null }),
        then: (onFulfilled) => Promise.resolve({ error: null }).then(onFulfilled),
      }
      return chain
    },
  }

  const mocks = {
    vue: 'export const ref = value => ({ value })',
    './useSupabase': 'export function useSupabase(){ return { supabase: globalThis.__likeDriftSupabase } }',
    './useAuth': `export function useAuth(){ return { currentUser: { value: { id: '${UID}' } } } }`,
    './useModeration': 'export function useModeration(){ return { blockedIds: { value: new Set() } } }',
    './useI18n': "export function useI18n(){ return { t: key => key, lang: { value: 'en' } } }",
    '../utils': 'export const expandSearch=x=>[x], friendlyErrorMessage=e=>String(e)',
    '../utils/contentSafety': 'export const checkContent=()=>({ok:true}), clearLocalDuplicate=()=>{}, isLocalDuplicate=()=>false, remoteModerate=async()=>({flagged:false,categories:[]})',
    './useWechatSecCheck': 'export const mpTextGate=async()=>{}',
    '../utils/sentry': 'export const addBreadcrumb=()=>{}, captureException=(e, ctx)=>globalThis.__likeDriftReported.push(ctx)',
    '../utils/publicResource': 'export const assertI18nWrite=()=>{}, assertPublicMediaWrite=()=>{}, sanitizeItemResources=x=>x, sanitizePostResources=x=>x',
    '../api/mutationCommit': 'export const isDefinitiveMutationRejection=()=>false, mutationCommitState=()=>"not_committed", mutationOutcomeError=e=>e, shouldCompensateMutationFailure=()=>false',
  }
  globalThis.__likeDriftReported = reported

  let input = source('src/composables/usePlaza.ts').replace("'./accountScope'", `'${accountScopeUrl}'`)
  for (const [specifier, moduleSource] of Object.entries(mocks)) {
    input = input.replace(`'${specifier}'`, `'${moduleDataUrl(moduleSource)}'`)
  }
  const { usePlaza } = await import(`${compiledDataUrl(input)}#${insertError ? 'dup' : 'fresh'}`)
  accountScope.transitionAccount(UID)
  return { plaza: usePlaza(), reported }
}

const DUPLICATE = { code: '23505', message: 'duplicate key value violates unique constraint' }

test('liking a post whose heart was stale does not inflate its count', async () => {
  const { plaza } = await loadPlaza(DUPLICATE)
  const post = { id: 'post-1', like_count: 7, liked_by_me: false }

  await plaza.toggleLike(post)

  assert.equal(post.liked_by_me, true, 'the heart must still fill — the like does exist')
  assert.equal(post.like_count, 7, 'the trigger already counted this like; the screen counted it twice')
})

test('a first like still counts', async () => {
  // The control. Without it the assertion above is satisfied by a toggle that
  // stopped counting anything at all.
  const { plaza } = await loadPlaza(null)
  const post = { id: 'post-2', like_count: 7, liked_by_me: false }

  await plaza.toggleLike(post)

  assert.equal(post.liked_by_me, true)
  assert.equal(post.like_count, 8, 'a genuinely new like stopped being counted')
})

test('a comment like behaves the same either way', async () => {
  const { plaza: dup } = await loadPlaza(DUPLICATE)
  const stale = { id: 'c-1', like_count: 3, liked_by_me: false }
  await dup.toggleCommentLike(stale)
  assert.deepEqual([stale.liked_by_me, stale.like_count], [true, 3])

  const { plaza: fresh } = await loadPlaza(null)
  const first = { id: 'c-2', like_count: 3, liked_by_me: false }
  await fresh.toggleCommentLike(first)
  assert.deepEqual([first.liked_by_me, first.like_count], [true, 4])
})

test('both like-membership reads report the failure they swallow', () => {
  const src = source('src/composables/usePlaza.ts')
  const sources = [...src.matchAll(/reportLikeMembershipFailure\('([a-z_.]+)'/g)].map(m => m[1])

  assert.deepEqual([...new Set(sources)].sort(), [
    'plaza.comment_like_membership',
    'plaza.post_like_membership',
  ], 'a like-membership read lost its reporting, so a broken grant would be invisible')
  // utils/sentry.ts drops any tag outside its allowlist, so a mistyped key
  // reports nothing while the call still reads as correct.
  const helper = src.slice(src.indexOf('function reportLikeMembershipFailure'))
  assert.match(helper.slice(0, 500), /tags: \{ source, error_name:/)
})
