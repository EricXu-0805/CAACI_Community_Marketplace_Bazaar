# P4.7 第一步：UIUC 官方日历 feed 调研

请求日期：2026-11-13（America/Chicago，请求在当地 01:13 前后，服务器 `Date` 头为 2026-11-13 07:13 GMT）。
方法：只请求官方文档页和官方导出地址，每个地址最多一次；没有抓任何活动列表 HTML，没有用 key，没有 POST。
说明：这份文件只写事实和风险，不替 Eric 选 D-33。

先说结论里最要紧的一条：**整本日历的 ICS 导出地址，我没有在官方文档里找到**。我试了一个猜的格式（`/ical/{id}.ics`），三个都是 404。要拿到整本导出的地址，只能去看日历页面的订阅链接（HTML），按规则写作「只有抓 HTML 才拿得到，未取」。所以本文件里 7、3715 整本的大小和条数，这次没有重新测，沿用 ENGINEERING §9.3 的 2026-11-12 数字并标明。

## 1. 可用的 feed 格式与地址

| 格式 | 地址 | 要 key 吗 | 来源和说明 |
|---|---|---|---|
| 单条活动 ICS | `https://calendars.illinois.edu/icalGmail/{calendarId}/{eventId}.ics?hourOffset=0&timeZone=America%2FChicago` | 不要（本次请求没带任何凭据，200） | 2026-11-13 实测，见 §6 请求记录第 4 行；地址格式来自 ENGINEERING §9.3，官方文档里没找到这个格式的书面说明 |
| 整本日历 ICS | 地址未找到 | 未知 | 猜的 `https://calendars.illinois.edu/ical/{id}.ics` 返回 404（7、3715、5749 各一次）。ENGINEERING §9.3 说 11-12 测过整本导出，但没记地址。只有看日历页订阅链接（HTML）才拿得到：「只有抓 HTML 才拿得到，未取」 |
| XML | `https://xml.calendars.illinois.edu/eventXML18/{calendarId}.xml?key=...`（可加 `startDate`、`endDate`、`search`、`searchEventType`、`pageNumber`） | **要**。向 Illinois Web Services 申请，Webtools 页面底部的 Contact Us 表单，写明要 XML 日历权限并给服务账号邮箱，对方用 PEAR 消息发 key | 官方 FAQ：https://blogs.illinois.edu/view/6291/437291 （2026-11-13 请求，200，54,820 字节） |
| XML 架构 | `https://xml.calendars.illinois.edu/calendarws18.xsd`（当前版本 v18） | 页面里列出，本次未请求 | 同一个 FAQ：v18 为当前版本；v17「2026/11/1 后不再支持」；v16「2026/3/1 后不再支持」；v15「2022/8/1 后不再支持」。每个 XML 响应带 `/responseWS/deprecated` 和 `/responseWS/endOfServiceDate`（到期日起返回 404） |
| RSS | 未找到 | 未知 | 官方文档里没有提到 RSS |
| JSON API | 未找到 | 未知 | 文档里没有提到。搜索结果里出现的 `api.rokwire.illinois.edu`（Illinois App 的接口文档）本次没有请求 |
| 小程序/小组件（Web Services 预制 widget） | 文档说有，地址未取 | 未知 | FAQ 说 widget 是官方推荐的展示方式，XML 是动态拉取、服务器成本更高 |

XML 额外限制（同一个 FAQ 页）：
- 同时请求数有上限，超出时返回 HTTP 503 和一段消息。
- 每次只返回有限条数；`/responseWS/maxPageSize` 给出上限，返回条数少于 maxPageSize 就是最后一页，否则 `pageNumber` 加一。
- 变更通知通过 CCSP 邮件列表发布，目标是提前六周。

## 2. 使用条款或使用说明

- 「日历 feed 能不能在第三方站点展示」的书面条款：**未找到**。
- 最接近的官方书面说法，是上面 FAQ 里的这两句（英文原文）：
  - 「We recommend entering events into our Calendar system and then using the XML data feeds to pull them into other systems.」意思是官方鼓励把 XML 当作把日历事件拉进其他系统的办法。它说的是 XML（要 key），没有谈公开 ICS，也没有谈第三方站点的展示条件。
  - 「Can events be imported into the Calendar? No.」这是反过来的方向（往校历里导入），与我们无关，只作背景记录。
- 来源：https://blogs.illinois.edu/view/6291/437291 （2026-11-13，200）。
- 尝试过的另一个官方页 `https://illinois.edu/about/calendars/`（想找日历目录和使用说明）：2026-11-13 请求时证书验证失败（curl 错误 60，未拿到 HTTP 响应，0 字节）。按"每个地址最多一次"没有再试，也没有关闭证书验证。这页的内容**未取**。
- 单条 ICS 的响应头带 `Access-Control-Allow-Origin: *`，只说明服务端允许跨域读取，不是使用许可。

## 3. 候选日历清单

「每周条数估计」这一栏：整本导出这次没拿到，所以没有重新估。下面的数字是 2026-11-12 的旧值，按 ENGINEERING §9.3 转抄，标了「沿用 11-12，未重测」。

| 日历 ID | 名称 | feed 地址 | 导出大小 | 每周条数估计 |
|---|---|---|---|---|
| 7 | General Events（综合日历） | 整本 ICS：未找到。XML：`https://xml.calendars.illinois.edu/eventXML18/7.xml?key=...`（要 key，FAQ 示例用的就是 7） | 沿用 11-12，未重测：约 2.2 MB，1,533 条 | 未估。只能说：11-12 的数字是整本 1,533 条，其中一场跨天展览按天拆成 92 条；整本的时间跨度没记录，所以不能换算成每周条数 |
| 3715 | ISSS（国际学生办公室，Illinois International） | 整本 ICS：未找到。XML：`.../eventXML18/3715.xml?key=...` | 沿用 11-12，未重测：46 条（字节数没记录） | 沿用 11-12，未重测：11 月 12 日到 12 月 14 日这约 4.5 周里有 22 条，其中 14 条是咨询时段或学期日期，约每周 5 条，其中约 3 条是噪声。（估法：22 ÷ 约 4.5 周；跨度短，不外推） |
| 852 | 含系列活动 `33560645` 的日历，名称未取 | 单条地址 `.../icalGmail/852/33560645.ics...` 本次未请求 | 沿用 11-12：该系列 92 个 VEVENT，150,535 字节 | 不适用（这是单个系列，不是整本） |
| 5749 | Illinois Events（来自搜索结果，页面标题） | 整本 ICS：猜的 `/ical/5749.ics` 返回 404。其余未取 | 未取 | 未取 |

说明：
- 7、3715 两个 ID 的名称来自 ENGINEERING §9.3、SPEC 6.7.11 和官方页面标题（搜索结果摘要里的 `General Events - calendars.illinois.edu`）。
- 官方文档里没找到公开的"日历目录"。5749 只是搜索结果里出现的标题为 Illinois Events 的日历页，是否适合候选，没有别的证据，只作记录。
- 单个示例事件（3715/33558080，International Thanksgiving Dinner）的确认值见 §5。

## 4. 被撤下或取消的活动在 feed 里表现为什么（ENGINEERING §13 缺口 8）

**未知。** 官方 FAQ 没写。本次也没有拿到被撤下的活动来观察。
已知的几条旁证，只是事实，不推出结论：
- 不存在的活动 id，单条地址返回 404，`text/html`（ENGINEERING §9.3 的 11-12 实测；本次没有重测）。这能说明"不存在的 id"，不能说明"被撤下的 id"和它是不是同一种表现。
- 本次拿到的单条 ICS（3715/33558080）没有 `STATUS` 属性（见 §5）。一个样本，不能说明被取消的活动会不会出现 STATUS。ENGINEERING 说日历 7、3715、852 里都没有 STATUS。
- FAQ 说每个 XML 响应带 `deprecated` 和 `endOfServiceDate`，那是接口版本，不是活动状态。

## 5. 本次拿到的单条 ICS（3715/33558080）的字段

2026-11-13 请求，200，`text/calendar;charset=UTF-8`，1,359 字节，一个 VEVENT：
- `PRODID:-//University of Illinois//Web Services Calendar//EN`
- `DTSTART:20261120T113000`、`DTEND:20261120T133000`（不带参数的浮动时间），另有一行不合标准位置的 `TZID:America/Chicago`
- `SUMMARY`、`LOCATION`（Latzer Hall, University YMCA）、`CATEGORIES:Festival/Celebration`
- `CREATED`、`LAST-MODIFIED:20261013T060000Z`、`DTSTAMP` 是请求时间
- `UID:33558080@illinois.edu`
- `CONTACT`（部门名）、`ORGANIZER`（个人邮箱格式的地址）、`URL`（带 key 参数的 http 地址）、`DESCRIPTION`（含报名要求）
- 没有 `STATUS`
- 响应头：`Content-Type: text/calendar;charset=UTF-8`，`Access-Control-Allow-Origin: *`

## 6. 两种接入方式的条数与风险

**A 逐条收录**（站务贴单条活动链接，服务端只读这一条的日历文件）
- 条数：由站务挑，按 SPEC「全部」视图每周最多 10 条的上限就足够；单条请求 1,359 字节量级（本次样本）。
- 事实：单条 ICS 地址不要 key，本次实测 200。
- 风险：
  1. 单条地址格式在官方文档里没有书面说明（只有实测），格式变了就会失效。
  2. 使用条款没找到书面说法（§2）。
  3. 活动被撤下后单条地址返回什么，未知（§4）；ENGINEERING §9.3 的撤下判断依赖 404，这一点没有验证。
  4. 每个活动要站务手动贴链接，人工量随活动数增长。
  5. ICS 里有个人邮箱（ORGANIZER）和带 key 的 URL，要丢弃，不进库。

**B 按选定日历整本同步**（导出 ≤1 MB，配排除规则）
- 条数：沿用 11-12，未重测：7 为 1,533 条、约 2.2 MB，超 1 MB；3715 为 46 条，其中 11-12 到 12-14 期间 22 条里有 14 条是咨询时段或学期日期（需要排除规则）。
- 风险：
  1. 整本导出的 ICS 地址我没找到（§1），没有官方文档可以引用；只有看订阅链接（HTML）才能拿到，按规则没取。拿不到官方地址，B 就没法开工。
  2. 整本导出的大小在 11-12 只量了 7（约 2.2 MB）；3715 的字节数没记录，是否 ≤1 MB 没有重新确认。
  3. 官方推荐的整本拉取方式是 XML，要 key（FAQ），且有并发上限，超限返回 503。
  4. 使用条款没找到书面说法（§2）。
  5. 噪声大：咨询时段、学期日期、展览按天拆分（11-12 实测）。
  6. 撤下表现未知（§4），对账靠"连续两次导出都缺席"的假设。

## 7. 与 ENGINEERING §9.3 的差异

| 项目 | 2026-11-12（§9.3） | 2026-11-13（本次） | 差异 |
|---|---|---|---|
| 单条 ICS `3715/33558080` | 200，`text/calendar`，1,359 字节 | 200，`text/calendar;charset=UTF-8`，1,359 字节 | 无 |
| 单条 ICS 的 DTSTART 写法 | 三种写法（浮动、`VALUE=DATE-TIME`、`VALUE=DATE`） | 这一条是浮动时间；其余两种没有重测 | 只核对了一种 |
| 单条 ICS 的 STATUS | 7、3715、852 里没有 | 这条没有 | 无 |
| ORGANIZER/CONTACT/URL | 个人邮箱、带 key 的 http 地址 | 一致：`ORGANIZER:iip-globalcom@illinois.edu`、URL 带 key、协议是 http | 无 |
| 不存在 id 返回 404 `text/html` | 有 | 没重测 | 未核对 |
| 系列活动 852/33560645 的 92 条、150,535 字节 | 有 | 没重测 | 未核对 |
| 日历 7 整本 1,533 条、约 2.2 MB | 有 | 没拿到：整本 ICS 地址找不到（`/ical/7.ics` 返回 404） | **无法核对** |
| 日历 3715 整本 46 条 | 有 | 没拿到（同上，404） | **无法核对** |
| XML 要 key | 要 Illinois Web Services 申请 | 与官方 FAQ 一致，补充了申请方式（Webtools Contact Us 表单）和 key 用 PEAR 消息发送 | 补充了来源和申请方式 |
| XML 版本 | 未提 | FAQ：v18 当前；v17 在 2026/11/1 后不再支持；并发超限返回 503 | **新增**。v17 的停用日期（2026/11/1）已经过去 |
| 官方 XML 请求限制 | 未提 | 有并发上限，503，分页 | **新增** |
| 使用条款 | 没找到 | 仍没找到；`illinois.edu/about/calendars/` 因证书错误未取到 | 无变化，多了一条没取到的记录 |
| 被撤下的活动 | 未验证 | 仍是未知 | 无变化 |

## 8. 请求记录

时间为 2026-11-13，America/Chicago（CST，UTC-6）。

| URL | 方法 | HTTP 状态 | 字节数 | 时间 |
|---|---|---|---|---|
| https://blogs.illinois.edu/view/6291/437291 | GET | 200 | 54,820 | 01:13:35 |
| https://illinois.edu/about/calendars/ | GET | 无响应（curl 错误 60，证书验证失败，没有重试，没有关闭验证） | 0 | 01:13:35 |
| https://calendars.illinois.edu/ical/7.ics | GET | 404 | 9,798（`text/html` 错误页） | 01:13:51 |
| https://calendars.illinois.edu/ical/3715.ics | GET | 404 | 9,798（`text/html` 错误页） | 01:13:51 |
| https://calendars.illinois.edu/ical/5749.ics | GET | 404 | 9,798（`text/html` 错误页） | 01:13:51 |
| https://calendars.illinois.edu/icalGmail/3715/33558080.ics?hourOffset=0&timeZone=America%2FChicago | GET | 200 | 1,359 | 01:13:51 |

另：用搜索工具做了两次关键词搜索（只限 illinois.edu 域，只用到结果里的标题和摘要，没有打开搜索结果之外的页面）。搜索引擎本身不是 UIUC 官方来源；搜索只用来找官方页面地址。没有访问任何禁止的站点，没有 POST，没有凭据。
