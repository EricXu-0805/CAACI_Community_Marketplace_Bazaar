import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/pages/plaza/index.vue', import.meta.url), 'utf8')

test('comment read failures render an explicit retry state instead of no-comments', () => {
  assert.match(source, /v-else-if="commentsError"[\s\S]*?role="alert"[\s\S]*?@click\.stop="retryComments"/)
  assert.match(source, /async function loadCommentSheet\(post: Post\)/)
  assert.match(source, /catch \{[\s\S]*?comments\.value = \[\][\s\S]*?commentsError\.value = true/)
  assert.match(source, /function retryComments\(\)[\s\S]*?void loadCommentSheet\(post\)/)
  assert.match(source, /function closeComments\(\)[\s\S]*?commentsError\.value = false/)
})
