import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const appRoot = new URL('../', import.meta.url)
const source = relative => readFileSync(new URL(relative, appRoot), 'utf8')

const DEFAULT_AVATARS = ['src/static/default-avatar.svg', 'src/static/default-avatar-dark.svg']
const PAINTED_TAGS = new Set(['path', 'circle', 'rect', 'ellipse', 'polygon', 'polyline'])

function staticSvgs(dir = 'src/static') {
  return readdirSync(new URL(dir, appRoot), { withFileTypes: true }).flatMap(entry => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return staticSvgs(relative)
    return entry.name.endsWith('.svg') ? [relative] : []
  })
}

/*
 * An SVG served as an image is parsed by the browser's XML parser, which is
 * fatal on the first error — the whole picture is dropped, silently. The repo
 * carries no XML parser, so this is the strict scan those assets need: it
 * returns the elements it read and throws on anything a lenient HTML parser
 * would have forgiven.
 */
function scanXml(text) {
  const open = []
  const elements = []
  let roots = 0
  let i = 0
  while (i < text.length) {
    const lt = text.indexOf('<', i)
    if (lt < 0) break
    i = lt
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end < 0) throw new SyntaxError('unterminated comment')
      if (text.slice(i + 4, end).includes('--')) throw new SyntaxError('comment contains a double-hyphen')
      i = end + 3
      continue
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2)
      if (end < 0) throw new SyntaxError('unterminated processing instruction')
      i = end + 2
      continue
    }
    if (text.startsWith('</', i)) {
      const closing = /^<\/([A-Za-z_:][\w.:-]*)\s*>/.exec(text.slice(i))
      if (!closing) throw new SyntaxError('malformed closing tag')
      if (open.pop() !== closing[1]) throw new SyntaxError(`unbalanced closing tag </${closing[1]}>`)
      i += closing[0].length
      continue
    }
    const opening = /^<([A-Za-z_:][\w.:-]*)/.exec(text.slice(i))
    if (!opening) throw new SyntaxError('malformed tag')
    if (open.length === 0) roots += 1
    let j = i + opening[0].length
    const attributes = {}
    for (;;) {
      const gap = /^\s*/.exec(text.slice(j))[0]
      j += gap.length
      if (text.startsWith('/>', j)) { j += 2; break }
      if (text[j] === '>') { open.push(opening[1]); j += 1; break }
      if (!gap) throw new SyntaxError(`attributes are not whitespace-separated in <${opening[1]}>`)
      const attribute = /^([A-Za-z_:][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')/.exec(text.slice(j))
      if (!attribute) throw new SyntaxError(`unquoted or malformed attribute in <${opening[1]}>`)
      attributes[attribute[1]] = attribute[2].slice(1, -1)
      j += attribute[0].length
    }
    elements.push({ name: opening[1], attributes })
    i = j
  }
  if (open.length) throw new SyntaxError(`unclosed element <${open[open.length - 1]}>`)
  if (roots !== 1) throw new SyntaxError(`expected exactly one root element, read ${roots}`)
  return elements
}

const displayFiles = [
  'src/components/AppSidebar.vue',
  'src/components/ChatThread.vue',
  'src/pages/admin/index.vue',
  'src/pages/blocked/index.vue',
  'src/pages/detail/index.vue',
  'src/pages/following/index.vue',
  'src/pages/history/index.vue',
  'src/pages/index/index.vue',
  'src/pages/messages/index.vue',
  'src/pages/plaza/index.vue',
  'src/pages/post/index.vue',
  'src/pages/profile/index.vue',
  'src/pages/seller/index.vue',
]

test('display avatars use one exact-owner thumbnail and network fallback boundary', () => {
  const component = source('src/components/UAvatar.vue')
  assert.match(component, /safeAvatarThumbUrl\(props\.src, props\.owner\)/)
  assert.match(component, /remoteFailed\.value \? props\.fallback : \(remoteSrc\.value \|\| props\.fallback\)/)
  assert.match(component, /@error="onImageError"/)
  assert.match(component, /:key="remoteSrc \|\| fallback"/)
  assert.match(component, /:lazy-load="lazy"/)
  assert.match(component, /\.u-avatar-image\s*\{[\s\S]*width: 100%;[\s\S]*height: 100%;/)

  for (const file of displayFiles) {
    const text = source(file)
    const tags = [...text.matchAll(/<UAvatar\b(?:[^>"']|"[^"]*"|'[^']*')*>/gs)].map(match => match[0])
    assert.ok(tags.length > 0, `${file} must use UAvatar for display avatars`)
    for (const tag of tags) {
      assert.match(tag, /:owner="[^"]+"/, `${file}: avatar owner is not explicit: ${tag}`)
      assert.match(tag, /:fallback="[^"]+"/, `${file}: avatar fallback is not explicit: ${tag}`)
    }
  }
})

test('list avatars opt into lazy loading and raw edit previews remain isolated', () => {
  const lazyListSources = [
    'p.avatar_url',
    'item.profile?.avatar_url',
    'thread.parent.profile?.avatar_url',
    'child.profile?.avatar_url',
    'entry.msg.sender?.avatar_url',
    'r.rater?.avatar_url',
    'getOtherUser(conv)?.avatar_url',
    'u.avatar_url',
    's.profile_avatar_url',
    'a.profile_avatar_url',
    'w.avatar_url',
  ]
  const allDisplaySource = displayFiles.map(source).join('\n')
  const avatarTags = [...allDisplaySource.matchAll(/<UAvatar\b(?:[^>"']|"[^"]*"|'[^']*')*>/gs)].map(match => match[0])
  for (const binding of lazyListSources) {
    const tags = avatarTags.filter(tag => tag.includes(`:src="${binding}"`))
    assert.ok(tags.length > 0, `missing list avatar source ${binding}`)
    for (const tag of tags) assert.match(tag, /\slazy(?:\s|\/?>)/, `${binding} must be lazy: ${tag}`)
  }

  for (const file of displayFiles) {
    assert.doesNotMatch(
      source(file),
      /<image\b(?:[^>"']|"[^"]*"|'[^']*')*:src="[^"]*avatar_url[^"]*"(?:[^>"']|"[^"]*"|'[^']*')*>/gs,
      `${file} bypasses the display avatar boundary`,
    )
  }

  // These two flows can contain a local temp-file preview and must not be
  // forced through the remote-storage validator before upload completes.
  for (const file of ['src/pages/onboarding/index.vue', 'src/pages/profile/edit.vue']) {
    assert.match(source(file), /<image[\s\S]*?:src="avatarUrl \|\| defaultAvatarSrc"/)
    assert.doesNotMatch(source(file), /<UAvatar/)
  }
})

test('profile share cards validate and resize the owned avatar too', () => {
  for (const file of ['src/pages/profile/index.vue', 'src/pages/seller/index.vue']) {
    const text = source(file)
    assert.match(text, /imageUrl: safeAvatarThumbUrl\([^,]+, [^)]+\) \|\| defaultAvatarSrc\.value,/)
  }
})

test('the strict SVG scan rejects the malformations a browser drops the image over', () => {
  assert.equal(scanXml('<svg xmlns="x"><!-- fine --><rect fill="#000"/></svg>').length, 2)
  const malformed = [
    ['comment with a double-hyphen', '<svg xmlns="x"><!-- a --b --><rect fill="#000"/></svg>'],
    ['unquoted attribute', '<svg xmlns="x"><rect width=64 fill="#000"/></svg>'],
    ['unterminated comment', '<svg xmlns="x"><!-- a <rect fill="#000"/></svg>'],
    ['mismatched closing tag', '<svg xmlns="x"><rect fill="#000"/></svgx>'],
    ['unclosed root', '<svg xmlns="x"><rect fill="#000"/>'],
    ['second root element', '<svg xmlns="x"/><svg xmlns="x"/>'],
  ]
  for (const [label, text] of malformed) {
    assert.throws(() => scanXml(text), SyntaxError, `accepted ${label}`)
  }
})

test('every bundled SVG is well-formed and both default avatars paint a figure', () => {
  const files = staticSvgs()
  for (const file of DEFAULT_AVATARS) assert.ok(files.includes(file), `missing ${file}`)

  for (const file of files) {
    let elements
    try {
      elements = scanXml(source(file))
    } catch (error) {
      assert.fail(`${file} is not well-formed XML, so browsers render nothing: ${error.message}`)
    }
    assert.equal(elements[0].name, 'svg', `${file} does not start with <svg>`)
  }

  // A default avatar that parses but paints its figure in the background
  // colour is the same blank disc to the reader, so require both.
  for (const file of DEFAULT_AVATARS) {
    const painted = scanXml(source(file))
      .filter(el => PAINTED_TAGS.has(el.name) && el.attributes.fill && el.attributes.fill !== 'none')
    assert.ok(painted.length >= 2, `${file} draws no filled figure`)
    const fills = new Set(painted.map(el => el.attributes.fill.toLowerCase()))
    assert.ok(fills.size >= 2, `${file} paints its figure in its own background colour`)
  }
})
