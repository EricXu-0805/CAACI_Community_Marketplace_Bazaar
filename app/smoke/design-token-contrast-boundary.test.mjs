import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(appRoot, 'src')
const appVue = readFileSync(join(srcRoot, 'App.vue'), 'utf8')

/*
 * Contrast is a property of a pair, so it cannot be reviewed by looking at a
 * colour. It also cannot be reviewed by eye: the four pairs that failed here
 * sat between 3.5:1 and 4.4:1, which looks fine and is not.
 *
 * Two traps this pins:
 *
 *   1. The palette is declared in FIVE blocks, not one — light `.page` (the
 *      WXSS mirror) and `:root`, then dark `[data-theme]`, the
 *      prefers-color-scheme media query, and `.theme-dark`. Editing four of
 *      them ships a theme that is broken on exactly one platform.
 *   2. Text on a brand fill must follow the theme. A literal `#fff` is right
 *      in light mode and wrong in dark, where --brand is the light colour and
 *      white lands at 2.9:1.
 */

// ---------------------------------------------------------------- colour math

function channel(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

function parseColor(raw, backdrop) {
  const value = String(raw).trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (!rgba) return null
  const parts = rgba[1].split(',').map(p => Number(p.trim()))
  const [r, g, b] = parts
  const alpha = parts.length > 3 ? parts[3] : 1
  if (alpha === 1) return [r, g, b]
  assert.ok(backdrop, `cannot composite ${value} without a backdrop`)
  return [r, g, b].map((c, i) => Math.round(c * alpha + backdrop[i] * (1 - alpha)))
}

// ------------------------------------------------------------- token blocks

// A theme block is any rule that declares --canvas; that token exists in the
// palette blocks and nowhere else, so the set cannot drift out of this test.
function themeBlocks() {
  // Comments come out first: the prose around these rules quotes CSS at itself
  // (`:root{}` appears inside one of them), so brace-scanning the raw file
  // finds the quote rather than the rule.
  const css = appVue.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = []
  for (const match of css.matchAll(/--canvas:/g)) {
    const open = css.lastIndexOf('{', match.index)
    const selector = css
      .slice(css.lastIndexOf('}', open) + 1, open)
      .replace(/\s+/g, ' ')
      .trim()
    const body = css.slice(open, css.indexOf('\n}', match.index))
    const tokens = new Map()
    for (const decl of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      tokens.set(decl[1], decl[2].trim())
    }
    blocks.push({ selector, tokens })
  }
  return blocks
}

const BLOCKS = themeBlocks()
const LIGHT_ROOT = BLOCKS.find(b => b.selector.endsWith(':root'))
const LIGHT_PAGE = BLOCKS.find(b => b.selector.endsWith('.page') && !b.selector.includes('dark'))
const DARK_ATTR = BLOCKS.find(b => b.selector.includes('[data-theme="dark"]'))
const DARK_MEDIA = BLOCKS.find(b => b.selector.includes(':root:not([data-theme="light"])'))
const DARK_CLASS = BLOCKS.find(b => b.selector.endsWith('.theme-dark'))

function resolve1(tokens, name, seen = new Set()) {
  const raw = tokens.get(name)
  if (raw == null) return null
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(raw)
  if (!ref) return raw
  assert.ok(!seen.has(name), `token cycle at ${name}`)
  return resolve1(tokens, ref[1], new Set([...seen, name]))
}

function rgb(block, name, backdropName) {
  const backdrop = backdropName ? rgb(block, backdropName) : null
  const raw = resolve1(block.tokens, name)
  assert.ok(raw, `${block.selector} does not define ${name}`)
  const parsed = parseColor(raw, backdrop)
  assert.ok(parsed, `${name} in ${block.selector} is not a colour: ${raw}`)
  return parsed
}

// ------------------------------------------------------------------- tests

test('the palette is declared in exactly the five known blocks', () => {
  assert.equal(BLOCKS.length, 5, BLOCKS.map(b => b.selector).join(' | '))
  for (const [label, block] of Object.entries({ LIGHT_ROOT, LIGHT_PAGE, DARK_ATTR, DARK_MEDIA, DARK_CLASS })) {
    assert.ok(block, `${label} block is missing — a theme is now unstyled on some platform`)
  }
})

test('every theme-varying token is declared in all three dark blocks', () => {
  // A token whose light and dark values agree can be omitted from a dark block
  // and simply inherit. One that differs cannot: omitting it leaves the light
  // value in force for whichever platform reads that block.
  const varying = [...LIGHT_ROOT.tokens.keys()].filter(name => {
    const light = resolve1(LIGHT_ROOT.tokens, name)
    const dark = resolve1(DARK_ATTR.tokens, name)
    return dark != null && light !== dark
  })
  assert.ok(varying.length > 20, `expected a real palette, found ${varying.length} varying tokens`)
  for (const name of varying) {
    for (const [label, block] of [['media query', DARK_MEDIA], ['.theme-dark', DARK_CLASS]]) {
      assert.ok(
        block.tokens.has(name),
        `${name} differs between themes but is missing from the ${label} block`,
      )
    }
  }
})

test('the light mirror declares every token :root does', () => {
  for (const name of LIGHT_ROOT.tokens.keys()) {
    assert.ok(LIGHT_PAGE.tokens.has(name), `${name} is missing from the WXSS .page mirror`)
  }
})

/*
 * Alias tokens must resolve to their base in EVERY theme block.
 *
 * --accent-primary and --accent-action held a literal copy of the brand and
 * were declared in no dark block at all, so all 85 call sites painted the
 * light brand on a dark page — and after --brand was corrected for AA, they
 * silently kept the old failing value in light mode too. A copied value is
 * indistinguishable from an alias until the base moves.
 */
const ALIASES = [
  ['--accent-primary', '--brand'],
  ['--accent-primary-soft', '--brand-soft'],
  ['--accent-primary-deep', '--brand-deep'],
  ['--accent-action', '--brand'],
  ['--accent-good', '--success'],
  ['--accent-warn', '--warning'],
  ['--accent-danger', '--danger'],
]

// A dark block overrides only what it declares; every other token keeps the
// light value from the same element's light rule. Merge to get what the
// browser actually computes.
function effective(darkBlock) {
  return { tokens: new Map([...LIGHT_PAGE.tokens, ...darkBlock.tokens]) }
}

test('accent aliases resolve to their base token in every theme', () => {
  const contexts = [
    ['light', LIGHT_PAGE],
    ['dark [data-theme]', effective(DARK_ATTR)],
    ['dark media query', effective(DARK_MEDIA)],
    ['dark .theme-dark', effective(DARK_CLASS)],
  ]
  for (const [label, block] of contexts) {
    for (const [alias, base] of ALIASES) {
      assert.equal(
        resolve1(block.tokens, alias),
        resolve1(block.tokens, base),
        `${label}: ${alias} is ${resolve1(block.tokens, alias)} but ${base} is ${resolve1(block.tokens, base)} — an alias holding a copy stops tracking the moment the base moves`,
      )
    }
  }
})

const SURFACES = ['--canvas', '--surface', '--surface-alt', '--bg-subtle']
const BODY_TEXT = ['--text-primary', '--text-secondary', '--text-tertiary', '--text-muted', '--text-subtle']
const ACCENT_TEXT = ['--brand', '--success', '--danger']

for (const [themeName, block] of [['light', LIGHT_ROOT], ['dark', DARK_ATTR]]) {
  test(`${themeName}: body and accent text clears 4.5:1 on every surface`, () => {
    for (const surface of SURFACES) {
      const bg = rgb(block, surface)
      for (const token of [...BODY_TEXT, ...ACCENT_TEXT]) {
        const ratio = contrast(rgb(block, token, surface), bg)
        assert.ok(
          ratio >= 4.5,
          `${themeName} ${token} on ${surface} is ${ratio.toFixed(2)}:1, below the 4.5:1 needed for normal text`,
        )
      }
    }
  })

  test(`${themeName}: text on a brand fill clears 4.5:1`, () => {
    // --ink-inverse is the only colour that can sit on --brand in both themes:
    // in dark, --brand is the light colour, so white lands at 2.9:1.
    for (const fill of ['--brand', '--success', '--danger']) {
      const ratio = contrast(rgb(block, '--ink-inverse'), rgb(block, fill))
      assert.ok(ratio >= 4.5, `${themeName} --ink-inverse on ${fill} is ${ratio.toFixed(2)}:1`)
    }
  })

  test(`${themeName}: --brand-deep is never the text colour on --brand-soft`, () => {
    // --brand-deep is a fill/border step, not a text-on-tint step: in dark it
    // reads 3.07:1 on --brand-soft. --brand-on-soft exists for this pairing.
    const chip = rgb(block, '--brand-soft', '--surface')
    const ratio = contrast(rgb(block, '--brand-deep'), chip)
    if (ratio >= 4.5) return // if the palette ever makes it safe, stop asserting
    const offenders = []
    const BG = /background(-color)?:\s*[^;]*var\(--brand-soft\)/
    const FG = /color:\s*var\(--brand-deep\)/
    for (const file of vueFiles(srcRoot)) {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      for (const rule of cssRules(source)) {
        if (BG.test(rule.own) && FG.test(rule.full)) {
          offenders.push(`${relative(appRoot, file)}:${source.slice(0, rule.index).split('\n').length} ${rule.selector}`)
        }
      }
    }
    assert.deepEqual(offenders, [], `use var(--brand-on-soft); --brand-deep is ${ratio.toFixed(2)}:1 there in ${themeName}`)
  })

  test(`${themeName}: --campus-blue is never the text colour on --campus-blue-soft`, () => {
    // The same shape as the --brand-deep rule above, for the navy accent. In
    // dark, --campus-blue reads 3.38:1 on its own tint — measured on the chat
    // page's "Set a meetup" control, which the authenticated sweep had never
    // rendered. Darkening the tint cannot close a gap that size, so
    // --campus-blue-on-soft lifts the foreground instead; --campus-blue stays
    // where it is because it is also a fill sitting behind white text.
    const chip = rgb(block, '--campus-blue-soft', '--surface')
    assert.ok(
      contrast(rgb(block, '--campus-blue-on-soft'), chip) >= 4.5,
      `${themeName} --campus-blue-on-soft on --campus-blue-soft is ${contrast(rgb(block, '--campus-blue-on-soft'), chip).toFixed(2)}:1`,
    )

    const ratio = contrast(rgb(block, '--campus-blue'), chip)
    if (ratio >= 4.5) return // if the palette ever makes it safe, stop asserting
    const offenders = []
    const BG = /background(-color)?:\s*[^;]*var\(--campus-blue-soft\)/
    const FG = /color:\s*var\(--campus-blue\)/
    for (const file of vueFiles(srcRoot)) {
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      for (const rule of cssRules(source)) {
        if (BG.test(rule.own) && FG.test(rule.full)) {
          offenders.push(`${relative(appRoot, file)}:${source.slice(0, rule.index).split('\n').length} ${rule.selector}`)
        }
      }
    }
    assert.deepEqual(offenders, [], `use var(--campus-blue-on-soft); --campus-blue is ${ratio.toFixed(2)}:1 there in ${themeName}`)
  })

  test(`${themeName}: the selected sidebar item clears 4.5:1 on its own tint`, () => {
    // --brand itself only reaches 3.97:1 on --brand-soft in light mode, which
    // is why --brand-on-soft exists rather than a darker --brand.
    const chip = rgb(block, '--brand-soft', '--surface')
    const ratio = contrast(parseColor(resolve1(block.tokens, '--brand-on-soft'), chip), chip)
    assert.ok(ratio >= 4.5, `${themeName} --brand-on-soft on --brand-soft is ${ratio.toFixed(2)}:1`)
  })
}

// ------------------------------------------- no literal white on a brand fill

function vueFiles(dir) {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return full.endsWith('.vue') ? [full] : []
  })
}

/*
 * Rules whose fill is genuinely theme-independent, so white is correct in both
 * themes. Keyed by "file selector", not by file: an exemption covering a whole
 * file also hides every unrelated defect in it, which is how detail's .nf-btn
 * ("Browse more items", 2.88:1 in dark) stayed invisible while the file was
 * exempted for two photo-scrim buttons.
 */
const WHITE_ON_FIXED_DARK = new Set([])

/*
 * Every rule, with its own declarations separated from its nested blocks.
 *
 * A naive /\{[^{}]*\}/ matches only innermost braces, so any rule containing a
 * nested SCSS block — nearly every button, they all carry `&:active` — is
 * invisible to it. That blind spot hid `background: var(--accent-primary);
 * color: #fff` on the primary CTA of 22 pages, including "Sign In".
 *
 * The white can also sit one level in (`&.active { background: brand;
 * .label { color: #fff } }`), so the fill is matched against a rule's own
 * declarations while the white is matched against the whole block.
 */
function cssRules(source) {
  const out = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{') continue
    let depth = 1
    let own = ''
    let j = i + 1
    while (j < source.length && depth > 0) {
      const c = source[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (depth === 1) own += c
      if (depth === 1 && c === '}') own += ';' // end of a nested block
      j++
    }
    const head = source.slice(0, i)
    const start = Math.max(head.lastIndexOf('}'), head.lastIndexOf('{'), head.lastIndexOf(';'))
    out.push({
      selector: head.slice(start + 1).trim().replace(/\s+/g, ' '),
      own,
      full: source.slice(i, j),
      index: i,
    })
  }
  return out
}

test('a fixed dark scrim carrying white text clears 4.5:1 over any photo', () => {
  // These badges sit on user-uploaded images, so the backdrop is unknowable
  // and the scrim has to carry the contrast on its own. Pure white is the
  // worst case a photo can present. At the original 0.45 alpha the condition
  // and cover-photo pills read at 3.36:1 over a bright image.
  const SCRIM = /background(-color)?:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/
  const LITERAL_WHITE = /color:\s*(#fff\b|#ffffff\b|white\b)/i
  const failures = []
  for (const file of vueFiles(srcRoot)) {
    const rel = relative(appRoot, file)
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    for (const rule of cssRules(source)) {
      const scrim = SCRIM.exec(rule.own)
      if (!scrim || !LITERAL_WHITE.test(rule.full)) continue
      const alpha = Number(scrim[5])
      const over = [2, 3, 4].map(i => Math.round(Number(scrim[i]) * alpha + 255 * (1 - alpha)))
      const ratio = contrast([255, 255, 255], over)
      if (ratio < 4.5) {
        const line = source.slice(0, rule.index).split('\n').length
        failures.push(`${rel}:${line} ${rule.selector} — ${ratio.toFixed(2)}:1 over a white photo`)
      }
    }
  }
  assert.deepEqual(failures, [], 'raise the scrim alpha; the photo underneath cannot be relied on')
})

test('no rule pairs a literal white with a brand-family fill', () => {
  const BRAND_FILL = /background(-color)?:\s*[^;]*var\(--(brand|danger|success|accent-action|accent-primary|accent-danger|accent-good)\)/
  const LITERAL_WHITE = /color:\s*(#fff\b|#ffffff\b|white\b)/i
  const offenders = []
  for (const file of vueFiles(srcRoot)) {
    const rel = relative(appRoot, file)
    // Comments are blanked rather than removed so reported line numbers stay
    // true to the file.
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    for (const rule of cssRules(source)) {
      if (WHITE_ON_FIXED_DARK.has(`${rel} ${rule.selector}`)) continue
      if (BRAND_FILL.test(rule.own) && LITERAL_WHITE.test(rule.full)) {
        offenders.push(`${rel}:${source.slice(0, rule.index).split('\n').length}  ${rule.selector}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'use var(--ink-inverse); a literal white reads at 2.9:1 in dark mode')
})
