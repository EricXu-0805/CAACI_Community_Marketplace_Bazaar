# BRAND.4 印章稿：字体来源与制作方法

2026-11-13 制作，对应 BACKLOG「BRAND.4」的出稿部分和 SPEC §1.5。三个方案供 Eric 在 D-34 里选一个；选定之前没有替换任何图标文件。

## 文件

| 文件 | 内容 |
|---|---|
| `draft-a.svg`、`draft-a-dark.svg` | 方案 A：单字「玉」，Noto Serif SC Bold |
| `draft-b.svg`、`draft-b-dark.svg` | 方案 B：三字「玉米地」，Noto Serif SC Black，玉在上、米地在下 |
| `draft-b-mono.svg`、`draft-b-mono-dark.svg` | 方案 B 的单字「玉」变体，用于 favicon 和 32px 及以下的位置 |
| `draft-c.svg`、`draft-c-dark.svg` | 方案 C：三字「玉米地」，Noto Sans SC Bold，三字同大 |
| `draft-c-mono.svg`、`draft-c-mono-dark.svg` | 方案 C 的单字「玉」变体，用途同上 |
| `draft-a-24.png`、`draft-a-512.png`，b、c 同名 | 三个方案浅色版的 24px 和 512px 预览，透明底 |
| `draft-b-mono-24.png`、`draft-c-mono-24.png` | 两个单字变体的 24px 预览 |
| `sheet-light.png`、`sheet-dark.png` | 浅色、深色对照图。5 张稿各占一栏：512px 一张，24px 实际大小和 4 倍放大各一张 |

10 个 SVG 里都没有 `<text>`（`grep -c '<text' *.svg` 每个文件都是 0）。

## 字体

字形全部取自 Noto Serif SC 和 Noto Sans SC，授权是 SIL Open Font License 1.1。

| 字体 | 文件 | 版本（字体 name 表） | 用在哪 |
|---|---|---|---|
| Noto Serif SC Bold | `NotoSerifSC-Bold.otf` | Version 2.003;hotconv 1.1.1;makeotfexe 2.6.0 | 方案 A；对照图标题 |
| Noto Serif SC Black | `NotoSerifSC-Black.otf` | 同上 | 方案 B 和它的单字变体 |
| Noto Sans SC Bold | `NotoSansSC-Bold.otf` | Version 2.004;hotconv 1.0.118;makeotfexe 2.5.65603 | 方案 C 和它的单字变体 |
| Noto Sans SC Medium | `NotoSansSC-Medium.otf` | 同上 | 只用于对照图里的说明文字 |

字体文件和授权全文放在 `~/work/illini-dev-env/tools/fonts/`。同目录的 `SHA256SUMS` 可以用 `sha256sum -c` 复核。

### 下载地址和校验值

来源是 Google 与 Adobe 发布的官方仓库 https://github.com/notofonts/noto-cjk 在 release tag 上的文件：

- `Serif2.003` 指向 commit `9b0f1436e455d902de067a2501422e5dc71ad16b`（2024-07-30）
- `Sans2.004` 指向 commit `523d033d6cb47f4a80c58a35753646f5c3608a78`（2022-01-27）

| 文件 | 地址 | 字节数 | sha256 | git blob |
|---|---|---|---|---|
| `NotoSerifSC-Bold.otf` | https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf | 12094336 | `24693d48bdb9152f0a06b02af625638a1097abd6de4010ebba027f6e82710527` | `7d1928abb3f71b0a4a233cce96211d18f878bdf7` |
| `NotoSerifSC-Black.otf` | https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/SubsetOTF/SC/NotoSerifSC-Black.otf | 11862600 | `91dde57622845beeb663f300813999febdb7fcd5e451bde199d7c954a9740cb4` | `6be41fb024a0ed61d76bed1ab99d142bcad6f055` |
| `NotoSansSC-Bold.otf` | https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf | 8543168 | `c6cb5a93abaa9edc8ee7463b7ebb7f42d618d40e6ed2f7a5371c97b0b64767c0` | `bcc11bc30e65b69b9e5a508c3e2138197c5543cf` |
| `NotoSansSC-Medium.otf` | https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/SubsetOTF/SC/NotoSansSC-Medium.otf | 8345436 | `7633f5a016d4dd95e685a69633d818aabc4644c4b08e26bd35b1b30c45ed5dda` | `fafdfebf3103db4dc81d33ebd55b6786e08c9ebe` |
| `LICENSE` | https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/LICENSE | 4301 | `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2` | `d952d62c065f3f35fb83a173496e90b21525aef3` |

`Sans2.004` 上授权文件在仓库根目录（`LICENSE`），和 `Serif2.003` 的 `Serif/LICENSE` 是同一个 blob。

「git blob」一列来自 `git ls-tree <tag>`。对下载到的 5 个文件跑 `git hash-object`，得到的值和这一列相同。

### 下载方式，以及和 release zip 的关系

文件是用 git 经 https 从 github.com 取的，只取这几个文件（部分克隆）：

```bash
git init noto && cd noto
git remote add origin https://github.com/notofonts/noto-cjk.git
git config remote.origin.promisor true
git config remote.origin.partialclonefilter blob:none
git fetch --depth 1 --filter=blob:none --no-tags origin \
  refs/tags/Serif2.003:refs/tags/Serif2.003 refs/tags/Sans2.004:refs/tags/Sans2.004
git cat-file blob Serif2.003:Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf  > NotoSerifSC-Bold.otf
git cat-file blob Serif2.003:Serif/SubsetOTF/SC/NotoSerifSC-Black.otf > NotoSerifSC-Black.otf
git cat-file blob Sans2.004:Sans/SubsetOTF/SC/NotoSansSC-Bold.otf     > NotoSansSC-Bold.otf
git cat-file blob Sans2.004:Sans/SubsetOTF/SC/NotoSansSC-Medium.otf   > NotoSansSC-Medium.otf
git cat-file blob Serif2.003:Serif/LICENSE                            > LICENSE
```

release 页面上的 zip 没有下载。原因：release 资产的下载地址会从 github.com 跳转到 `release-assets.githubusercontent.com`，这个主机不在本次出稿允许访问的主机（github.com、objects.githubusercontent.com、registry.npmjs.org）之内。

对应的 release 资产是：

- https://github.com/notofonts/noto-cjk/releases/download/Serif2.003/14_NotoSerifSC.zip
- https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/18_NotoSansSC.zip

仓库里的发布脚本写明这两个 zip 就是 `SubsetOTF/SC` 目录加 `LICENSE`：`gh-release-noto-cjk-serif.sh` 第 25 行、`gh-release-noto-cjk-sans.sh` 第 31 行（读的是 `Serif2.003` 上的版本）。zip 本身没有下载，所以没有逐字节核对过 zip 里的文件和上表是否相同。允许访问那个主机之后可以这样核对（zip 内的路径以 `unzip -l` 为准）：

```bash
curl -fL -o 14_NotoSerifSC.zip https://github.com/notofonts/noto-cjk/releases/download/Serif2.003/14_NotoSerifSC.zip
unzip -p 14_NotoSerifSC.zip SubsetOTF/SC/NotoSerifSC-Bold.otf | sha256sum
```

### 授权

- SIL Open Font License 1.1，全文见 `tools/fonts/LICENSE`。
- 四个字体文件的 name 表都写着「This Font Software is licensed under the SIL Open Font License, Version 1.1.」。版权行：Serif 是「© 2017-2024 Adobe (http://www.adobe.com/).」，Sans 是「© 2014-2021 Adobe (http://www.adobe.com/).」。商标行：「Noto is a trademark of Google Inc.」。
- 印章 SVG 里只有由字形轮廓转出的 `<path>`，不包含也不分发字体文件。OFL 原文：「The requirement for fonts to remain under this license does not apply to any document created using the fonts or their derivatives.」

## 工具

| 工具 | 版本 | 说明 |
|---|---|---|
| opentype.js | 2.0.0（MIT） | 取字形轮廓。装在 `~/work/illini-dev-env/tools/`，`package.json` 里写死版本。来源 https://registry.npmjs.org/opentype.js/-/opentype.js-2.0.0.tgz ，integrity `sha512-kCyjv6xdDY1W/jLWZ/L3QhhTlKUqDZMQ5+Jdlw12b3dXkKNpYBqqlMMj0YDQPShWFTMwgZI1hG14kN3XUDSg/A==` |
| Node.js | v22.23.5 | 主机和测试镜像里是同一个版本 |
| `tools/seal-glyphs.mjs` | sha256 `bb4d46feb7d4ef8ea9fc2e50d3ccf9ec6936755cf5559cc91a9f68fb511b2287` | 字形转轮廓，套进印章模板，生成预览页 |
| `tools/seal-render.mjs` | sha256 `72ec261ba25006ab144e7c35d89f4d6a999434fe94d3fcc47c5872b40e1ecc99` | 在测试镜像里把预览页渲染成 PNG |
| 测试镜像 | `localhost/illini-dev:pw1.65-node22-pg17`，image id `169f16e69d1e040a0a31c1f9f7c3451a1d320436136c442a2fe383851c236e0b` | 用 podman 5.7.0 运行，`--network none` |
| Chromium | HeadlessChrome/158.0.8127.18 | 镜像自带的 `/ms-playwright/chromium_headless_shell-1254` |

两处和原计划不同：

1. opentype.js 2.0.0 的 `toPathData()` 有个问题：坐标是「整数加一点浮点误差」（例如 51.00000000000001）时会写出 `NaN`。所以 `seal-glyphs.mjs` 只用 opentype.js 取轮廓（`glyph.getPath()`），坐标自己按两位小数写出，遇到非有限数直接报错。
2. 测试镜像里只有浏览器，没有 playwright 这个 npm 包。`seal-render.mjs` 直接启动镜像里的 chrome-headless-shell，通过 DevTools 管道控制，只用 Node 自带模块，没有装新工具。页面报错、图片没加载、PNG 尺寸不对都会让渲染失败；这次渲染 0 条报错。

## 各稿做法

共同部分：

- 模板是生产印章 `app/src/static/logo-mark.svg` 和 `logo-mark-dark.svg`。`seal-glyphs.mjs --check-template` 逐行比对过；另外用 `diff` 比过成品：除了字所在的那一行，10 个 SVG 和对应的生产文件完全相同。圆角方形、内框、四角十字刻线、上下渐变和各处透明度都没动。
- 没有新增颜色。浅色：底板 #F7F4EE，渐变 #D2563A 到 #A8381F。深色：底板 #221D18，渐变 #DD6147 到 #A8381F。刻线 #FBF8F2，字 #FCFAF5。这几个渐变色和品牌色 #B9452C 是同一色相（约 11°），浅色渐变在约 60% 高度处经过 #B9442A。视觉稿 direction-a.html 的上端色是 #C6503A，这里按 SPEC §1.5 沿用生产文件的值。
- 字是一条 `<path fill="#FCFAF5">`，替换原来的 `<text>`。
- 坐标系是印章的 80×80。内框从 11.5 到 68.5，中心 (40, 40)。
- 左右：字的墨迹外框中心对准 x = 40。
- 上下：单字稿沿用生产 `<text>` 的比例定基线，字号 39 时基线 y = 53.5，其他字号按 `40 + 13.5 ÷ 39 × 字号`。这样笔画主体看起来居中。改成墨迹外框居中的话，宋体「玉」明显偏低，因为外框上沿只是第一横右端的小三角。三字稿按整块的墨迹外框中心定位。

| 稿 | 字 | 字体 | 字号 | 基线 y | 墨迹外框 x | 墨迹外框 y | 到内框：左 / 右 / 上 / 下 |
|---|---|---|---|---|---|---|---|
| `draft-a` | 玉 | Noto Serif SC Bold | 39 | 53.5 | 21.94–58.06 | 20.82–54.90 | 10.44 / 10.44 / 9.32 / 13.60 |
| `draft-b` | 玉；米、地 | Noto Serif SC Black | 27；20.5 | 38.94；59.32 | 19.70–60.30 | 15.93–61.27 | 8.20 / 8.20 / 4.43 / 7.23 |
| `draft-b-mono` | 玉 | Noto Serif SC Black | 43 | 54.88 | 19.90–60.10 | 18.25–56.56 | 8.40 / 8.40 / 6.75 / 11.94 |
| `draft-c` | 玉；米、地 | Noto Sans SC Bold | 21；21 | 36.55；56.95 | 19.48–60.52 | 19.96–58.84 | 7.98 / 7.98 / 8.46 / 9.66 |
| `draft-c-mono` | 玉 | Noto Sans SC Bold | 43 | 54.88 | 20.41–59.59 | 20.91–57.25 | 8.91 / 8.91 / 9.41 / 11.25 |

- A：生产印章把「集」换成「玉」，字号、字重、基线都不变，和 direction-a.html 的做法一致。
- B：品字排，玉在上（字号 27），米地在下（字号 20.5，两字的字框相距 0.4），上下两行的字框重叠 0.9。整块墨迹外框的中心在 (40, 38.6)，这样「玉」第一横到内框上沿、「米」的脚到内框下沿都是 7.2。单字变体用字号 43，比 A 大。
- C：品字排，三字同为字号 21。黑体笔画等粗，同字号时三个字的笔画一样粗。米地两字的字框相接，上下两行重叠 0.6，整块墨迹外框的中心在 (40, 39.4)。单字变体用字号 43。
- 其他排法：出稿前渲染过 32 个候选，包括竖排一列、左大右小、大字配小字、上二下一和不同的字重字号。不拉伸字形的前提下只有品字排能填满方形；竖排和左右排留白过大，上二下一头重脚轻。候选图没有放进这个目录。

按轮廓量出的笔画粗细（字体单位，每字 1000），和它在 24px 下折合的像素数：

| 稿 | 横画 | 竖画 | 24px 下横画 | 24px 下竖画 |
|---|---|---|---|---|
| `draft-a`（宋体 Bold，字号 39） | 28–29 | 129 | 约 0.34px | 约 1.5px |
| `draft-b-mono`（宋体 Black，字号 43） | 28 | 160 | 约 0.36px | 约 2.1px |
| `draft-c-mono`（黑体 Bold，字号 43） | 117–118 | 132 | 约 1.5px | 约 1.7px |

Noto Serif SC 的横画从 SemiBold 到 Black 都是 28–29，加粗只加在竖画上。

## 预览怎么出的

```bash
T=~/work/illini-dev-env/tools
node $T/seal-glyphs.mjs --out $OUT --work $WORK \
  --check-template ~/work/illini/app/src/static/logo-mark.svg ~/work/illini/app/src/static/logo-mark-dark.svg
podman run --rm --network none --userns=keep-id -e HOME=/tmp \
  -v $T:/t:ro -v $OUT:/w -v $WORK:/k -w /w \
  localhost/illini-dev:pw1.65-node22-pg17 node /t/seal-render.mjs /k/jobs.json
```

- 第一条命令写出 10 个 SVG 和预览页。第二条在测试镜像里出 8 张 PNG 和 2 张对照图。`$WORK` 是临时目录，深色对照图用到的 5 张深色 24px 图只写在那里。
- PNG 按 1 倍像素渲染，单张预览是透明底。
- 对照图里的说明文字也是转成轮廓画的（标题用 Noto Serif SC Bold，其余用 Noto Sans SC Medium），渲染结果不依赖镜像里装了什么字体。
- 对照图的底色、文字色、描边、圆角、间距取自 App.vue 的 token（`--canvas`、`--ink`、`--ink-soft`、`--ink-quiet`、`--line-soft`、`--radius-md`、`--space-*`），浅色、深色各一套。
- 脚本写完之后重跑过第一条命令，10 个 SVG 和预览页与这里的文件逐字节相同。
- 生产文件被替换之后，`--check-template` 会失败（那时文件里已经没有 `<text>` 行），重跑要去掉这个参数。

## 没做的事

- release zip 没有下载，原因和核对方法见上。
- 没有替换 `logo-mark.svg` 等图标文件，那是 D-34 选定之后的事。
- 只在 Chromium 158 里渲染过。


## 替换（2026-11-13，BRAND.4 ②）

D-34 按 D-43 代定为 B 稿的单字「玉」之后，在 #372（codex/brand-cornfield-20261112，提交 ba070e7）替换：logo-mark.svg、logo-mark-dark.svg（与 draft-b-mono.svg、draft-b-mono-dark.svg 逐字节相同）；app-icon.svg（保留它自己的满版渐变几何，只把字换成同一字体的轮廓）、app-icon-192.png、app-icon-512.png（尺寸与格式不变）；8 个页面里 13 处 `u-thumb-ph-seal` 的「集」改成「玉」。没有单独的 favicon 文件，index.html 的三个 icon 链接就指向上面三个文件；小程序图标在微信后台，不在仓库里。浅色、深色登录页截图：app-logo-light.png、app-logo-dark.png（390×844，2 倍）。
