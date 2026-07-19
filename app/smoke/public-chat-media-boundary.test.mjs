import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const thread = readFileSync(new URL('../src/components/ChatThread.vue', import.meta.url), 'utf8')
const messages = readFileSync(new URL('../src/composables/useMessages.ts', import.meta.url), 'utf8')
const resources = readFileSync(new URL('../src/utils/publicResource.ts', import.meta.url), 'utf8')
const csp = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))

test('public listing storage is not presented as private chat media', () => {
  assert.equal(thread.includes('uni.chooseImage('), false)
  assert.equal(thread.includes('uni.chooseVideo('), false)
  assert.equal(thread.includes(':src="entry.msg.content"'), false)
  assert.equal(thread.includes('uploadOneImage'), false)
  assert.equal(thread.includes('uploadOneVideo'), false)
  assert.match(thread, /chat\.mediaUnavailable/)
  assert.match(messages, /type !== 'text'/)
  assert.match(messages, /chat_media_private_storage_required/)
  assert.match(resources, /message\.message_type === 'text' \? message\.content : ''/)
})

test('composer retains emoji/stickers without fake glyph controls', () => {
  assert.match(thread, /<ChatEmojiPanel/)
  assert.match(thread, /stickerToken\(name\)/)
  assert.match(thread, /<UIcon name="more-horizontal"/)
  assert.equal(thread.includes('emoji-btn-glyph'), false)
})

test('CSP supports environment-specific Supabase hosts while app code pins the compiled origin', () => {
  const value = csp.headers[0].headers.find((header) => header.key === 'Content-Security-Policy').value
  const imageDirective = value.split(';').map((part) => part.trim()).find((part) => part.startsWith('img-src '))
  assert.equal(
    imageDirective,
    "img-src 'self' data: blob: https://*.supabase.co",
  )
  assert.match(resources, /url\.origin !== PUBLIC_STORAGE_ORIGIN/)
  assert.match(resources, /import\.meta\.env\.VITE_SUPABASE_URL/)
})
