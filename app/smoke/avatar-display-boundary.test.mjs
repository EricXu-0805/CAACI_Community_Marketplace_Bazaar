import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appRoot = new URL('../', import.meta.url)
const source = relative => readFileSync(new URL(relative, appRoot), 'utf8')

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
