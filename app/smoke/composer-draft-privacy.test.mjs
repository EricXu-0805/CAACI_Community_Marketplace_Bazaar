import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`

test('chat drafts are conversation scoped, copied and erased across every account boundary', async () => {
  const scopeUrl = moduleUrl(source('composables/accountScope.ts'))
  const scope = await import(scopeUrl)
  const drafts = await import(moduleUrl(source('composables/chatDrafts.ts').replace("'./accountScope'", `'${scopeUrl}'`)))
  scope.transitionAccount('a')
  const a = scope.captureActiveAccountRequest()
  const draft = { text: 'My private draft', reply: { content: 'Original question', message_type: 'text' } }
  drafts.writeChatDraft(a, 'conversation-1', draft)
  draft.reply.content = 'Mutated elsewhere'
  assert.equal(drafts.readChatDraft(a, 'conversation-1').reply.content, 'Original question')
  assert.equal(drafts.readChatDraft(a, 'conversation-2'), null)
  drafts.readChatDraft(a, 'conversation-1').reply.content = 'Mutated returned copy'
  assert.equal(drafts.readChatDraft(a, 'conversation-1').reply.content, 'Original question')

  scope.transitionAccount('b')
  drafts.writeChatDraft(a, 'conversation-1', draft)
  assert.equal(drafts.readChatDraft(a, 'conversation-1'), null)
  assert.equal(drafts.readChatDraft(scope.captureActiveAccountRequest(), 'conversation-1'), null)
  scope.transitionAccount('a')
  const nextA = scope.captureActiveAccountRequest()
  assert.equal(drafts.readChatDraft(nextA, 'conversation-1'), null)
  drafts.writeChatDraft(nextA, 'conversation-1', draft)
  drafts.writeChatDraft(nextA, 'conversation-1', { text: '', reply: null })
  assert.equal(drafts.readChatDraft(nextA, 'conversation-1'), null)
  drafts.writeChatDraft(nextA, 'conversation-1', draft)
  scope.transitionAccount('a', true)
  assert.equal(drafts.readChatDraft(scope.captureActiveAccountRequest(), 'conversation-1'), null)
  drafts.writeChatDraft(scope.captureActiveAccountRequest(), 'conversation-1', draft)
  scope.transitionAccount(null)
  assert.equal(drafts.readChatDraft(null, 'conversation-1'), null)
})

test('publish drafts preserve current-document photos and reject expired blobs after reload', async () => {
  const { restorableDraftImages, publishDraftDocumentId } = await import(moduleUrl(source('utils/publishDraft.ts')))
  const images = ['blob:https://example.test/old-document', 'https://example.test/photo.jpg']
  assert.deepEqual(restorableDraftImages(images, publishDraftDocumentId), images)
  assert.deepEqual(restorableDraftImages(images, 'previous-document'), [images[1]])
  assert.deepEqual(restorableDraftImages(images), [images[1]], 'legacy drafts cannot revive expired blobs')
})
