import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

/*
 * Layout contracts for the surfaces reported on 2026-08-06 (real-device pass).
 *
 * Every assertion here encodes a rule that a plain CSS tweak can silently undo,
 * and each one maps to a defect a user actually saw:
 *   · a multi-image plaza post rendering with dead bands under the short tiles;
 *   · the attached-item card sitting in its own column, indented past the post;
 *   · listings reachable only by swiping a horizontal rail;
 *   · favourite thumbnails letterboxed inside a fixed portrait slot;
 *   · the campus-spot chips bleeding into the screen edge.
 */

const ROOT = new URL('../', import.meta.url)
const read = (rel) => readFile(new URL(rel, ROOT), 'utf8')

test('a multi-image plaza post renders one uniform slot per tile', async () => {
  const plaza = await read('src/pages/plaza/index.vue')

  // Per-image aspect ratios are the ragged-grid bug: a grid row is as tall as
  // its tallest cell, so a landscape tile beside a portrait one leaves a band.
  assert.match(plaza, /function postTileStyle\(post: Post, idx: number\)/)
  assert.match(
    plaza,
    /function postTileStyle[\s\S]{0,320}?if \(\(post\?\.images\?\.length \|\| 0\) > 1\) return \{\}/,
  )
  assert.match(plaza, /:style="postTileStyle\(post, i\)"/)
  assert.doesNotMatch(plaza, /:style="dimsToAspectStyle\(effectiveDims\(post\), i\)"/)

  // mp-weixin honours `mode`; H5 honours `object-fit`. Both halves are needed —
  // WXSS object-fit does not apply to <image>.
  assert.match(plaza, /:mode="post\.images\.length > 1 \? 'aspectFill' : 'aspectFit'"/)
  assert.match(
    plaza,
    /\.post-images\.pi-n2 \.post-image,\s*\n\s*\.post-images\.pi-n3 \.post-image,\s*\n\s*\.post-images\.pi-n4 \.post-image \{[\s\S]{0,160}?aspect-ratio: 1 \/ 1;[\s\S]{0,80}?object-fit: cover;/,
  )

  // The single-image branch keeps the true aspect ratio and never crops.
  assert.match(plaza, /\.post-images\.pi-n1 \{[\s\S]{0,320}?object-fit: contain;/)
})

test('the attached-item card shares the post body column', async () => {
  const plaza = await read('src/pages/plaza/index.vue')
  const detail = await read('src/pages/post/index.vue')

  // Neither the post text nor the image grid is indented past the avatar, so
  // the item card must not be either. 54px left / 14px right was the defect.
  assert.match(plaza, /\.attached-item-card \{\s*\n\s*margin: 10px 0 0 0;/)
  assert.doesNotMatch(plaza, /\.attached-item-card \{\s*\n\s*margin: 8px 14px 0 54px;/)
  assert.match(detail, /\.attached-item-card \{\s*\n\s*margin: 12px 0 0 0;/)
})

test('every profile stat opens the matching full list', async () => {
  const profile = await read('src/pages/profile/index.vue')

  for (const tab of ['listed', 'saved', 'sold']) {
    assert.match(profile, new RegExp(`@click="goMyItems\\('${tab}'\\)"`))
  }
  // 浏览过 keeps its own dedicated page.
  assert.match(profile, /@click="goHistory"/)
  assert.match(profile, /uni\.navigateTo\(\{ url: `\/pages\/my-items\/index\?tab=\$\{tab\}` \}\)/)

  // A horizontal rail with no exit was the complaint; the active tab needs a
  // way out to the grid.
  assert.match(profile, /class="see-all"[\s\S]{0,220}?goMyItems\(myTab === 'sold' \? 'sold' : 'listed'\)/)
})

test('grid thumbnails fill a square slot instead of letterboxing', async () => {
  const profile = await read('src/pages/profile/index.vue')
  const myItems = await read('src/pages/my-items/index.vue')

  for (const [source, wrap, img] of [
    [profile, '.fav-img-wrap', '.fav-img'],
    [myItems, '.card-img-wrap', '.card-img'],
  ]) {
    assert.match(source, new RegExp(`\\${wrap} \\{[\\s\\S]{0,200}?aspect-ratio: 1 / 1;`))
    assert.match(source, new RegExp(`\\${img} \\{[\\s\\S]{0,200}?object-fit: cover;`))
  }
  assert.match(profile, /class="fav-img"\s*\n\s*mode="aspectFill"/)
  assert.match(myItems, /class="card-img"\s*\n\s*mode="aspectFill"/)

  // The measured-aspect helper it replaced must not come back — it fought the
  // fixed slot and produced the empty bands.
  assert.doesNotMatch(profile, /myImgStyleFor|onMyImgLoad|itemImgAspect/)
})

test('the my-items page is routable and account-scoped', async () => {
  // pages.json carries uni-app conditional-compilation comments, so it is not
  // strict JSON — strip the `//` directives before parsing.
  const pagesRaw = await read('src/pages.json')
  const pages = JSON.parse(pagesRaw.replace(/^\s*\/\/.*$/gm, ''))
  const myItems = await read('src/pages/my-items/index.vue')

  assert.ok(
    pages.pages.some((p) => p.path === 'pages/my-items/index'),
    'pages/my-items/index must be registered in pages.json',
  )

  // Same guard the profile page uses: a fetch begun as A must never paint into
  // B after a mid-flight account switch.
  assert.match(myItems, /createAccountPageScope/)
  assert.match(myItems, /const request = pageScope\.begin\(uid\)/)
  assert.match(myItems, /if \(!pageScope\.isCurrent\(request\)\) return/)
  assert.match(myItems, /accountToken: request\.accountToken/)
  assert.match(myItems, /onUnload\(\(\) => \{ pageScope\.dispose\(\) \}\)/)
  // Signed-out deep link must not sit on three permanently empty tabs.
  assert.match(myItems, /uni\.reLaunch\(\{ url: '\/pages\/login\/index' \}\)/)
})

test('campus-spot chips keep the form gutter on both listing flows', async () => {
  for (const rel of ['src/pages/publish/index.vue', 'src/pages/publish/edit.vue']) {
    const source = await read(rel)
    // The rail is a scroll-view outside .form-group, so it has to restore that
    // row's 16px gutter itself. scroll-view is NOT covered by the global
    // `view { box-sizing: border-box }` rule, so without this the leading
    // gutter adds to 100% and the rail renders 16px wider than the screen —
    // measured 406px on a 390px viewport. An ancestor clips the overhang,
    // which silently eats the trailing gutter below.
    assert.match(source, /\.spot-row \{[\s\S]{0,400}?box-sizing: border-box;/)
    assert.match(source, /\.spot-row \{[\s\S]{0,400}?padding: 0 0 8px 16px;/)
    // A scroll container's trailing padding is not honoured everywhere, so the
    // last chip carries the closing gutter.
    assert.match(source, /&:last-child \{ margin-right: 16px; \}/)
    assert.match(source, /\.form-group \{\s*\n\s*padding: 13px 16px;/)
  }
})

test('OpenStreetMap credit stays present but reads as a caption', async () => {
  const attribution = await read('src/components/OsmAttribution.vue')
  // ODbL makes the credit mandatory — smoke/osm-attribution-boundary guards
  // that it is wired in. This guards the visual demotion that replaced the
  // "hide it" request: aligned to the form gutter, underlined only on intent.
  assert.match(attribution, /\.osm-attribution \{[\s\S]{0,220}?margin: 2px 16px 0;/)
  assert.match(attribution, /\.osm-attribution__text \{[\s\S]{0,200}?text-decoration: none;/)
  assert.match(
    attribution,
    /\.osm-attribution:hover \.osm-attribution__text,\s*\n\.osm-attribution:focus-visible \.osm-attribution__text \{\s*\n\s*text-decoration: underline;/,
  )
})

test('the desktop detail page uses the width instead of centring a phone column', async () => {
  const detail = await read('src/pages/detail/index.vue')

  // The rail is position:fixed at the viewport edge, so a centred box that
  // *included* the rail reservation parked ~240px of dead space between the
  // rail and the content. Hug the rail like the other desktop shells.
  assert.match(detail, /\.page \{ max-width: calc\(760px \+ var\(--sidebar-w, 240px\)\); margin: 0; \}/)
  assert.doesNotMatch(detail, /max-width: calc\(640px \+ var\(--sidebar-w, 240px\)\); margin: 0 auto;/)

  // Wide desktop splits into a reading column and a decision column.
  assert.match(detail, /@media \(min-width: 1100px\)/)
  assert.match(detail, /grid-template-columns: minmax\(0, 1fr\) 400px;/)
  assert.match(detail, /\.page > \* \{ grid-column: 2; min-width: 0; \}/)

  // Grid rows are shared between columns, so a second item in column 1 pairs
  // with a column-2 row and stretches it — that opened a ~500px hole under the
  // price card. The gallery spanning every row is what keeps column 2 packed.
  assert.match(detail, /\.img-area \{\s*\n\s*grid-column: 1;\s*\n\s*grid-row: 1 \/ span 99;/)

  // An uncapped 1fr made the gallery 1232px on a 1920 screen. The fixed CTA is
  // out of flow and cannot inherit column 2, so it tracks the same cap.
  assert.match(detail, /--detail-shell: calc\(1180px \+ var\(--sidebar-w, 240px\)\);/)
  assert.match(detail, /max-width: var\(--detail-shell\);/)
  assert.match(
    detail,
    /right: max\(24px, calc\(100vw - var\(--detail-shell\) \+ 24px\)\);/,
  )
})
