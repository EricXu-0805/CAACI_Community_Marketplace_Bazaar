import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const compile = input => ts.transpileModule(input, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
function load(path) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compile(source(path)))(
    module, module.exports, () => ({ captureException() {} }),
  )
  return module.exports
}
function block(input, startMarker, endMarker) {
  const start = input.indexOf(startMarker)
  const end = input.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0 && end > start, `missing function between ${startMarker} and ${endMarker}`)
  return input.slice(start, end)
}
function bind(input, name, scope) {
  return new Function(...Object.keys(scope), `${compile(input)}\nreturn ${name}`)(...Object.values(scope))
}
const messages = {
  en: load('composables/i18n/messages/en.ts').default,
  zh: load('composables/i18n/messages/zh.ts').default,
}
const { friendlyErrorMessage } = load('utils/index.ts')
const mutation = load('api/mutationCommit.ts')
const page = source('pages/plaza/index.vue')
const submitSource = block(page, 'async function onSubmitPost()', '\nfunction onDeletePost(')
const buttonExpression = page.match(/{{ (submitting\s*\?[^]*?) }}/)?.[1]
assert.ok(buttonExpression, 'composer submit button expression is missing')
const buttonText = new Function('submitting', 'composerUploadProgress', 'outcomeUncertain', 't', `return ${buttonExpression}`)
const ref = value => ({ value })

function composerFixture({ lang = 'en', error, images = [], upload, publish } = {}) {
  const toasts = [], publications = []
  const token = { userId: 'user-a', generation: 1 }
  const scope = {
    ...mutation,
    awaitAuthReady: async () => {},
    requireAuth: () => true,
    outcomeUncertain: ref(false),
    composerMode: ref('update'),
    composerText: ref('A campus update'),
    composerImages: ref(images),
    composerAttachedItems: ref([]),
    composerAccountToken: token,
    composerPostId: ref('post-1'),
    composerRetryCreate: false,
    composerUploadProgress: ref(null),
    submitting: ref(false),
    lang: ref(lang),
    isAccountRequestCurrent: candidate => candidate === token,
    safeItemMediaUrls: () => [],
    removeOwnedItemImages: async () => {},
    authoredLang: () => lang,
    createClientMessageId: () => 'post-2',
    confirmSuspectedAd: () => true,
    friendlyErrorMessage,
    uni: { showToast: toast => toasts.push(toast) },
    t: (key, params = {}) => {
      assert.ok(key in messages[lang], `missing translation ${key}`)
      return messages[lang][key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
    },
    uploadImagesWithDims: async (files, options) => {
      assert.equal(options.accountToken, token)
      return upload(files, options, token)
    },
    createPost: async (...args) => {
      publications.push(args)
      if (publish) await publish()
      throw mutation.mutationOutcomeError(error || new Error('suspension_active:2:2026-12-03T12:34:56Z'), 'not_committed')
    },
  }
  return {
    scope, toasts, publications,
    submit: bind(submitSource, 'onSubmitPost', scope),
    text: () => buttonText(scope.submitting.value, scope.composerUploadProgress.value, scope.outcomeUncertain.value, scope.t),
  }
}

function uploadFixture({ failedFile, heicFile } = {}) {
  const progress = [], finished = [], cleaned = []
  const token = { userId: 'user-a', generation: 1 }
  // Run the actual H5 branch, as the uni-app compiler does, without network I/O.
  const input = block(source('composables/useItems.ts'), '  async function uploadImagesWithDims(', '\n  async function uploadImages(')
    .replace(/^\s*\/\/ #ifndef H5[^]*?^\s*\/\/ #endif/gm, '')
  const scope = {
    MAX_IMAGES: 9,
    MAX_FILE_SIZE: 5 * 1024 * 1024,
    PUBLIC_IMAGE_MAX_LONG_EDGE: 1600,
    IMAGE_UPLOAD_TIMEOUT_MS: 30_000,
    getActiveAccountId: () => token.userId,
    captureAccountRequest: () => token,
    isAccountRequestCurrent: candidate => candidate === token,
    assertAccountCurrent: candidate => assert.equal(candidate, token),
    isAccountChangedError: () => false,
    getImageDimensions: async file => {
      if (file === heicFile) throw Object.assign(new Error('unsupported image'), { heic: true })
      return { w: 800, h: 600 }
    },
    storedImageDimensions: dims => dims,
    compressImage: async file => file,
    fetch: async file => ({ blob: async () => ({ size: 10, file }) }),
    detectImageMimeType: async () => 'image/jpeg',
    withUploadTimeout: promise => promise,
    mpImageCheck: async () => {},
    cleanupFailedUploadBatch: async urls => { cleaned.push(...urls) },
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: token.userId } } } }) },
      storage: {
        from: () => ({
          getPublicUrl: path => ({ data: { publicUrl: `https://storage.invalid/${path}` } }),
          upload: async (_path, blob) => {
            finished.push(blob.file)
            return { error: blob.file === failedFile ? new Error('upload failed') : null }
          },
        }),
      },
    },
  }
  return {
    upload: bind(input, 'uploadImagesWithDims', scope),
    progress, finished, cleaned,
    onProgress: (done, total) => { progress.push([done, total, finished.length]) },
  }
}

test('image upload progress starts at zero and advances after each success or failed file', async () => {
  const h = uploadFixture({ failedFile: 'second.jpg' })
  const result = await h.upload(['first.jpg', 'second.jpg', 'third.jpg'], { onProgress: h.onProgress })
  assert.deepEqual(h.progress, [[0, 3, 0], [1, 3, 1], [2, 3, 2], [3, 3, 3]])
  assert.deepEqual(h.finished, ['first.jpg', 'second.jpg', 'third.jpg'])
  assert.deepEqual(result.sourceIndices, [0, 2])
  assert.equal(result.urls.length, 2)
  assert.equal(h.cleaned.length, 1)
})

test('image upload progress reports empty batches and remains optional for existing callers', async () => {
  const h = uploadFixture()
  assert.equal((await h.upload([], { onProgress: h.onProgress })).urls.length, 0)
  assert.deepEqual(h.progress, [[0, 0, 0]])
  assert.equal((await h.upload(['first.jpg'])).urls.length, 1)
})

test('image upload progress finishes the failed file before a fatal image rejection', async () => {
  const h = uploadFixture({ heicFile: 'second.heic' })
  await assert.rejects(h.upload(['first.jpg', 'second.heic', 'third.jpg'], { onProgress: h.onProgress }), { heic: true })
  assert.deepEqual(h.progress, [[0, 3, 0], [1, 3, 1], [2, 3, 1]])
  assert.equal(h.cleaned.length, 1)
})

for (const lang of ['en', 'zh']) {
  test(`suspension_active publication failure shows the SPEC restriction text and localized date in ${lang}`, async () => {
    const h = composerFixture({ lang })
    await h.submit()
    assert.equal(h.publications.length, 1)
    const date = new Date('2026-12-03T12:34:56Z').toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')
    assert.equal(h.toasts.length, 1)
    assert.equal(h.toasts[0].title, lang === 'zh'
      ? `账号受限期间不能发帖，${date} 恢复`
      : `You can't post while your account is restricted. Access returns ${date}.`)
    assert.equal(h.scope.submitting.value, false)
  })

  test(`publication failures without a parsable restriction date retain friendly error copy in ${lang}`, async () => {
    for (const message of ['suspension_active:2:', 'suspension_active:2:not-a-date', 'suspension_active:2', 'network error']) {
      const error = new Error(message)
      const h = composerFixture({ lang, error })
      await h.submit()
      assert.equal(h.toasts.length, 1)
      assert.equal(h.toasts[0].title, friendlyErrorMessage(error, lang), message)
    }
  })

  test(`composer submit button shows image progress and switches to publishing in ${lang}`, async () => {
    let fixture
    const uploadLabels = []
    let publicationLabel, publicationProgress
    fixture = composerFixture({
      lang, images: ['first.jpg', 'second.jpg'],
      upload: async (_files, options, token) => {
        for (const done of [0, 1, 2]) {
          options.onProgress(done, 2)
          uploadLabels.push(fixture.text())
        }
        return { urls: ['photo-1', 'photo-2'], dims: [], sourceIndices: [0, 1], accountToken: token }
      },
      publish: async () => {
        publicationProgress = fixture.scope.composerUploadProgress.value
        publicationLabel = fixture.text()
      },
    })
    await fixture.submit()
    assert.deepEqual(uploadLabels, [0, 1, 2].map(done => lang === 'zh' ? `上传图片 ${done}/2` : `Uploading photos ${done}/2`))
    assert.equal(publicationProgress, null)
    assert.equal(publicationLabel, lang === 'zh' ? '发布中…' : 'Posting…')
    assert.equal(fixture.publications.length, 1)
    assert.equal(fixture.text(), lang === 'zh' ? '发布' : 'Post')
  })
}
