import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ROOT = new URL('../', import.meta.url)

const [publishSource, editSource, detailSource] = await Promise.all([
  readFile(new URL('src/pages/publish/index.vue', ROOT), 'utf8'),
  readFile(new URL('src/pages/publish/edit.vue', ROOT), 'utf8'),
  readFile(new URL('src/pages/detail/index.vue', ROOT), 'utf8'),
])

function styleBlock(source, selector, nextSelector) {
  const start = source.indexOf(selector)
  const end = source.indexOf(nextSelector, start + selector.length)
  assert.notEqual(start, -1, `missing ${selector}`)
  assert.notEqual(end, -1, `missing ${nextSelector}`)
  return source.slice(start, end)
}

test('current-location controls preserve the mobile form gutter in create and edit flows', () => {
  for (const source of [publishSource, editSource]) {
    const locateButton = styleBlock(source, '.locate-btn {', '.locate-btn-icon')
    assert.match(locateButton, /margin:\s*10px 16px 0;/)
    assert.doesNotMatch(locateButton, /margin-top:\s*10px;/)
  }
})

test('gallery pagination stays above the overlapping detail card', () => {
  const counter = styleBlock(detailSource, '.img-counter {', '.img-dots {')
  const dots = styleBlock(detailSource, '.img-dots {', '.img-dot {')

  assert.match(counter, /bottom:\s*24px;/)
  assert.match(dots, /bottom:\s*24px;/)
  assert.doesNotMatch(counter, /bottom:\s*12px;/)
  assert.doesNotMatch(dots, /bottom:\s*12px;/)
})

test('detail gallery initially renders only the current and adjacent images', () => {
  assert.match(detailSource, /v-if="galleryImageReady\(i\)"/)
  assert.match(detailSource, /function neighboringGalleryIndexes\(index: number, length: number\)/)
  assert.match(detailSource, /\(index - 1 \+ length\) % length/)
  assert.match(detailSource, /\(index \+ 1\) % length/)
  assert.match(detailSource, /@change="onGalleryChange"/)
})
