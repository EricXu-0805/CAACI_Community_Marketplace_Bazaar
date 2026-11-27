// HOME.1: audit a static HTML page at given widths. One JSON line per width:
// axe color-contrast violations, visible text nodes under 12px, and horizontal
// overflow. Text consisting only of the "·" separator is excluded from both
// counts, as design/README.md「检查」specifies.
// Usage: node page-audit.mjs <url> [--widths 390,1280]
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--widths');
const wi = args.indexOf('--widths');
const widths = (wi >= 0 ? args[wi + 1] : '390,1280').split(',').map(Number);
if (!url) {
  console.error('usage: node page-audit.mjs <url> [--widths 390,1280]');
  process.exit(2);
}

const browser = await chromium.launch();
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ path: AXE });
    const result = await page.evaluate(async () => {
      const separatorOnly = (text) => /^[\s·]*$/.test(text) && text.includes('·');
      const axeResult = await window.axe.run(document, {
        runOnly: { type: 'rule', values: ['color-contrast'] },
      });
      const contrast = axeResult.violations
        .flatMap((v) => v.nodes)
        .filter((n) => {
          const el = document.querySelector(n.target[0]);
          return !(el && separatorOnly(el.textContent || ''));
        });
      const small = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (!text || separatorOnly(text)) continue;
        const el = node.parentElement;
        if (!el || el.getClientRects().length === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const size = parseFloat(style.fontSize);
        if (size < 12) small.push({ text: text.slice(0, 40), size });
      }
      return {
        contrast_violations: contrast.length,
        contrast_samples: contrast.slice(0, 5).map((n) => ({ target: n.target, summary: n.failureSummary })),
        small_text: small.length,
        small_samples: small.slice(0, 5),
        overflow_px: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    });
    console.log(JSON.stringify({ url, width, ...result }));
    await page.close();
  }
} finally {
  await browser.close();
}
