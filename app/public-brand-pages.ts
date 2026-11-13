import type { Plugin } from 'vite'
import { PRIVACY_EN } from './src/legal/privacy.en'
import { PRIVACY_ZH } from './src/legal/privacy.zh'
import { TERMS_EN } from './src/legal/terms.en'
import { TERMS_ZH } from './src/legal/terms.zh'

// Public, script-free pages for people and OAuth reviewers. Legal text comes
// from the same versioned source as the in-app consent screen.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!))

const css = `
:root{color-scheme:light;--paper:#f7f4ee;--ink:#24231f;--muted:#68635c;--line:#ddd7cc;--accent:#a84d31}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--accent);text-underline-offset:4px}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px;border-radius:4px}
.wrap{width:min(1100px,100% - 48px);margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 0;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--ink);font-size:20px;font-weight:700}.brand img{width:44px;height:44px}.brand small{display:block;font-size:11px;font-weight:500;letter-spacing:.1em;color:var(--muted)}.formerly{font-size:12px;color:var(--muted);margin:-12px 0 24px}
nav{display:flex;flex-wrap:wrap;gap:12px 22px;font-size:14px}h1,h2,h3,p{margin-top:0}h1{font-size:clamp(34px,6vw,66px);line-height:1.1;letter-spacing:-.035em;max-width:850px;margin-bottom:24px}h2{font-size:28px;line-height:1.3}h3{font-size:20px;line-height:1.4;margin-bottom:10px}
.hero{padding:72px 0 54px}.eyebrow{color:var(--accent);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;margin-bottom:20px}.lead{max-width:740px;font-size:21px;color:var(--muted)}.button{display:inline-block;border-radius:999px;background:var(--accent);color:white;padding:13px 26px;text-decoration:none;font-weight:650;margin-top:10px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin:0 0 56px}.card{padding:26px;border:1px solid var(--line);border-radius:18px;background:#fffdf8}.number{display:block;color:var(--accent);font-size:13px;margin-bottom:18px}.card p{margin-bottom:0;color:var(--muted);font-size:16px}
.info{max-width:820px;margin:0 0 46px}.info p{color:var(--muted)}.divider{border-top:1px solid var(--line);padding-top:42px}section[id]{scroll-margin-top:25px}.doc{max-width:840px;margin:48px auto}.doc h1{font-size:42px}.legal-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.85}.language-links{margin:0 0 32px}.back{display:inline-block;margin-bottom:24px}
.channel-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:24px 0 46px}.channel{display:block;padding:22px 24px;border:1px solid var(--line);border-radius:16px;background:#fffdf8;text-decoration:none;color:var(--ink);transition:border-color .15s,background .15s}.channel:hover{border-color:var(--accent);background:#fff}.channel strong,.channel span{display:block}.channel strong{font-size:19px}.channel span{color:var(--muted);font-size:15px;margin-top:6px}.channel small{display:block;color:var(--accent);font-size:13px;margin-top:12px;overflow-wrap:anywhere}
footer{border-top:1px solid var(--line);padding:26px 0 36px;color:var(--muted);font-size:13px}footer p{margin:14px 0 0}footer nav{font-size:13px}
@media(max-width:650px){.wrap{width:calc(100% - 32px)}header{align-items:flex-start;flex-wrap:wrap;padding:18px 0}.hero{padding:42px 0 32px}.lead{font-size:18px}.grid{grid-template-columns:1fr;gap:12px;margin-bottom:36px}.card{padding:20px}.number{margin-bottom:10px}.doc{margin-top:32px}.doc h1{font-size:34px}.brand{font-size:18px}nav{gap:10px 18px}}
@media(max-width:650px){.channel-list{grid-template-columns:1fr}.channel{padding:18px 20px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.channel{transition:none}}
`

function document(title: string, body: string, page: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Cornfield 玉米地</title>
<meta name="description" content="Cornfield (玉米地) is a forum for the Chinese community in Illinois, now open in Champaign-Urbana. Learn how the service and Google sign-in work.">
<link rel="canonical" href="https://www.illinimarket.com/${page}"><link rel="icon" href="/static/app-icon.svg" type="image/svg+xml"><style>${css}</style></head>
<body><div class="wrap"><header><a class="brand" href="/about"><img src="/static/app-icon.svg" width="44" height="44" alt=""><span>Cornfield<small lang="zh">玉米地</small></span></a><nav aria-label="Main navigation"><a href="/">Browse marketplace</a><a href="/community">Community &amp; contact</a><a href="/${page}#zh" lang="zh">中文</a></nav></header>
<main>${body}</main>
<footer><nav aria-label="Legal and support"><a href="/about">About</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/account-deletion">Delete your account</a><a href="mailto:help@illinimarket.com">Contact support</a></nav><p>Cornfield · 玉米地 · illinimarket.com<br>A community project operated by Guoyi (Eric) Xu. Not an official University of Illinois service.</p></footer></div></body></html>`
}

// These are the developer's confirmed profiles, not separate branded company
// accounts. Do not add a guessed handle or a temporary creator-console URL.
const developerChannels = [
  {name:'Reddit',handle:'u/Fun_Maintenance_3445',url:'https://www.reddit.com/user/Fun_Maintenance_3445/'},
  {name:'X',handle:'@guoyi_eric_xu',url:'https://x.com/guoyi_eric_xu'},
]
function channelCard(url: string, title: string, description: string, label: string) {
  return `<a class="channel" href="${escapeHtml(url)}" rel="noreferrer"><strong>${escapeHtml(title)} ↗</strong><span>${escapeHtml(description)}</span><small>${escapeHtml(label)}</small></a>`
}
function developerCards(chinese: boolean) {
  return developerChannels.map(channel => channelCard(channel.url, channel.name,
    channel.name === 'X'
      ? (chinese ? 'Eric 的个人账号；查看帖子可能需要关注批准。' : 'Eric’s personal profile. Viewing posts may require follower approval.')
      : (chinese ? 'Eric 的个人账号，参与社区讨论和收集产品反馈。' : 'Eric’s personal profile for community conversations and product feedback.'),
    channel.handle)).join('')
}
const community = document('Community & contact', `
<section class="hero"><p class="eyebrow">Cornfield · Community</p><h1>A local find.<br>A familiar face.</h1><p class="lead">Buy, sell and ask around UIUC and Champaign-Urbana. Here’s where to find the marketplace, follow the conversation and tell us what could work better.</p><a class="button" href="/">Browse the marketplace →</a></section>
<section aria-labelledby="community-heading"><h2 id="community-heading">Around the community</h2><div class="channel-list">${channelCard('/#/pages/plaza/index','Community Plaza','Read community posts or share something useful.','Open the Plaza')}${channelCard('https://caaciorg.com/','CAACI','Local activities and resources from the Chinese American Association of Central Illinois.','caaciorg.com')}</div></section>
<section aria-labelledby="developer-heading"><h2 id="developer-heading">Talk to the builder</h2><p>Hi, I’m Eric. If something feels awkward or doesn’t work, I’d like to hear about it. These are my personal profiles.</p><div class="channel-list">${developerCards(false)}</div></section>
<section class="info"><h2>Need help with your account?</h2><p>Email <a href="mailto:help@illinimarket.com">help@illinimarket.com</a>. For a bug, include the page, device and what happened. Please don’t post passwords, login codes or private conversations in public comments.</p><h3>Looking for the WeChat mini program?</h3><p>It is still being prepared. The website is available now; we’ll add the official mini-program entry here after release.</p></section>
<section id="zh" lang="zh" class="divider"><p class="eyebrow">玉米地 · 社区</p><h2>附近淘好物，也认识身边的人。</h2><p class="lead">服务 UIUC 及香槟地区华人的论坛。在这里找到入口、看看社区动态，也欢迎告诉我们哪里还不够好用。</p><a class="button" href="/">去逛逛 →</a><h3 style="margin-top:36px">社区入口</h3><div class="channel-list">${channelCard('/#/pages/plaza/index','社区广场','看看大家的动态，或者分享一件有用的小事。','打开广场')}${channelCard('https://caaciorg.com/zh/','CAACI 华人协会','查看伊利诺伊中部华人协会的本地活动与社区资源。','caaciorg.com')}</div><h3>直接和开发者聊聊</h3><p>我是 Eric。哪里别扭、点了没反应，都可以告诉我。下面是我的个人账号。</p><div class="channel-list">${developerCards(true)}</div><div class="info"><h3>账号问题与故障反馈</h3><p>请联系 <a href="mailto:help@illinimarket.com">help@illinimarket.com</a>，说明页面、设备和发生的情况。不要把密码、登录验证码或私人聊天内容发到公开评论里。</p><h3>微信小程序呢？</h3><p>还在准备中，目前可以直接用网站。小程序正式发布后，会在这里加上官方入口。</p></div></section>`, 'community')

const about = document('About', `
<section class="hero"><p class="eyebrow">Cornfield · Chinese community in Illinois</p><h1>A new home for<br>your next good find.</h1>
<p class="formerly">Cornfield (formerly Illini Market)</p>
<p class="lead">Cornfield is a forum for the Chinese community around UIUC and Champaign-Urbana, with a local, peer-to-peer market. Browse secondhand items, post what you need, and talk directly with people in the community.</p><a class="button" href="/">Explore the marketplace →</a></section>
<section class="grid" aria-label="What you can do"><article class="card"><span class="number">01 / BUY &amp; SELL</span><h2>Find it nearby.</h2><p>Browse listings by category, check photos and details, or publish an item you no longer need.</p></article><article class="card"><span class="number">02 / ASK &amp; CONNECT</span><h2>Start a conversation.</h2><p>Post a wanted listing or contact a seller from a listing or their profile. Discuss condition, price and pickup in private messages.</p></article><article class="card"><span class="number">03 / COMMUNITY</span><h2>See what’s happening.</h2><p>Share a post in the Plaza, add photos, and keep up with people you follow.</p></article></section>
<section class="info"><h2>What Google sign-in does</h2><p>Google sign-in is an optional way to sign in to Cornfield at <strong>illinimarket.com</strong>. Google shares your account identifier, email address and basic profile information with our authentication provider, Supabase, to create or sign in to your marketplace account. Cornfield does not receive your Google password or request access to read your Gmail messages, Google Drive files or contacts.</p><p>You can also use email and password. For details about data use and account deletion, read our <a href="/privacy">Privacy Policy</a> and <a href="/account-deletion">account deletion guide</a>.</p></section>
<section class="info"><h2>Before you make a deal</h2><p>Buyers and sellers arrange their own transactions. Cornfield does not process payments, hold money in escrow, ship items or guarantee listings. Meet in a public place, inspect the item and agree on the details before paying.</p></section>
<section id="zh" lang="zh" class="info divider"><p class="eyebrow">玉米地 · 伊利诺伊华人论坛</p><h2>闲置找个新主人，想要的东西在附近找。</h2>
<p class="formerly">玉米地（原 Illini Market）</p>
<p>玉米地是服务 UIUC 及香槟地区华人的论坛，也有本地二手区。你可以按分类逛商品、发布闲置或求购，也可以从商品页或卖家主页发起私信，商量成色、价格和取货时间。广场可以发动态、配照片，看看社区里的新鲜事。</p><h3>Google 授权是在登录哪个网站？</h3><p>授权对象是玉米地（Cornfield），网址是 <strong>illinimarket.com</strong>。Google 登录是可选的：Google 会向我们的身份验证服务 Supabase 提供账号标识、邮箱和基本个人资料，用来创建或登录玉米地账号。我们不会收到你的 Google 密码，也不申请读取 Gmail 邮件、Google Drive 文件或联系人的权限。你也可以使用邮箱和密码登录。</p><p>平台不代收款、不托管资金、不寄送或担保商品。请在公共场所面交，验货后再付款。数据如何使用、如何删除账号，可以查看<a href="/privacy#zh">隐私政策</a>、<a href="/terms#zh">服务条款</a>及<a href="/account-deletion">注销指引</a>。</p><a class="button" href="/">去逛逛 →</a></section>`, 'about')

function legal(title: string, zhTitle: string, english: string, chinese: string, page: string) {
  return document(title, `<article class="doc"><a class="back" href="/about">← About Cornfield</a><h1>${escapeHtml(title)}</h1><nav class="language-links" aria-label="Document language"><a href="#en">English</a><a href="#zh" lang="zh">中文</a></nav><section id="en" aria-label="${escapeHtml(title)} in English"><div class="legal-body">${escapeHtml(english.trim())}</div></section><section id="zh" lang="zh" class="divider"><h2>${escapeHtml(zhTitle)}</h2><div class="legal-body">${escapeHtml(chinese.trim())}</div></section></article>`, page)
}

export function publicBrandPages(): Plugin {
  const pages: Record<string, string> = {
    '/about': about,
    '/community': community,
    '/privacy': legal('Privacy Policy', '隐私政策', PRIVACY_EN, PRIVACY_ZH, 'privacy'),
    '/terms': legal('Terms of Service', '服务条款', TERMS_EN, TERMS_ZH, 'terms'),
  }
  return {
    name: 'public-brand-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0].replace(/\/$/, '')
        const html = pages[pathname]
        if (!html || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(req.method === 'HEAD' ? undefined : html)
      })
    },
    generateBundle() {
      for (const [route, source] of Object.entries(pages)) {
        this.emitFile({ type: 'asset', fileName: `static/h5${route}.html`, source })
      }
    },
  }
}
