import { test, expect } from '@playwright/test'

/**
 * Contrast as the browser actually paints it.
 *
 * The static token test reasons about CSS text, which leaves it blind to
 * anything the cascade decides: a fill declared on an ancestor, a nested SCSS
 * block, a rule it cannot parse. This walks the rendered DOM instead — for
 * every text node it takes the computed colour, composites the real stack of
 * translucent ancestors behind it, and measures. That is what caught
 * `--accent-primary` painting the light brand on a dark page across 22 routes
 * while every static check was green.
 *
 * Limits worth knowing: it only sees logged-out states, so chat bubbles, offer
 * cards and admin tables are out of reach, and it skips any element whose
 * backdrop is an image (that case is covered by the scrim test in
 * design-token-contrast-boundary.test.mjs).
 */

const PAGES = [
  'pages/index/index','pages/plaza/index','pages/post/index','pages/publish/index',
  'pages/publish/edit','pages/messages/index','pages/profile/index','pages/detail/index',
  'pages/history/index','pages/legal/index','pages/welcome/index','pages/settings/index',
  'pages/seller/index','pages/profile/edit','pages/notifications/index','pages/blocked/index',
  'pages/reset-password/index','pages/illini-verify/index','pages/login/index',
  'pages/following/index','pages/saved-searches/index','pages/search/index',
  'pages/onboarding/index','pages/reconsent/index','pages/profile-recovery/index',
  'pages/suspended/index','pages/admin/index','pages/my-items/index','pages/chat/index',
]

const PROBE = `(() => {
  const px = (s) => parseFloat(s) || 0
  const ch = (c) => { const s = c/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4) }
  const lum = ([r,g,b]) => 0.2126*ch(r) + 0.7152*ch(g) + 0.0722*ch(b)
  const ratio = (a,b) => { const [hi,lo] = [lum(a),lum(b)].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05) }
  const parse = (s) => { const m = /rgba?\\(([^)]+)\\)/.exec(s); if (!m) return null
    const p = m[1].split(',').map(Number); return [p[0],p[1],p[2], p.length>3?p[3]:1] }
  const over = (fg, bg) => [0,1,2].map(i => Math.round(fg[i]*fg[3] + bg[i]*(1-fg[3])))

  const out = []
  for (const el of document.querySelectorAll('*')) {
    const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    if (!direct) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || px(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    const fg = parse(cs.color); if (!fg) continue

    // Walk up for the first opaque background; bail out on an image/gradient,
    // which we cannot sample from CSS.
    let node = el, bg = null, stack = [], imaged = false
    while (node && node !== document.documentElement.parentNode) {
      const s = getComputedStyle(node)
      if (s.backgroundImage && s.backgroundImage !== 'none') { imaged = true; break }
      const c = parse(s.backgroundColor)
      if (c && c[3] > 0) { if (c[3] >= 0.999) { bg = c; break } stack.push(c) }
      node = node.parentElement
    }
    if (imaged || !bg) continue
    let base = [bg[0],bg[1],bg[2]]
    for (const layer of stack.reverse()) base = over(layer, base)
    const fgc = fg[3] >= 0.999 ? [fg[0],fg[1],fg[2]] : over(fg, base)

    const size = px(cs.fontSize), weight = parseInt(cs.fontWeight) || 400
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = large ? 3.0 : 4.5
    const got = ratio(fgc, base)
    if (got >= need) continue
    out.push({
      cls: (el.className && String(el.className).split(/\\s+/).filter(Boolean).slice(0,3).join('.')) || el.tagName.toLowerCase(),
      text: el.textContent.trim().slice(0, 28),
      ratio: Math.round(got*100)/100, need, size, weight,
      fg: cs.color, bg: 'rgb(' + base.join(',') + ')',
    })
  }
  return out
})()`

// The theme must be driven through the app's own `theme_pref` storage, not by
// setting html[data-theme] directly: useTheme installs a MutationObserver that
// restores the attribute, so a directly-set dark pass silently measures light.
for (const theme of ['light','dark']) {
  test(`runtime contrast sweep (${theme})`, async ({ page }) => {
    test.setTimeout(900_000)
    const all: any[] = []
    await page.addInitScript((t) => {
      localStorage.setItem('welcomed','1'); localStorage.setItem('lang','en')
      localStorage.setItem('theme_pref', t)
    }, theme)
    for (const route of PAGES) {
      await page.goto(`/#/${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(350)
      const found = await page.evaluate(PROBE)
      for (const f of found as any[]) all.push({ route, theme, ...f })
    }
    const report = all.map(f =>
      `${f.route} ${f.cls} — ${f.ratio}:1 (needs ${f.need}) ${f.fg} on ${f.bg}, ${f.size}px/${f.weight} "${f.text}"`)
    expect([...new Set(report)], `contrast failures in ${theme}:\n${[...new Set(report)].join('\n')}`).toEqual([])
  })
}
