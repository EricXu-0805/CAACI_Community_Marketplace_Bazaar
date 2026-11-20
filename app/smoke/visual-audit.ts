import { existsSync } from 'node:fs'
import type { Page } from '@playwright/test'

/*
 * The in-repo half of the visual acceptance in SPEC 9.6 (BACKLOG 0.3). Not a
 * spec: the specs of visual tasks call it on the page they have open.
 *
 * It counts visible text set under 12px (digits inside .u-badge excepted),
 * measures the page's horizontal overflow, and checks contrast twice: with the
 * algorithm of contrast-runtime.spec.ts, and with axe-core where that is
 * mounted. axe-core is not a repo dependency (STOP-8). run-checks mounts the
 * workstation copy read-only at /dev-env; without it (CI) the axe half is
 * skipped and the log says so.
 */

const AXE = [process.env.AXE_CORE_PATH, '/dev-env/tools/node_modules/axe-core/axe.min.js']
  .find((path): path is string => !!path && existsSync(path))

/** `include` is one root; subtrees matching `exclude` are left out. */
export interface AuditScope { include: string; exclude?: string[] }
export interface VisualAudit {
  /** Visible text nodes with a computed font-size under 12px. */
  small: { text: string; size: number }[]
  /** Horizontal overflow of the document, in px. */
  overflow: number
  /** Text below 4.5:1 (3:1 when large), measured as contrast-runtime.spec.ts does. */
  contrast: string[]
  /** axe color-contrast violations; null when axe-core is not mounted. */
  axe: string[] | null
}

export async function visualAudit(page: Page, label: string, scope: AuditScope): Promise<VisualAudit> {
  const measured = await page.evaluate(({ include, exclude }) => {
    const root = document.querySelector(include)
    const outside = (el: Element | null) => !el || !root || !root.contains(el) || exclude.some(selector => !!el.closest(selector))

    const small: { text: string; size: number }[] = []
    if (!root) small.push({ text: `missing ${include}`, size: 0 })
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); root && node; node = walker.nextNode()) {
      const text = (node.textContent || '').trim()
      const parent = node.parentElement
      if (!text || !parent || outside(parent) || parent.getClientRects().length === 0) continue
      const style = getComputedStyle(parent)
      if (style.visibility === 'hidden' || style.display === 'none') continue
      if (/^\d+$/.test(text) && parent.closest('.u-badge')) continue
      const size = parseFloat(style.fontSize)
      if (size < 12) small.push({ text: text.slice(0, 40), size })
    }

    // Same measurement as contrast-runtime.spec.ts: the computed colour over the
    // real stack of translucent ancestors, skipping anything painted on an image.
    const px = (value: string) => parseFloat(value) || 0
    const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
    const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    const parse = (value: string) => {
      const match = /rgba?\(([^)]+)\)/.exec(value)
      if (!match) return null
      const parts = match[1].split(',').map(Number)
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
    }
    const over = (fg: number[], bg: number[]) => [0, 1, 2].map(i => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])))
    const contrast: string[] = []
    for (const el of root ? [...root.querySelectorAll('*')] : []) {
      if (outside(el)) continue
      if (![...el.childNodes].some(node => node.nodeType === 3 && (node.textContent || '').trim())) continue
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none' || px(style.opacity) === 0) continue
      const box = el.getBoundingClientRect()
      if (box.width < 2 || box.height < 2) continue
      const fg = parse(style.color)
      if (!fg) continue
      let node: Element | null = el, bg: number[] | null = null, imaged = false
      const stack: number[][] = []
      while (node) {
        const layer = getComputedStyle(node)
        if (layer.backgroundImage && layer.backgroundImage !== 'none') { imaged = true; break }
        const colour = parse(layer.backgroundColor)
        if (colour && colour[3] > 0) { if (colour[3] >= 0.999) { bg = colour; break } stack.push(colour) }
        node = node.parentElement
      }
      if (imaged || !bg) continue
      let base = [bg[0], bg[1], bg[2]]
      for (const layer of stack.reverse()) base = over(layer, base)
      const ink = fg[3] >= 0.999 ? [fg[0], fg[1], fg[2]] : over(fg, base)
      const size = px(style.fontSize), weight = parseInt(style.fontWeight) || 400
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5
      const got = ratio(ink, base)
      if (got >= need) continue
      contrast.push(`${String(el.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.') || el.tagName.toLowerCase()}`
        + ` ${Math.round(got * 100) / 100}:1 (needs ${need}) ${style.color} on rgb(${base.join(',')}) "${(el.textContent || '').trim().slice(0, 28)}"`)
    }
    return { small, contrast, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  }, { include: scope.include, exclude: scope.exclude || [] })

  let axe: string[] | null = null
  if (AXE) {
    if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE })
    axe = await page.evaluate(async ({ include, exclude }) => {
      const result = await (window as any).axe.run(
        { include: [[include]], exclude: exclude.map(selector => [selector]) },
        { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] },
      )
      return result.violations.flatMap((rule: any) =>
        rule.nodes.map((node: any) => `${node.target.join(' ')}: ${node.failureSummary.replace(/\s+/g, ' ')}`))
    }, { include: scope.include, exclude: scope.exclude || [] })
  }

  console.log(`AUDIT ${label} small=${measured.small.length} overflow=${measured.overflow}px`
    + ` contrast=${measured.contrast.length} axe=${axe ? axe.length : 'skipped'}`)
  console.log(axe
    ? `AXE color-contrast violations=${axe.length} (${label})`
    : `AXE color-contrast skipped: axe-core is not mounted (${label})`)
  if (measured.small.length) console.log(`  text under 12px: ${JSON.stringify(measured.small.slice(0, 8))}`)
  if (measured.contrast.length) console.log(`  contrast: ${measured.contrast.slice(0, 8).join(' | ')}`)
  if (axe?.length) console.log(`  axe: ${axe.slice(0, 8).join(' | ')}`)
  return { ...measured, axe }
}
