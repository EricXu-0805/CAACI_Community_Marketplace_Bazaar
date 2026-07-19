import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = relativePath => readFileSync(resolve(appRoot, relativePath), 'utf8')
const appSource = source('src/App.vue')

function vueFiles(relativeDir) {
  return readdirSync(resolve(appRoot, relativeDir), { withFileTypes: true }).flatMap(entry => {
    const child = `${relativeDir}/${entry.name}`
    if (entry.isDirectory()) return vueFiles(child)
    return entry.name.endsWith('.vue') ? [child] : []
  })
}

function rgb(hex) {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16))
}

function luminance(channels) {
  const linear = channels.map(channel => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(foreground, background) {
  const foregroundLuminance = luminance(rgb(foreground))
  const backgroundLuminance = luminance(rgb(background))
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

function composite(foreground, background, alpha) {
  const fg = rgb(foreground)
  const bg = rgb(background)
  const channels = fg.map((value, index) => Math.round(value * alpha + bg[index] * (1 - alpha)))
  return `#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function recursiveFiles(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const absolute = resolve(root, entry.name)
    return entry.isDirectory() ? recursiveFiles(absolute) : [absolute]
  })
}

test('H5 bundles only the bounded Latin brand face and leaves CJK to system fonts', () => {
  const packageJson = JSON.parse(source('package.json'))
  const packageLock = source('package-lock.json')

  assert.equal(packageJson.dependencies['@fontsource-variable/noto-sans-sc'], undefined)
  assert.equal(packageJson.dependencies['@fontsource-variable/noto-serif-sc'], undefined)
  assert.doesNotMatch(packageLock, /node_modules\/@fontsource-variable\/noto-(?:sans|serif)-sc/)
  assert.doesNotMatch(appSource, /import\s+['"]@fontsource-variable\/noto-(?:sans|serif)-sc\//)
  assert.match(appSource, /import\s+['"]@fontsource-variable\/fraunces\/opsz\.css['"]/)
  assert.match(appSource, /--font-serif:[^;]*'Fraunces Variable'[^;]*'Songti SC'[^;]*'STSong'[^;]*'SimSun'/s)
  assert.match(appSource, /--font-hei:[^;]*-apple-system[^;]*'PingFang SC'[^;]*'Microsoft YaHei'[^;]*'Noto Sans CJK SC'/s)

  const imports = [...appSource.matchAll(/import\s+['"](@fontsource-variable\/[^'"]+\.css)['"]/g)]
    .map(match => match[1])
  assert.deepEqual(imports, ['@fontsource-variable/fraunces/opsz.css'])

  const emittedFonts = imports.flatMap(specifier => {
    const cssPath = resolve(appRoot, 'node_modules', specifier)
    const css = readFileSync(cssPath, 'utf8')
    return [...css.matchAll(/url\((?:['"])?([^)'"?]+\.woff2)(?:['"])?\)/g)]
      .map(match => resolve(dirname(cssPath), match[1]))
  })
  const emittedBytes = emittedFonts.reduce((total, file) => total + statSync(file).size, 0)
  assert.ok(emittedFonts.length <= 3, `brand font emits ${emittedFonts.length} WOFF2 files`)
  assert.ok(emittedBytes <= 200 * 1024, `brand font emits ${emittedBytes} bytes`)

  // When a local build is present, also verify Vite did not retain stale CJK
  // shards and kept the same hard delivery budget in the actual artifact.
  const distAssets = resolve(appRoot, 'dist/build/h5/assets')
  if (existsSync(distAssets)) {
    const distFonts = recursiveFiles(distAssets).filter(file => file.endsWith('.woff2'))
    const distBytes = distFonts.reduce((total, file) => total + statSync(file).size, 0)
    assert.equal(distFonts.some(file => /noto-(?:sans|serif)-sc/i.test(file)), false)
    assert.ok(distFonts.length <= 3, `H5 artifact contains ${distFonts.length} WOFF2 files`)
    assert.ok(distBytes <= 200 * 1024, `H5 artifact contains ${distBytes} font bytes`)
  }
})

test('readable subtle and warning tokens meet AA on every supported surface', () => {
  assert.ok((appSource.match(/--text-subtle:\s*#6B6459/g) || []).length >= 2)
  assert.ok((appSource.match(/--text-subtle:\s*rgba\(240, 232, 214, 0\.60\)/g) || []).length >= 3)
  assert.ok((appSource.match(/--warning-text:\s*#8A5A13/g) || []).length >= 2)
  assert.ok((appSource.match(/--warning-text:\s*#E5B170/g) || []).length >= 3)
  assert.ok((appSource.match(/--warning-surface:\s*#8A5A13/g) || []).length >= 5)

  const lightSurfaces = ['#FFFFFF', '#F7F4EE', '#F1ECE2', '#E9E2D4']
  for (const background of lightSurfaces) {
    assert.ok(contrast('#6B6459', background) >= 4.5, `light subtle on ${background}`)
    assert.ok(contrast('#8A5A13', background) >= 4.5, `light warning text on ${background}`)
  }
  assert.ok(contrast('#8A5A13', '#F5E4CB') >= 4.5, 'light warning text on warning-soft')
  assert.ok(contrast('#FFFFFF', '#8A5A13') >= 4.5, 'white label on warning surface')

  const darkSurfaces = ['#12100D', '#201E1A', '#2C2A25', '#383530']
  for (const background of darkSurfaces) {
    const subtle = composite('#F0E8D6', background, 0.60)
    assert.ok(contrast(subtle, background) >= 4.5, `dark subtle on ${background}`)
    assert.ok(contrast('#E5B170', background) >= 4.5, `dark warning text on ${background}`)
  }
})

test('non-admin readable copy no longer reuses faint or low-contrast warning colors', () => {
  const allowedLowContrastSelectors = /\.disabled\b|\.fs-dash\b/
  const offenders = []
  for (const file of vueFiles('src')) {
    if (file === 'src/pages/admin/index.vue') continue
    const lines = source(file).split('\n')
    lines.forEach((line, index) => {
      if (!/color:\s*var\(--(?:text-faint|ink-faint|accent-warn|warning)\)/.test(line)) return
      if (allowedLowContrastSelectors.test(line)) return
      offenders.push(`${file}:${index + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(offenders, [])

  for (const file of [
    'src/pages/index/index.vue',
    'src/pages/detail/index.vue',
    'src/pages/messages/index.vue',
    'src/pages/plaza/index.vue',
    'src/pages/post/index.vue',
    'src/pages/publish/index.vue',
    'src/components/ChatThread.vue',
  ]) {
    assert.match(source(file), /color:\s*var\(--text-subtle\)/, `${file} must use readable secondary copy`)
  }
  assert.match(source('src/pages/detail/index.vue'), /background:\s*var\(--warning-surface\);\s*color:\s*#fff/)
  assert.match(source('src/pages/messages/index.vue'), /\.act-pin\s*\{\s*background:\s*var\(--warning-surface\)/)
})
