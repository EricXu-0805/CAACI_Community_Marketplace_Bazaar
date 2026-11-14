/*
 * 玉米地（Cornfield）公开演示站。纯静态：没有后端，不发网络请求，操作只存在这个浏览器的 localStorage。
 * 板块按 SPEC §3，首页按 §5，各页按 §6，和正式版的差异按 §14。
 */

const STORAGE_KEY = "illini-community-prototype-v1"; // 内部标识，改名不动（SPEC 1.3）；结构变了靠 VERSION
const VERSION = 4;
const TITLE_MAX = 120, BODY_MAX = 2000, ITEM_MAX = 3;
const HOUR = 60, DAY = 1440, WEEK = 7 * DAY;          // 时间一律按分钟算
const SNAPSHOT_CLOCK = 21 * HOUR + 30;                // 种子内容是晚上 21:30 的一张静态快照

const BOARDS = [
  { slug: "campus-life", name: "校园日常", desc: "课程、考试、校园里的事", scope: "课程、考试、校园里的事。选课经验也可以发在学长学姐说。", ask: "选课、考试、图书馆座位", titleHint: "CS 225 和 MATH 241 放同一学期会不会太累？", bodyHint: "说清课程号、学期和你已经试过什么" },
  { slug: "settling-market", name: "落脚香槟", desc: "租房、银行卡、驾照、公交", scope: "租房、银行卡、驾照、公交。买卖东西请去「二手」。", ask: "租房合同、银行开户、驾照", titleHint: "刚到香槟还没有 SSN，哪家银行能先开户？", bodyHint: "住在哪一带、预算多少、卡在哪一步" },
  { slug: "alumni-career", name: "学长学姐说", desc: "选课、实习、读研，问过来人", scope: "选课、实习、读研，问问过来人。", ask: "实习、简历、读研选择", titleHint: "大二才开始找实习，现在投暑期还来得及吗？", bodyHint: "年级专业、目标方向、想请教的一个问题" },
  { slug: "events-social", name: "找搭子", desc: "拼车、饭搭子、自习、看球", scope: "拼车、饭搭子、自习、看球。", ask: "拼车、饭搭子、一起自习", titleHint: "这周六去芝加哥中国城，有人一起拼车吗？", bodyHint: "什么事、什么时间地点、想找几个人" },
  { slug: "local-deals", name: "吃喝好店", desc: "香槟附近吃喝和小店", scope: "香槟附近吃喝和小店。只写自己去过的，不发未经核实的商家优惠。", ask: "火锅、超市、生日蛋糕", titleHint: "Campustown 现在哪家火锅还开着？", bodyHint: "哪家店、点了什么、自己去过的感受" }
];
// 旧版演示站分享出去的链接带的是旧板块名，照样打开对应的板块。
const LEGACY_BOARDS = { "校园生活": "campus-life", "二手与安顿": "settling-market", "校友求职": "alumni-career", "活动搭子": "events-social", "本地优惠": "local-deals" };
const NAV = [["home", "message-square", "社区"], ["market", "shopping-bag", "二手"], ["events", "calendar", "活动"], ["messages", "mail", "消息"], ["profile", "user", "我的"]];
const SORTS = { active: "最新回复", new: "新发布", ask: "待回答", hot: "热门" };
const HOME_TABS = ["最新回复", "新发布", "待回答"];
const SOURCES = {
  caaci: { filter: "CAACI", tag: () => "CAACI 主办", cls: "ok", line: () => "CAACI 主办。报名和名额以 CAACI 官网为准。", about: "CAACI 主办。报名和名额以 CAACI 官网为准。" },
  partner: { filter: "合作组织", tag: ev => `转发 · ${ev.org}`, cls: "plain", line: ev => `由玉米地站务转发，主办方是 ${ev.org}。报名、名额和现场安排由 ${ev.org} 负责。`, about: "由玉米地站务转发。报名、名额和现场安排由主办方负责。" },
  campus: { filter: "学校", tag: () => "学校活动", cls: "plain", line: ev => `收录自 UIUC 日历，主办方：${ev.org}。列在学校日历上不等于学校主办。`, about: "收录自 UIUC 日历。列在学校日历上不等于学校主办。" },
  member: { filter: "网友发起", tag: () => "网友发起", cls: "plain", line: () => "网友自发组织，不是 CAACI 或学校的活动。", about: "网友自发组织，不是 CAACI 或学校的活动。" }
};
const PEOPLE = {
  viewer: { name: "我" },
  team: { name: "玉米地站务", official: true },
  kevin: { name: "Kevin Z.", verified: true }, banzhuan: { name: "香槟搬砖人", verified: true }, yuki: { name: "yuki_uiuc", verified: true },
  ece2: { name: "ECE 大二", verified: true }, zhou: { name: "小周", verified: true }, mia: { name: "Mia", verified: true },
  wang: { name: "王一凡", verified: true }, lin: { name: "小林", verified: true }, lily: { name: "Lily W.", verified: true },
  yan: { name: "研一打工人", verified: true }, ming: { name: "Ming" }, chen: { name: "陈同学" }, you: { name: "阿柚" },
  li: { name: "新生小李" }, anan: { name: "安安" }, zhang: { name: "老张在香槟" }, cook: { name: "周末厨子" },
  alum: { name: "湾区老学长" }, xu: { name: "小许" }, tang: { name: "糖醋排骨" }, xia: { name: "CS 学渣" }
};

// 一条话题。age 是发布距快照多少分钟；一周以前的内容直接写日期（time）。回复写成 [谁, age, 正文, 日期?]。
const topic = (id, board, by, age, title, body, replies = [], extra = {}) => ({
  id, board, by, age, title, body, ...extra,
  comments: replies.map(([who, ago, text, time]) => (time ? { by: who, age: ago, body: text, time } : { by: who, age: ago, body: text }))
});

const seed = () => ({
  version: VERSION,
  saved: [],
  followed: [],
  reports: [],
  messages: [],
  draft: null,
  products: [
    { id: "m1", title: "24 英寸显示器", price: 45, by: "zhou", image: "assets/monitor.jpg", status: "available", description: "搬家前转让，带电源线和 HDMI 线。屏幕没有明显划痕，可以接笔记本用。\n\n取货前可以先确认尺寸和接口。", location: "Urbana，校园东边", condition: "用了一年，功能正常" },
    { id: "m2", title: "课程用书和参考书一组", price: 18, by: "viewer", image: "assets/books.jpg", status: "available", description: "整理书架，转让几本课程用书和课外参考书。有少量铅笔笔记，可以先确认版本。", location: "Main Library 附近", condition: "有使用痕迹" },
    { id: "m4", title: "宜家 MICKE 书桌，白色 105×50 cm", price: 35, by: "wang", image: "", status: "available", description: "毕业搬走，书桌带一个抽屉，桌面有一处小磕碰。需要自己来搬，可以帮忙抬下楼。", location: "Champaign，Green Street 附近", condition: "用了两年" },
    { id: "m5", title: "Trek FX 2 自行车，M 码，送 U 型锁", price: 180, by: "kevin", image: "", status: "available", description: "身高 170 到 180 厘米合适。上个月刚换过刹车皮，变速正常。送一把 U 型锁和前后灯。", location: "ARC 附近", condition: "骑了一年半" },
    { id: "m6", title: "象印 3 杯电饭煲，用了一年", price: 25, by: "mia", image: "", status: "available", description: "一两个人用正好。内胆没有划伤，带量杯和饭勺。", location: "Urbana，Lincoln Avenue 附近", condition: "用了一年" },
    { id: "m7", title: "微波炉，700W，功能正常", price: 20, by: "lily", image: "", status: "available", description: "宿舍搬公寓多出来的一台，转盘和门都没有问题。", location: "Champaign，校园西边", condition: "用了两年" },
    { id: "m3", title: "可调节阅读台灯", price: 12, by: "banzhuan", image: "assets/lamp.jpg", status: "sold", description: "金属灯臂，可以调照明方向。已经卖掉了，页面留着方便看之前的讨论。", location: "Champaign，Green Street 附近", condition: "用了两年" }
  ],
  events: [
    { id: "ev1", source: "member", org: "", by: "kevin", title: "周六下午 ARC 羽毛球，3 缺 3", group: "11月14日 周六", month: "11月", day: "14", weekday: "周六", time: "14:00", full: "2026年11月14日（周六）14:00–16:00（美国中部时间）", place: "ARC", intro: "", discussion: "p4", inDays: 1, checked: "" },
    { id: "ev2", source: "campus", org: "Illinois International", by: "", title: "International Thanksgiving Dinner", group: "11月20日 周五", month: "11月", day: "20", weekday: "周五", time: "11:30", full: "2026年11月20日（周五）11:30–13:30（美国中部时间）", place: "Latzer Hall, University YMCA", intro: "给国际学生和学者准备的感恩节午餐，可以带家人。", discussion: "", inDays: 7, checked: "11月13日 09:05" },
    { id: "ev3", source: "partner", org: "CSSA", by: "", title: "CSSA 期末减压桌游夜", group: "12月", month: "12月", day: "5", weekday: "周六", time: "19:00", full: "2026年12月5日（周六）19:00–22:00（美国中部时间）", place: "Illini Union", intro: "期末周前的桌游夜，有狼人杀和几款合作类桌游，零食自取。", discussion: "", inDays: 22, checked: "" },
    { id: "ev4", source: "caaci", org: "CAACI", by: "", title: "CAACI 2027 新春联欢会", group: "2027年2月", month: "2月", day: "6", weekday: "周六", time: "17:00", full: "2027年2月6日（周六）17:00–20:00（美国中部时间）", place: "Champaign-Urbana, IL", intro: "CAACI 一年一度的新春联欢会，有晚餐和节目。", discussion: "", inDays: 85, checked: "11月13日 09:05" }
  ],
  posts: [
    topic("p1", "settling-market", "zhou", 420, "刚搬到 Urbana，书桌怎么配比较实用？", "刚搬进新住处，想把书桌整理得舒服一点。大家写作业会接外置显示器吗？\n\n桌子深度只有 60 厘米，担心显示器离眼睛太近。也想听听大家对支架和桌面收纳的建议。\n\n手边还有一台闲置的 24 英寸显示器要出，有需要的同学可以看看。", [["lin", 300, "我也是 60 厘米深的桌子，24 英寸还可以。先量一下底座占多少地方，支架可以之后再买。"], ["yuki", 260, "加一个显示器支架能省出不少桌面，二手页偶尔有人出。"]], { items: ["m1"] }),
    topic("p2", "alumni-career", "ming", 480, "准备第一份实习简历，项目经历写多长？", "最近准备投第一份实习，简历里有两个课程项目，一个是小组合作，一个是自己写的工具。\n\n纠结每个项目写两行还是四行，也不知道该怎么区分「做了什么」和「学到了什么」。看过简历或招过人的学长学姐，会先看哪些内容？"),
    topic("p3", "settling-market", "team", 15840, "新生落脚清单：第一周要办的 8 件事", "刚到香槟的第一周，按这个顺序办比较省事。各项要求会变，办之前以学校和办事机构的页面为准。\n\n1. 到学校报到，领 i-card。\n2. 开一个银行账户。\n3. 办手机卡，先用预付费的也可以。\n4. 下载公交的 App，查好常坐的线路。\n5. 去超市把第一周的东西买齐，床品和锅碗优先。\n6. 量好房间和门的尺寸，再去二手页看家具。\n7. 把护照、I-20 和租房合同各留一份电子版。\n8. 白天走一遍从住处到教室的路，记下晚上回家的公交。", [["zhou", 13000, "买二手家具前也记得量电梯。之前沙发能进房间，差点没进电梯。", "11月4日"]], { time: "11月2日", featured: "guide" }),
    topic("p4", "events-social", "kevin", 1200, "周六下午 ARC 羽毛球，3 缺 3", "周六下午 2 点到 4 点在 ARC 打双打，现在有 3 个人，还差 3 个。水平不限，拍子可以借。\n\n费用就是 ARC 的入场，各付各的。想来的回个帖，我好订场地。", [["lin", 600, "算我一个，自己带拍。"], ["mia", 330, "我和室友可以去，两个人。"]], { eventId: "ev1" }),
    topic("p5", "local-deals", "xu", 120, "Campustown 现在哪家火锅还开着？", "上次去的那家关门了。周五想和同学吃火锅，Campustown 走路能到的还有哪家开着，人均大概多少？"),
    topic("p6", "local-deals", "zhou", 2880, "Savoy 那家 Costco 值得办卡吗？两个人住", "两个人合租，平时自己做饭。Costco 的分量太大怕吃不完，会员费一年下来划算吗？", [["cook", 1500, "两个人也划算，肉和鸡蛋分装冻起来就行。油和纸巾能省不少。"]]),

    topic("p7", "campus-life", "lily", 15840, "2027 春季选课：注册时间线和常见坑", "把今年选课要注意的几件事整理在这里，欢迎补充。\n\n1. 先查自己的注册开放时间，每个人不一样。\n2. 有先修课要求的课，提前确认系统里认不认你的成绩。\n3. 热门课满了先进 waitlist，开学第一周变动很大。\n4. 带实验的课注意 lab 和 discussion 的时间，别和别的课撞。", [["ece2", 8600, "补充一条：有的课限专业，开放给所有人的时间会更晚。"], ["li", 4400, "waitlist 排到第 12 位还有希望吗？"]], { time: "11月2日", pinned: true }),
    topic("p8", "campus-life", "li", 40, "期末周 Grainger 几点去还能找到座位？", "下周开始期末，想在 Grainger 复习。一般几点以后就没位置了？四楼和地下一层哪边好找一点？"),
    topic("p9", "campus-life", "ece2", 300, "这学期同时选了三门带实验的课，每周还有两次小组讨论，想问问大家都是怎么安排复习和睡眠的，才不至于期末周一起崩掉", "这学期排课排得太满，三门课每周都有实验报告。想听听过来人怎么分配时间，哪些可以先放一放。", [["yan", 200, "实验报告别拖到截止前一晚。我是每做完一次 lab 当天写完数据部分。"], ["tang", 120, "小组讨论尽量约在同一天，其他几天能留出整块时间。"]]),
    topic("p10", "campus-life", "yuki", 600, "ECE 110 的 lab 报告一般要写多久？", "第一次写，想估一下时间。每周的报告大概要花几个小时？", [["ece2", 240, "熟悉以后两三个小时。前两次会久一点，主要是画图。"]]),
    topic("p11", "campus-life", "you", 1500, "CS 225 和 MATH 241 放同一学期会不会太累？", "下学期想同时上 CS 225 和 MATH 241，另外还有一门通识课。两门课的作业量加起来能应付吗？", [["xia", 1400, "能上，但 225 的 MP 很花时间，别再加第三门硬课。"], ["lily", 900, "241 每周有固定的作业节奏，提前一天写完就不会和 MP 撞。"], ["you", 360, "谢谢，那通识课我选一门轻一点的。"]]),
    topic("p12", "campus-life", "tang", 1560, "MATH 241 期中成绩出来了，一般会 curve 多少", "这次期中平均分不高。往年最后会调分吗，大概调多少？", [["wang", 700, "每学期不一样，看教授。去年我们那个 section 最后几乎没调。"]]),
    topic("p13", "campus-life", "xia", 7200, "CS 128 和 ECE 220 同一学期修会不会冲突", "两门课都要写不少代码。想问同时修过的同学，截止日期会不会经常撞在一起？", [["ece2", 7000, "会撞几次，不过两边的作业都是提前一周多放出来的。"], ["kevin", 6800, "我去年同时修的。128 前半学期轻，220 后半学期重，能错开。"], ["xia", 6480, "那我就这么选了。"]]),
    topic("p14", "campus-life", "wang", 8640, "春季想组队参加黑客松，还缺一个前端", "我们现在三个人，两个后端一个做设计。想找一位会 React 的同学，大二大三都行。", [["yuki", 8000, "我会一点 React，做过课程项目，可以聊聊。"], ["chen", 7500, "比赛是哪个周末？"], ["wang", 7200, "2 月的第二个周末，具体时间等主办方通知。"]]),

    topic("p15", "settling-market", "zhang", 23040, "租房合同签之前看一眼：押金、转租、退租检查", "每年都有人在这几件事上吃亏，签之前对照看一遍。\n\n1. 押金多少、什么情况下会扣，写进合同才算数。\n2. 能不能转租、转租要不要交手续费。\n3. 入住当天拍照留底，墙面、地毯和电器都拍。\n4. 退租前问清楚清洁标准，自己打扫还是必须请人。", [["banzhuan", 14400, "入住照片记得带时间，发一份到自己邮箱。", "11月3日"], ["li", 11000, "转租的手续费一般多少？", "11月6日"]], { time: "10月28日", pinned: true }),
    topic("p16", "settling-market", "xu", 60, "伊利诺伊驾照笔试能选中文吗？在 Champaign 哪里考？", "准备考驾照。笔试可以选中文吗？在 Champaign 是去哪个办事处，需要提前预约吗？"),
    topic("p17", "settling-market", "wang", 400, "两室公寓冬天暖气费一个月大概多少", "第一次在这边过冬，两室一厅，暖气用电。想提前知道 12 月到 2 月的电费大概是多少。", [["zhang", 300, "看房子保温。我们是老房子，最冷的那个月电费 180 美元左右。"], ["mia", 130, "新一点的公寓 100 美元上下。白天没人就把温度调低。"]]),
    topic("p18", "settling-market", "li", 900, "刚到香槟还没有 SSN，哪家银行能先开户？", "上周刚到，SSN 还没办下来。想先开一个账户收奖学金，哪家银行可以只用护照和 I-20 开？", [["zhou", 800, "我当时带护照、I-20 和租房合同就开了，没要 SSN。"], ["lily", 500, "Green Street 上的几家都可以，去之前先在网上约时间。"], ["li", 190, "约到了周四，谢谢两位。"]]),
    topic("p19", "settling-market", "yuki", 1700, "Green Street 附近一居室月租 1200 美元算贵吗？", "看了一套一居室，走路到 Grainger 十分钟，月租 1200 美元，不含水电。这个价格在这一带算正常吗？", [["zhang", 800, "这个位置算正常。往 Urbana 那边走两个路口能便宜一两百。"]]),
    topic("p20", "settling-market", "banzhuan", 4320, "毕业前清东西，写几条在香槟买卖二手家具的经验", "12 月毕业回国，这两周把带不走的东西卖得差不多了。记几条经验，给刚来要买、或者也要搬走的同学参考。\n\n1. 大件尽量在 11 月中旬之前挂出来。12 月搬家的人扎堆，价格只能往下压。\n2. 白天拍照，拍全尺寸。来问的人会少问很多问题。\n3. 当面交易约在公共地方。大件请对方开车到楼下，我帮忙搬。\n4. 收款前核对对方的名字。遇到「多转给你、你退我差价」这种说法，直接不卖。\n\n台灯已经卖掉了，链接留着给大家看看行情。", [["yuki", 1500, "第 2 条很有用。想问一下，你是按原价几折定的？"], ["banzhuan", 1450, "按买价的三到四折，用满两年再低一点。可以先去二手页搜同型号，看别人挂多少。"], ["mia", 300, "补充一条：对方没车的话，可以约周末一起叫车，车费对半。"]], { items: ["m3"] }),
    topic("p21", "settling-market", "anan", 7920, "MTD 22 路晚上 10 点以后还有车吗", "下学期有一门晚课，下课快 10 点了。22 路那个时间还有车吗，间隔多久一班？", [["zhang", 7700, "有，不过晚上间隔变长，出门前看一眼 App 上的实时到站。"], ["lin", 7500, "周末晚上班次更少，我一般提前 5 分钟到站。"], ["anan", 7200, "明白了，谢谢。"]]),
    topic("p22", "settling-market", "ming", 2880, "第一次在香槟过冬开车，要不要换雪地胎？", "车是前驱的轿车，平时只在 Champaign 和 Urbana 之间开。本地人冬天会专门换雪地胎吗？", [["zhang", 2500, "市区路面铲雪很快，四季胎够用。下雪当天慢一点开。"], ["kevin", 1000, "胎纹太浅的话先换新的四季胎，比雪地胎要紧。"]]),

    topic("p23", "alumni-career", "ece2", 500, "想转 CS，转专业申请的 essay 应该写什么", "现在在工程学院别的专业，想申请转到 CS。Essay 是写为什么想转，还是写做过的项目更好？", [["alum", 200, "两样都要有。先讲你做过什么，再讲为什么非转不可，别只写兴趣。"], ["yan", 70, "把上过的 CS 课和成绩列清楚，招生的老师会看。"]]),
    topic("p24", "alumni-career", "yan", 180, "MCS 和 MS 找工作时差别大吗？", "在考虑从 MCS 转 MS。只看找工作的话，招聘的人会在意这两个学位的区别吗？"),
    topic("p25", "alumni-career", "you", 1300, "大二才开始找实习，现在投暑期还来得及吗？", "之前没有实习经历，这个月才开始改简历。11 月才开始投暑期实习，是不是已经晚了？", [["alum", 1100, "不晚。大公司开得早，很多中小公司 1 月到 3 月才放岗位。"], ["kevin", 700, "先投来过学校 Career Fair 的公司，回复率高一些。"], ["you", 310, "好，我先把简历改完。"]]),
    topic("p26", "alumni-career", "tang", 1400, "Career Fair 前简历找谁帮忙看比较好？", "下个月有 Career Fair，想在那之前把简历改一遍。除了学院的 career office，还能找谁看？", [["yan", 370, "找同专业高一两级的同学看最有用，他们知道招聘的人会问什么。"]]),
    topic("p27", "alumni-career", "chen", 8640, "读完 MEng 回国找工作，学历认证要准备什么材料", "明年 5 月毕业，打算回国工作。学历认证需要哪些材料，毕业前在学校要先办好什么？", [["banzhuan", 8200, "成绩单和学位证明先各要几份。认证本身回国以后在网上办。"], ["alum", 7900, "毕业前把学校邮箱里的重要邮件转存，账号过一阵会停。"], ["chen", 7488, "记下了，谢谢。"]]),
    topic("p28", "alumni-career", "alum", 17280, "校友答疑：在湾区做了 5 年硬件，选课和实习的问题集中在这里问", "2019 年 ECE 毕业，现在在湾区做硬件。选课、实习、要不要读研，这些问题可以问我，我每周来回一次。\n\n问的时候说一下年级和专业，我能答得具体一点。", [["ece2", 14400, "大二，ECE。想问数字电路和模拟电路方向，实习机会哪个多一些？", "11月3日"], ["alum", 13000, "数字方向的岗位多。模拟方向的人少，要求读研的比例高。先把两门入门课都上了再定。", "11月4日"], ["li", 5000, "大一还没定方向，现在该先做什么？"]], { time: "11月1日", pinned: true }),
    topic("p29", "alumni-career", "xia", 2000, "CS + Stat 和 Math + CS，哪个对找数据岗更有用？", "想以后做数据分析。这两个专业的课差别大吗，找工作时哪个更对口？"),

    topic("p30", "events-social", "lin", 30, "找周末一起去 ARC 打羽毛球的搭子", "水平一般，想每周固定打一次，周六或周日下午都可以。有没有也想找固定搭子的同学？"),
    topic("p31", "events-social", "mia", 700, "这周六去芝加哥中国城，有人一起拼车吗？", "周六早上 9 点从 Green Street 出发，晚上 8 点前回来。车上还有 2 个位置，油费和停车费平摊。", [["chen", 600, "我想去，一个人。"], ["you", 400, "还有位置的话加我一个。"], ["mia", 60, "两位都算上了，车满了。"]]),
    topic("p32", "events-social", "anan", 800, "期末周想找人一起在图书馆自习，互相监督", "一个人复习容易走神。想找一两个人每天上午在 Main Library 自习，不用同专业。", [["xu", 500, "我也是期末周，上午可以。"], ["li", 125, "加我一个，我一般 9 点到。"]]),
    topic("p33", "events-social", "xu", 1000, "每周三晚上 Main Library 自习，有一起的吗", "周三晚上 7 点到 10 点，固定在二楼。想找人一起，互相提醒别玩手机。", [["tang", 200, "这学期周三晚上我都有空，下周见。"]]),
    topic("p34", "events-social", "wang", 5760, "感恩节拼车集中帖：11 月 26 日前后去 O'Hare 的在这里报", "感恩节前后去机场的人多，集中在这个帖子里报。写清楚日期、大概几点出发、几个人、有没有大件行李。\n\n已经拼好的回来说一声。", [["lily", 5000, "11 月 25 日下午 2 点左右出发，1 个人，一个登机箱。"], ["chen", 3000, "11 月 26 日早上 6 点，2 个人，可以分摊叫车。"], ["kevin", 90, "25 日下午我开车去，还能带 2 个人。"]], { pinned: true }),
    topic("p35", "events-social", "chen", 1500, "12 月去芝加哥看圣诞灯展，求拼车，2 个人", "12 月中旬的一个周六，想去芝加哥看灯展，当天来回。我们 2 个人，想找有车的同学一起，费用平摊。", [["mia", 500, "我 12 月 12 日那个周六去，车上还有位置。"]]),

    topic("p36", "local-deals", "tang", 600, "Neil Street 那家韩式炸鸡有人吃过吗", "路过好几次都在排队。想问吃过的同学，哪个口味值得点，两个人点多少合适？", [["cook", 300, "原味和蒜香的各半只，两个人够了。萝卜要另点。"], ["lin", 65, "上周去过，酱油口味偏甜。排队的话可以先打电话订。"]]),
    topic("p37", "local-deals", "cook", 900, "想买新鲜的鱼，香槟哪个超市靠谱？", "想做清蒸鱼，冷冻的不太行。香槟哪家超市有新鲜的整鱼，一般周几到货？", [["zhang", 600, "亚洲超市周四下午到货，去晚了就剩冷冻的。"], ["lily", 250, "我买过鲈鱼，可以请店里帮忙处理干净。"]]),
    topic("p38", "local-deals", "yuki", 320, "附近有能订中式生日蛋糕的店吗？", "下周给室友过生日，想订一个不太甜的水果蛋糕。香槟或 Urbana 有能提前预订的店吗？"),
    topic("p39", "local-deals", "cook", 1600, "Green Street 新开的兰州拉面吃过了：牛肉面 $14.5，分量够，汤偏咸", "周二中午去的，没有排队。牛肉面 $14.5，面是现拉的，分量够。汤偏咸，可以让店里少放盐。凉菜一般。", [["xu", 420, "他们家晚上几点关门？"]]),
    topic("p40", "local-deals", "lily", 7200, "周末带爸妈吃饭，Champaign 哪家适合长辈", "爸妈下周来看我，想找一家不太吵、菜不太辣的中餐。人均 30 美元以内，最好能订位。", [["cook", 7000, "带长辈的话选有包间的那两家，提前一天打电话订。"], ["zhang", 6800, "我爸妈来的时候去吃了粤菜，清淡，他们吃得惯。"], ["mia", 6500, "周末晚上人多，订 5 点半那一轮比较安静。"], ["lily", 6048, "订到了周六 5 点半，谢谢大家。"]]),
    topic("p41", "local-deals", "anan", 2100, "Urbana 哪家亚洲超市能买到新鲜豆腐和韭菜？", "住在 Urbana，没有车。想找公交能到的亚洲超市，主要买豆腐和韭菜。"),

    topic("p42", "campus-life", "team", 11520, "社区守则（2026 年 11 月版）", "玉米地是一个讲实际经验的地方。发帖和回复请守这几条。\n\n1. 说自己经历过的事。转别人的内容要写出处。\n2. 不发广告，不替商家发未经核实的优惠。\n3. 不公开别人的姓名、电话、住址和聊天截图。\n4. 对事不对人。不同意可以说理由，不骂人。\n5. 买卖东西请走「二手」，当面验货再付款。\n\n看到不合适的内容，点话题里的「举报」。", [], { time: "11月5日", featured: "rules" }),
    topic("p43", "settling-market", "team", 14400, "二手交易：当面交易、付款和防骗", "在二手页买卖东西，记住三件事。\n\n1. 当面交易，约在白天、有人的地方。\n2. 验货以后再付款。不提前转定金，不接受「多付退差价」。\n3. 对方催你换到别的平台联系，或者发来不认识的链接，就不要继续了。\n\n遇到可疑的商品或私信，点「举报」。", [], { time: "11月3日", featured: "guide" })
  ]
});

/* ---------- 状态：读、校验、存 ---------- */
let storageMode = "persistent", initialNotice = "";
const record = x => x !== null && typeof x === "object" && !Array.isArray(x);
const strings = (x, keys) => record(x) && keys.every(k => typeof x[k] === "string");
const stamped = x => (Number.isFinite(x.age) && x.age >= 0) || (Number.isFinite(x.at) && x.at > 0);
function validState(s) {
  return record(s) && s.version === VERSION
    && ["posts", "products", "reports", "messages", "saved", "followed", "events"].every(k => Array.isArray(s[k]))
    && s.posts.every(p => strings(p, ["id", "board", "by", "title", "body"]) && stamped(p)
      && Array.isArray(p.comments) && p.comments.every(c => strings(c, ["by", "body"]) && stamped(c))
      && (!p.items || (Array.isArray(p.items) && p.items.every(i => typeof i === "string"))))
    && s.products.every(p => strings(p, ["id", "title", "by", "image", "status", "description", "location", "condition"]) && Number.isFinite(p.price) && ["available", "sold"].includes(p.status))
    && s.events.every(x => strings(x, ["id", "source", "org", "by", "title", "group", "month", "day", "weekday", "time", "full", "place", "intro", "discussion", "checked"]) && Boolean(SOURCES[x.source]) && Number.isFinite(x.inDays))
    && s.reports.every(x => strings(x, ["id", "postId", "reason", "detail", "status"]))
    && s.messages.every(x => strings(x, ["productId", "body"]))
    && s.saved.every(x => typeof x === "string") && s.followed.every(x => typeof x === "string")
    && (s.draft == null || (strings(s.draft, ["board", "title", "body"]) && Array.isArray(s.draft.items)));
}
function loadState() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { storageMode = "volatile"; return seed(); }
  if (!raw) return seed();
  try {
    const parsed = JSON.parse(raw);
    if (validState(parsed)) return parsed;
    initialNotice = "演示站更新了，之前的操作记录已清空。";
  } catch {
    initialNotice = "之前的操作记录无法读取，已恢复初始内容。";
  }
  return seed();
}
let state = loadState(), homeTab = HOME_TABS[0], startOpen = false, searchOpen = false, draftNote = false, visits = 0;
let toastTimer, renderedRoute = "", skipDraftCapture = false;
const viewDrafts = new Map();

/* ---------- 小工具 ---------- */
const e = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = s => document.querySelector(s);
const icon = (name, size = 18) => `<span class="icon" aria-hidden="true">${feather.icons[name].toSvg({ width: size, height: size, "stroke-width": 1.8 })}</span>`;
const wide = matchMedia("(min-width: 1024px)");
const DOT = '<span class="mi">·</span>';
const pad2 = n => String(n).padStart(2, "0");

const boardOf = slug => BOARDS.find(b => b.slug === slug);
const person = key => PEOPLE[key] || { name: "已注销用户" };
const isOfficial = p => Boolean(person(p.by).official);
const getPost = id => state.posts.find(p => p.id === id);
const getProduct = id => state.products.find(p => p.id === id);
const visiblePosts = () => state.posts.filter(p => !p.hidden && boardOf(p.board));
const ownActive = () => state.products.filter(p => p.by === "viewer" && p.status === "available");
const statusText = p => (p.status === "sold" ? "已售出" : "在售");

// 种子内容的时间按快照写死，不随日期变；访客自己发的内容记下发布时刻，按 SPEC 5.5 的写法显示。
const minutes = x => (x.at != null ? Math.max(0, (Date.now() - x.at) / 60000) : x.age);
function when(x) {
  if (x.time) return x.time;
  const own = x.at != null, m = Math.floor(minutes(x));
  if (m < 1) return "刚刚";
  if (m < HOUR) return `${m} 分钟前`;
  const now = own ? new Date() : null, clock = own ? now.getHours() * HOUR + now.getMinutes() : SNAPSHOT_CLOCK;
  if (m <= clock) return `${Math.floor(m / HOUR)} 小时前`;
  if (m <= clock + DAY) return `昨天 ${pad2(Math.floor((clock + DAY - m) / HOUR))}:${pad2((clock + DAY - m) % HOUR)}`;
  if (m <= WEEK) return `${Math.floor(m / DAY)} 天前`;
  if (!own) return `${Math.floor(m / DAY)} 天前`;
  const d = new Date(x.at), date = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? date : `${d.getFullYear()}年${date}`;
}
// 最后一次动静：最新的一条回复，没有回复就是话题本身。按「最新回复」排的列表写这个时间和最后回复的人（SPEC 5.2 ④）。
const lastTouch = p => p.comments.reduce((a, c) => (minutes(c) < minutes(a) ? c : a), p);
const activeMinutes = p => minutes(lastTouch(p));
const byNew = (a, b) => minutes(a) - minutes(b);
const byActive = (a, b) => activeMinutes(a) - activeMinutes(b);
const repliers = p => new Set(p.comments.map(c => c.by).filter(by => by !== p.by));
const unanswered = p => repliers(p).size === 0 && minutes(p) <= 30 * DAY;
const isHot = p => minutes(p) <= WEEK && p.comments.length >= 3 && repliers(p).size >= 2;
function sortTopics(list, sort) {
  if (sort === "new") return [...list].sort(byNew);
  if (sort === "ask") return list.filter(unanswered).sort(byActive);
  if (sort === "hot") return list.filter(p => p.comments.length && minutes(p) <= 14 * DAY).sort((a, b) => b.comments.length - a.comments.length || byNew(a, b));
  return [...list].sort(byActive);
}

function updateStorageNotice() {
  const el = $("#storage-notice");
  if (!el) return;
  el.textContent = storageMode === "volatile" ? "这个浏览器存不了记录。可以照常操作，刷新后会丢失。" : initialNotice;
  el.hidden = !el.textContent;
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageMode = "persistent";
    initialNotice = "";
    updateStorageNotice();
    return true;
  } catch {
    storageMode = "volatile";
    updateStorageNotice();
    return false;
  }
}
function toast(message) {
  $("#toast").textContent = message + (storageMode === "volatile" ? "（仅本次打开有效）" : "");
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3800);
}
function nextId(prefix) {
  const used = new Set([...state.posts, ...state.reports].map(x => x.id));
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}
function route() {
  const raw = location.hash.slice(1) || "home";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}
function syncSearchFromRoute() { $("#search-input").value = route().params.get("q") || ""; }
function navigate(hash) {
  if (location.hash === "#" + hash) { render(); window.scrollTo(0, 0); } else location.hash = hash;
}

// 重画页面前记下表单里没提交的字和焦点，画完放回去。
function captureView() {
  const main = $("#main");
  if (!main?.querySelectorAll || !renderedRoute) return null;
  const fields = [...main.querySelectorAll("input[name],textarea[name],select[name]")].filter(f => f.type !== "radio" && f.type !== "checkbox").map(f => ({ id: f.id, value: f.value }));
  if (!skipDraftCapture) viewDrafts.set(renderedRoute, fields);
  skipDraftCapture = false;
  const active = document.activeElement;
  if (!main.contains(active)) return null;
  return { id: active.id, action: active.dataset?.action, itemId: active.dataset?.id, start: active.selectionStart, end: active.selectionEnd };
}
function restoreView(key, focus, sameRoute) {
  const main = $("#main");
  if (!main?.querySelectorAll) return;
  const nodes = [...main.querySelectorAll("input[name],textarea[name],select[name]")];
  for (const f of viewDrafts.get(key) || []) {
    const node = nodes.find(n => n.id === f.id);
    if (node) node.value = f.value;
  }
  if (!sameRoute || !focus) return;
  const target = focus.id ? nodes.find(n => n.id === focus.id) : [...main.querySelectorAll("[data-action]")].find(n => n.dataset.action === focus.action && n.dataset.id === focus.itemId);
  if (target) {
    target.focus({ preventScroll: true });
    if (typeof focus.start === "number" && target.setSelectionRange) target.setSelectionRange(focus.start, focus.end);
  }
}
function discardDraft() { viewDrafts.delete(renderedRoute); skipDraftCapture = true; }

/* ---------- 共用的片段 ---------- */
function seal(cls) {
  return `<picture><source srcset="assets/seal-dark.svg" media="(prefers-color-scheme: dark)"><img class="${cls}" src="assets/seal.svg" alt=""></picture>`;
}
function avatar(by, size = "") {
  const who = person(by);
  return who.official ? `<span class="avatar ${size}">${seal("")}</span>` : `<span class="avatar ${size}" aria-hidden="true">${e([...who.name][0].toUpperCase())}</span>`;
}
function badge(by) {
  const who = person(by);
  return who.official ? '<span class="tag line">官方</span>' : who.verified ? '<span class="tag ok">✓ 校园邮箱已验证</span>' : "";
}
const sourceTag = ev => `<span class="tag ${SOURCES[ev.source].cls}">${e(SOURCES[ev.source].tag(ev))}</span>`;
const dateBlock = ev => `<span class="date"><small>${e(ev.month)}</small><strong>${e(ev.day)}</strong></span>`;
const thumb = (p, cls) => (p.image ? `<img class="${cls}" src="${e(p.image)}" alt="" loading="lazy">` : `<span class="${cls} ph" aria-hidden="true">玉</span>`);
const stateBox = (text, action = "") => `<div class="state"><p>${e(text)}</p>${action}</div>`;
const pageHead = (title, action = "") => `<div class="page-h"><h1 class="page-t">${e(title)}</h1>${action}</div>`;
const fillerRow = b => `<a class="row fill" href="#compose?board=${b.slug}"><span>适合在这里问：${b.ask} <span class="fill-go">发第一帖 ›</span></span></a>`;
const composeLink = (label, query = "") => `<a class="btn" href="#compose${query}">${label}</a>`;

function footer() {
  const rules = visiblePosts().find(p => p.featured === "rules");
  return `<div class="foot"><a href="#about">演示说明</a>${rules ? `<a href="#post/${e(rules.id)}">社区守则</a>` : ""}<a href="#guide">新来先看</a><span class="copy">© 2026 玉米地 Cornfield</span></div>`;
}
function guideRow(p) {
  return `<a class="guide" href="#post/${e(p.id)}" data-post-id="${e(p.id)}"><span class="tag">${p.featured === "rules" ? "守则" : "指南"}</span><span class="guide-t">${e(p.title)}</span></a>`;
}
function eventMini(ev) {
  return `<a class="ev-mini" href="#event/${e(ev.id)}">${dateBlock(ev)}<span class="ev-main"><strong class="ev-t">${e(ev.title)}</strong><span class="ev-when">${e(ev.weekday)} ${e(ev.time)} · ${e(ev.place)}</span>${sourceTag(ev)}</span></a>`;
}
const featuredPosts = () => visiblePosts().filter(p => p.featured && isOfficial(p)).sort(byActive).slice(0, 5);
const eventShown = ev => !(ev.source === "member" && getPost(ev.discussion)?.hidden);   // 话题被隐藏，网友发起的活动跟着隐藏
const upcomingEvents = () => state.events.filter(ev => ev.source !== "member" && ev.inDays <= 30).sort((a, b) => a.inDays - b.inDays).slice(0, 3);

// 侧栏只在桌面出现：新来先看、近期活动、本周热议（只有首页传）、关于本站。
function sidebar(newHere, hot = []) {
  const events = upcomingEvents();
  const rules = visiblePosts().find(p => p.featured === "rules");
  return `<aside class="side">
    ${newHere.length ? `<section class="sb"><h2 class="sb-h">新来先看</h2>${newHere.map(guideRow).join("")}</section>` : ""}
    ${events.length ? `<section class="sb"><h2 class="sb-h">近期活动</h2>${events.map(eventMini).join("")}<a class="more" href="#events">全部活动 ›</a></section>` : ""}
    ${hot.length ? `<section class="sb"><h2 class="sb-h">本周热议</h2>${hot.map(p => `<a class="hot" href="#post/${e(p.id)}" data-post-id="${e(p.id)}"><span class="row-t">${e(p.title)}</span><span class="cnt">${p.comments.length}</span></a>`).join("")}</section>` : ""}
    <section class="sb"><h2 class="sb-h">关于本站</h2><p class="about-t">玉米地是服务 UIUC 及香槟地区华人的论坛，由 Guoyi (Eric) Xu 运营，志愿者协助维护。</p><div class="about-l">${rules ? `<a href="#post/${e(rules.id)}">社区守则</a>` : ""}<a href="#about">演示说明</a></div></section>
  </aside>`;
}
function chips(current) {
  const first = current === "all" ? ["community", "全部板块", true] : ["home", "全部", current === "home"];
  return `<a class="chip ${first[2] ? "on" : ""}" href="#${first[0]}"${first[2] ? ' aria-current="page"' : ""}>${first[1]}</a>`
    + BOARDS.map(b => `<a class="chip ${current === b.slug ? "on" : ""}" href="#community?board=${b.slug}"${current === b.slug ? ' aria-current="page"' : ""}>${b.name}</a>`).join("");
}

/* ---------- 社区首页（SPEC §5） ---------- */
// 每一块放哪些话题、怎么去重、什么时候不出现，规则照正式版的 buildHomeSections：
// 置顶 > 板块卡 > 全站最新 > 本周热议，一个话题在首页只出现一次。
function homeSections(desktop, tab) {
  const topics = visiblePosts().sort(byActive);
  const official = new Set(topics.filter(isOfficial).sort(byNew).slice(0, 3).map(p => p.id));   // 官方帖整页最多 3 条
  const allowed = topics.filter(p => !isOfficial(p) || official.has(p.id));
  const used = new Set(), take = p => { used.add(p.id); return p; };
  const limit = desktop ? 4 : 3;
  const cards = BOARDS.map(board => ({ board, rows: [], limit, week: topics.filter(p => p.board === board.slug && minutes(p) <= WEEK).length }));
  for (const card of cards) {
    const pin = allowed.find(p => p.board === card.board.slug && p.pinned);
    if (pin) card.rows.push(take(pin));
  }
  const newHere = allowed.filter(p => p.featured && isOfficial(p) && !used.has(p.id)).slice(0, 5).map(take);
  for (const card of cards) {
    const perAuthor = new Map(card.rows.map(p => [p.by, 1]));
    for (const p of allowed) {
      if (card.rows.length >= limit) break;
      if (p.board !== card.board.slug || p.pinned || used.has(p.id) || (perAuthor.get(p.by) || 0) >= 2) continue;
      card.rows.push(take(p));
      perAuthor.set(p.by, (perAuthor.get(p.by) || 0) + 1);
    }
  }
  const rest = allowed.filter(p => !used.has(p.id));
  const count = desktop ? 15 : 10;
  const pick = name => (name === "新发布" ? [...rest].sort(byNew) : name === "待回答" ? rest.filter(unanswered) : rest).slice(0, count);
  const collapsed = rest.length < 5;
  // 「本周热议」在手机上是全站最新的一个 tab，它和默认排序去重。
  const shown = collapsed ? [] : pick(tab === "本周热议" ? HOME_TABS[0] : tab);
  shown.forEach(take);
  const hotAll = topics.filter(isHot);
  const hot = hotAll.length >= 5
    ? hotAll.filter(p => !used.has(p.id) && (!isOfficial(p) || official.has(p.id))).sort((a, b) => b.comments.length - a.comments.length || byNew(a, b)).slice(0, 5)
    : [];
  const items = state.products.filter(p => p.status === "available").slice(0, desktop ? 3 : 6);
  return { cards, newHere, collapsed, latest: tab === "本周热议" ? hot : shown, hot, items, total: topics.length };
}
function cardRow(p, desktop) {
  const n = p.comments.length, t = e(when(lastTouch(p))), pin = p.pinned ? '<span class="tag">置顶</span>' : "", ask = !n && unanswered(p) ? '<span class="tag ask">待回答</span>' : "";
  const open = `<a class="row" href="#post/${e(p.id)}" data-post-id="${e(p.id)}">`;
  return desktop
    ? `${open}${pin}<span class="row-t">${e(p.title)}</span>${ask}<span class="row-m">${n ? `<span class="cnt">${n}</span>` : ""}<span class="mi">${t}</span></span></a>`
    : `${open}<span class="row-t">${e(p.title)}</span><span class="meta">${pin}${n ? `<span class="mi">${n} 条回复</span>` : ask}${n || ask ? DOT : ""}<span class="mi">${t}</span></span></a>`;
}
function boardCard(card, desktop) {
  const b = card.board, label = desktop ? "全部" : "更多";
  return `<section class="card b-${b.slug}" data-board="${b.slug}">
    <div class="card-h"><i class="bar"></i><h2 class="bname">${b.name}</h2>${desktop && card.week >= 3 ? `<span class="week">本周 ${card.week} 新帖</span>` : ""}<a class="more" href="#community?board=${b.slug}" aria-label="${b.name} ${label}">${label} ›</a></div>
    ${desktop ? `<p class="card-desc">${b.desc}</p>` : ""}
    <div class="rows">${card.rows.map(p => cardRow(p, desktop)).join("")}${card.rows.length < card.limit ? fillerRow(b) : ""}</div>
  </section>`;
}
function marketCard(items, desktop) {
  const price = p => `<span class="price">$${e(p.price)}</span>`;
  const body = desktop
    ? `<div class="rows">${items.map(p => `<a class="item" href="#product/${e(p.id)}">${thumb(p, "item-img")}<span class="item-t">${e(p.title)}</span>${price(p)}</a>`).join("")}</div>`
    : `<div class="strip">${items.map(p => `<a class="tile" href="#product/${e(p.id)}">${thumb(p, "tile-img")}<span class="tile-t">${e(p.title)}</span>${price(p)}</a>`).join("")}<a class="tile tile-go" href="#market">看全部二手</a></div>`;
  return `<section class="card b-market" data-board="market"><div class="card-h"><i class="bar"></i><h2 class="bname">${desktop ? "二手好物" : "二手新上架"}</h2><a class="more" href="#market">全部二手 ›</a></div>${body}</section>`;
}
function latestRow(p, active) {
  const n = p.comments.length, b = boardOf(p.board), last = active ? lastTouch(p) : p;
  return `<a class="lr" href="#post/${e(p.id)}" data-post-id="${e(p.id)}"><span class="lr-main"><span class="lr-t">${e(p.title)}</span><span class="meta">${avatar(p.by, "xs")}<span class="mi lb b-${b.slug}">${b.name}</span>${DOT}<span class="mi author">${e(person(p.by).name)}</span>${isOfficial(p) ? '<span class="tag line">官方</span>' : ""}${DOT}<span class="mi">${e(when(last))}</span>${last !== p ? `${DOT}<span class="mi last">最后回复 ${e(person(last.by).name)}</span>` : ""}</span></span>${n ? `<span class="pill">${n}</span>` : unanswered(p) ? '<span class="tag ask">待回答</span>' : ""}</a>`;
}
function homeView(desktop) {
  let s = homeSections(desktop, homeTab);
  const tabs = HOME_TABS.concat(!desktop && s.hot.length ? ["本周热议"] : []);
  if (!tabs.includes(homeTab)) { homeTab = HOME_TABS[0]; s = homeSections(desktop, homeTab); }
  const events = upcomingEvents();
  const latest = s.collapsed
    ? `<section class="latest"><a class="more-btn" href="#community">${desktop ? `查看全部 ${s.total} 个讨论 ›` : "查看全部讨论"}</a></section>`
    : `<section class="latest" data-block="latest">
        <div class="sec-h"><h2 class="sec-t">全站最新</h2><div class="tabs">${tabs.map(t => `<button type="button" class="tab ${homeTab === t ? "on" : ""}" data-action="home-tab" data-tab="${t}" aria-pressed="${homeTab === t}">${t}</button>`).join("")}</div><a class="more" href="#community">全部讨论 ›</a></div>
        <div class="list">${s.latest.length ? s.latest.map(p => latestRow(p, homeTab === HOME_TABS[0])).join("") : stateBox("目前每个话题都有人回过了")}</div>
        <a class="more-btn" href="#community">${desktop ? "查看更多 ›" : "查看全部讨论"}</a>
      </section>`;
  const phoneTop = desktop ? "" : `${s.newHere.length ? `<section class="block"><button type="button" class="fold" data-action="start-toggle" aria-expanded="${startOpen}">新来先看 · ${s.newHere.length} 篇 ›</button>${startOpen ? s.newHere.map(guideRow).join("") : ""}</section>` : ""}
    ${events.length ? `<section class="block"><div class="block-h"><h2 class="sub-t">近期活动</h2><a class="more" href="#events">全部 ›</a></div><div class="ev-strip">${events.map(eventMini).join("")}</div></section>` : ""}`;
  return {
    tab: "home", top: "brand", title: "社区", chips: chips("home"), fab: "compose", search: true,
    html: `<h1 class="sr-only">社区</h1><div class="wrap">${phoneTop}<div class="cols"><div class="main"><div class="grid6">${s.cards.map(c => boardCard(c, desktop)).join("")}${marketCard(s.items, desktop)}</div>${latest}</div>${sidebar(s.newHere, s.hot)}</div></div>${footer()}`
  };
}

/* ---------- 板块页、全部讨论、搜索（SPEC 6.1–6.3） ---------- */
function topicRow(p, showBoard, active = false) {
  const n = p.comments.length, b = boardOf(p.board), items = (p.items || []).map(getProduct).filter(Boolean), last = active ? lastTouch(p) : p;
  const meta = [p.pinned ? "置顶" : "", showBoard ? b.name : "", `${e(person(p.by).name)}${isOfficial(p) ? ' <span class="tag line">官方</span>' : ""}`, e(when(last)), last !== p ? `最后回复 ${e(person(last.by).name)}` : ""].filter(Boolean).join(" · ");
  const ref = !(p.items || []).length ? "" : items.length
    ? `关联 · ${e(items[0].title)} $${e(items[0].price)} · ${statusText(items[0])}${items.length > 1 ? ` 等 ${items.length} 件` : ""}`
    : "关联的商品已下架";
  return `<a class="tr" href="#post/${e(p.id)}" data-post-id="${e(p.id)}"><span class="tr-main"><span class="tr-t">${e(p.title)}</span><span class="tr-sub"><span class="tr-x">${e(p.body.replace(/\s+/g, " ").slice(0, 90))}</span><span class="tr-meta">${meta}</span></span>${ref ? `<span class="tr-ref">${ref}</span>` : ""}</span>${n ? `<span class="tr-n" aria-label="${n} 条回复">${n}</span>` : unanswered(p) ? '<span class="tag ask">待回答</span>' : ""}</a>`;
}
function sortTabs(base, sort) {
  return `<div class="list-tabs">${Object.entries(SORTS).map(([key, label]) => `<a class="tab ${sort === key ? "on" : ""}" href="#${base}${key === "active" ? "" : (base.includes("?") ? "&" : "?") + "sort=" + key}"${sort === key ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</div>`;
}
function listView(params, desktop) {
  const q = (params.get("q") || "").trim();
  const slug = params.get("board") || LEGACY_BOARDS[params.get("category")] || params.get("category");
  const b = boardOf(slug);
  if (slug && !b) return homeView(desktop);                       // 不认识的板块回社区首页，不报错（SPEC 4.4）
  const sort = SORTS[params.get("sort")] ? params.get("sort") : "active";
  const side = sidebar(featuredPosts());
  const shell = (main, view) => ({ tab: "home", fab: "compose", search: true, ...view, html: `<div class="wrap"><div class="cols"><div class="main">${main}</div>${side}</div></div>${footer()}` });

  if (q) {
    const found = visiblePosts().filter(p => `${p.title} ${p.body} ${boardOf(p.board).name}`.toLowerCase().includes(q.toLowerCase())).sort(byActive);
    const body = found.length ? found.map(p => topicRow(p, true, true)).join("")
      : stateBox(`没找到和「${q}」有关的话题`, composeLink("发话题", "?title=" + encodeURIComponent(q.slice(0, TITLE_MAX))));
    return shell(`<div class="board-h"><div class="board-h-top"><h1>搜索「${e(q)}」</h1></div>${found.length ? `<p>找到 ${found.length} 个话题</p>` : ""}</div><div class="list">${body}</div>`,
      { top: "title", title: "搜索", back: "home", chips: chips("all") });
  }
  if (b) {
    const all = visiblePosts().filter(p => p.board === b.slug), sorted = sortTopics(all, sort);
    const rows = [...sorted.filter(p => p.pinned), ...sorted.filter(p => !p.pinned)];
    const write = `#compose?board=${b.slug}`;
    const body = !all.length ? stateBox("这个板块还没有话题。", `<a class="btn" href="${write}">发话题</a>`) + fillerRow(b)
      : !rows.length ? stateBox(sort === "ask" ? "目前每个话题都有人回过了" : "还没有话题。")
        : rows.map(p => topicRow(p, false, sort === "active")).join("") + (all.length < 3 ? fillerRow(b) : "");
    return shell(`<div class="board-h b-${b.slug}"><div class="board-h-top"><i class="bar"></i><h1>${b.name}</h1><a class="text-btn" href="${write}">发话题</a></div><p>${b.scope}</p></div>${sortTabs("community?board=" + b.slug, sort)}<div class="list">${body}</div>`,
      { top: "brand", title: b.name, back: "home", chips: chips(b.slug), fab: write.slice(1) });
  }
  const rows = sortTopics(visiblePosts(), sort);
  const body = rows.length ? rows.map(p => topicRow(p, true, sort === "active")).join("")
    : sort === "ask" ? stateBox("目前每个话题都有人回过了")
      : stateBox("还没有话题。可以问一个具体的问题，比如：Urbana 哪里能买到便宜的书桌？", composeLink("发话题"));
  return shell(`${pageHead("全部讨论")}${desktop ? `<div class="filter">${chips("all")}</div>` : ""}${sortTabs("community", sort)}<div class="list">${body}</div>`,
    { top: "title", title: "全部讨论", back: "home", chips: chips("all") });
}

/* ---------- 话题详情（SPEC 6.4、6.6） ---------- */
function itemCard(id) {
  const p = getProduct(id);
  if (!p) return '<p class="ref gone">这件商品已下架</p>';
  return `<a class="ref" href="#product/${e(p.id)}">${thumb(p, "ref-img")}<span class="ref-main"><strong class="ref-t">${e(p.title)}</strong><span class="ref-sub"><span class="price">$${e(p.price)}</span><span class="tag ${p.status === "sold" ? "" : "ok"}">${statusText(p)}</span>${p.by === "viewer" ? '<span class="tag">我的</span>' : ""}</span></span>${icon("chevron-right")}</a>`;
}
function eventCard(id) {
  const ev = state.events.find(x => x.id === id);
  return ev ? `<a class="ref" href="#event/${e(ev.id)}">${dateBlock(ev)}<span class="ref-main"><strong class="ref-t">${e(ev.title)}</strong><span class="ref-sub">${e(ev.weekday)} ${e(ev.time)} · ${e(ev.place)} ${sourceTag(ev)}</span></span>${icon("chevron-right")}</a>` : "";
}
const prose = text => `<div class="prose">${text.split(/\n{2,}/).map(par => `<p>${e(par)}</p>`).join("")}</div>`;
function postView(id) {
  const p = getPost(id), back = { tab: "home", top: "sub", title: "话题", back: "home" };
  if (!p || !boardOf(p.board)) return { ...back, html: `<div class="read">${stateBox("这条话题已被删除", '<a class="btn" href="#home">返回社区</a>')}</div>` };
  if (p.hidden) return { ...back, html: `<div class="read">${stateBox("这条内容已被隐藏", '<a class="btn" href="#home">返回社区</a>')}</div>` };
  const b = boardOf(p.board), n = p.comments.length, saved = state.saved.includes(p.id), watching = state.followed.includes(p.id);
  const refs = [p.eventId ? eventCard(p.eventId) : "", ...(p.items || []).map(itemCard)].join("");
  return {
    ...back, back: "community?board=" + b.slug, reply: true, primary: true,
    html: `<div class="read">
      <article class="topic b-${b.slug}">
        <a class="crumb" href="#community?board=${b.slug}">${b.name} ›</a>
        <h1 class="topic-t">${e(p.title)}</h1>
        <div class="byline">${avatar(p.by)}<span class="by-name">${e(person(p.by).name)}</span>${badge(p.by)}<span class="by-time">${e(when(p))}</span></div>
        ${prose(p.body)}
        ${refs ? `<div class="refs">${refs}</div>` : ""}
        <div class="actions">
          <button type="button" class="btn ${watching ? "is-on" : ""}" data-action="follow" data-id="${e(p.id)}" aria-pressed="${watching}">${icon(watching ? "check" : "bell", 16)}${watching ? "已订阅" : "订阅话题"}</button>
          <button type="button" class="btn ${saved ? "is-on" : ""}" data-action="save" data-id="${e(p.id)}" aria-pressed="${saved}">${icon("bookmark", 16)}${saved ? "已收藏" : "收藏"}</button>
          <button type="button" class="text-btn" data-action="report" data-id="${e(p.id)}">${icon("flag", 14)}举报</button>
        </div>
      </article>
      <section class="replies">
        <h2>${n ? `${n} 条回复` : "回复"}</h2>
        ${p.comments.map(c => `<div class="reply">${avatar(c.by, "sm")}<div class="reply-body"><div class="reply-h"><strong>${e(person(c.by).name)}</strong>${isOfficial(c) ? '<span class="tag line">官方</span>' : ""}<span class="mi">${e(when(c))}</span></div><p>${e(c.body)}</p></div></div>`).join("")}
        ${n ? "" : '<p class="none">还没有回复</p>'}
        <form class="reply-form" data-form="comment" data-id="${e(p.id)}"><label class="sr-only" for="comment-body">回复</label><textarea id="comment-body" name="body" maxlength="${BODY_MAX}" placeholder="写一条回复…"></textarea><button class="btn btn-primary" type="submit">发送</button></form>
      </section>
    </div>`
  };
}

/* ---------- 发话题（SPEC 6.5）：标题最多 120 字，正文最多 2000 字 ---------- */
const hints = b => ({ title: b ? "例如：" + b.titleHint : "一句话说清你想问或想分享什么", body: b ? b.bodyHint : "补充背景和具体问题" });
function composeView(params) {
  const d = state.draft || { board: "", title: "", body: "", items: [] };
  const picked = (boardOf(params.get("board")) || boardOf(d.board) || {}).slug || "";
  const title = d.title || (params.get("title") || "").slice(0, TITLE_MAX), hint = hints(boardOf(picked)), mine = ownActive();
  return {
    tab: "home", top: "sub", title: "发话题", back: picked ? "community?board=" + picked : "home", primary: true,
    html: `<div class="read">${pageHead("发话题")}
      <form class="form" data-form="compose" novalidate>
        ${draftNote ? '<p class="draft-note">已恢复上次没发的内容 · <button type="button" data-action="draft-clear">清空</button></p>' : ""}
        <fieldset class="field"><legend>板块</legend><div class="choices">${BOARDS.map(b => `<label class="choice"><input type="radio" name="board" id="board-${b.slug}" value="${b.slug}"${picked === b.slug ? " checked" : ""}><span>${b.name}</span></label>`).join("")}</div><div class="field-foot"><p class="err" id="err-board" hidden></p></div></fieldset>
        <div class="field"><label for="post-title">标题</label><input class="input" id="post-title" name="title" maxlength="${TITLE_MAX}" autocomplete="off" placeholder="${e(hint.title)}" value="${e(title)}"><div class="field-foot"><p class="err" id="err-title" hidden></p><span class="left" id="title-left"${TITLE_MAX - title.length > 20 ? " hidden" : ""}>还剩 ${TITLE_MAX - title.length} 字</span></div></div>
        <div class="field"><label for="post-body">正文</label><textarea class="input" id="post-body" name="body" rows="8" maxlength="${BODY_MAX}" placeholder="${e(hint.body)}">${e(d.body)}</textarea><div class="field-foot"><p class="err" id="err-body" hidden></p><span class="left" id="body-left">${d.body.length} / ${BODY_MAX}</span></div></div>
        <fieldset class="field"><legend>关联商品 <span class="opt">选填，最多 ${ITEM_MAX} 件</span></legend>${mine.length
          ? `<div class="choices">${mine.map(p => `<label class="choice"><input type="checkbox" name="item:${e(p.id)}" id="item-${e(p.id)}" value="1"${d.items.includes(p.id) ? " checked" : ""}><span>${e(p.title)} · $${e(p.price)}</span></label>`).join("")}</div><div class="field-foot"><p class="err" id="err-items" hidden></p></div>`
          : '<p class="hint">你目前没有在售商品</p>'}</fieldset>
        <div class="form-actions"><a class="btn" href="#${picked ? "community?board=" + picked : "home"}">取消</a><button class="btn btn-primary" type="submit">发布</button></div>
      </form></div>`
  };
}
function readComposer(data) {
  return {
    board: String(data.get("board") || ""),
    title: String(data.get("title") || "").replace(/\s*\n\s*/g, " "),
    body: String(data.get("body") || ""),
    items: ownActive().filter(p => data.get("item:" + p.id)).map(p => p.id)      // 只认自己在售的商品
  };
}
function showError(field, message) {
  const el = $("#err-" + field);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}
function syncComposer(form, changed) {
  const draft = readComposer(new FormData(form));
  if (changed === "board") {
    const hint = hints(boardOf(draft.board));
    $("#post-title").placeholder = hint.title;
    $("#post-body").placeholder = hint.body;
    showError("board", "");
  }
  const left = TITLE_MAX - draft.title.length;
  $("#title-left").textContent = `还剩 ${left} 字`;
  $("#title-left").hidden = left > 20;
  $("#body-left").textContent = `${draft.body.length} / ${BODY_MAX}`;
  showError("items", draft.items.length > ITEM_MAX ? `已达 ${ITEM_MAX} 件上限` : "");
  state.draft = draft;
  persist();
}

/* ---------- 二手、消息 ---------- */
function marketView() {
  return {
    tab: "market", top: "title", title: "二手",
    html: `<div class="wrap"><div class="solo">${pageHead("二手")}<div class="grid">${state.products.map(p => `<a class="good" href="#product/${e(p.id)}"><span class="good-img">${thumb(p, "")}${p.status === "sold" ? '<span class="tag">已售出</span>' : ""}</span><span class="good-t">${e(p.title)}</span><span class="price">$${e(p.price)}</span><span class="good-m">${e(p.condition)} · ${e(p.location)}</span></a>`).join("")}</div></div></div>`
  };
}
function productView(id) {
  const p = getProduct(id), base = { tab: "market", top: "sub", title: "商品", back: "market" };
  if (!p) return { ...base, html: `<div class="read">${stateBox("这件商品已下架", '<a class="btn" href="#market">返回二手</a>')}</div>` };
  const mine = p.by === "viewer", sold = p.status === "sold";
  const linked = visiblePosts().filter(x => (x.items || []).includes(id));
  const action = mine
    ? `<p class="hint">这是你发布的商品</p><button type="button" class="btn btn-block" data-action="sold" data-id="${e(p.id)}">${sold ? "恢复在售" : "标记为已售出"}</button>`
    : `<button type="button" class="btn btn-primary btn-block" data-action="contact" data-id="${e(p.id)}"${sold ? " disabled" : ""}>${sold ? "已售出" : `${icon("mail", 16)}私信卖家`}</button>`;
  return {
    ...base, primary: !mine && !sold,
    html: `<div class="wrap"><div class="solo">
      <div class="product"><div class="product-photo">${p.image ? `<img src="${e(p.image)}" alt="${e(p.title)}（图库素材照片，不是在售实物）">` : thumb(p, "")}</div><div class="product-info"><span class="tag ${sold ? "" : "ok"}">${statusText(p)}</span><h1>${e(p.title)}</h1><span class="price">$${e(p.price)}</span><p class="hint">${e(p.condition)}</p>${prose(p.description)}
        <div class="seller">${avatar(p.by)}<span class="seller-main"><strong>${e(person(p.by).name)}</strong><span>${e(p.location)}</span></span>${person(p.by).verified ? '<span class="tag ok">✓ 已验证</span>' : ""}</div>${action}</div></div>
      ${linked.length ? `<h2 class="sub-h">提到这件商品的话题</h2><div class="list">${linked.map(x => topicRow(x, true)).join("")}</div>` : ""}
    </div></div>`
  };
}
function messagesView(params) {
  const p = getProduct(params.get("product") || state.messages.at(-1)?.productId), base = { tab: "messages", top: "title", title: "消息" };
  if (!p) return { ...base, html: `<div class="read">${pageHead("消息")}<div class="thread">${stateBox("还没有消息。在商品页点「私信卖家」，对话会带上那件商品。", '<a class="btn" href="#market">去二手看看</a>')}</div></div>` };
  const sent = state.messages.filter(m => m.productId === p.id), open = p.status !== "sold" && p.by !== "viewer";
  return {
    ...base, primary: open,
    html: `<div class="read">${pageHead("消息")}<div class="thread">
      <div class="thread-h">${avatar(p.by)}<strong>${e(person(p.by).name)}</strong></div>
      <div class="refs">${itemCard(p.id)}</div>
      <div class="bubbles">${sent.map(m => `<p class="bubble">${e(m.body)}</p>`).join("")}</div>
      ${open ? `<form class="msg-form" data-form="message" data-id="${e(p.id)}"><label class="sr-only" for="message-body">消息内容</label><input class="input" id="message-body" name="body" maxlength="1000" autocomplete="off" placeholder="输入消息…"><button class="btn btn-primary" type="submit">发送</button></form>`
        : '<p class="note">这件商品已售出，不能再发消息。之前的内容还在。</p>'}
    </div></div>`
  };
}

/* ---------- 活动：四种来源同一种卡片（SPEC 6.7） ---------- */
function eventsView(params) {
  const source = SOURCES[params.get("source")] ? params.get("source") : "";
  const list = state.events.filter(ev => eventShown(ev) && (!source || ev.source === source)).sort((a, b) => a.inDays - b.inDays);
  const card = ev => {
    const n = getPost(ev.discussion)?.comments.length || 0;
    return `<a class="ev" href="#event/${e(ev.id)}">${dateBlock(ev)}<span class="ev-main"><strong class="ev-t">${e(ev.title)}</strong><span class="ev-when">${e(ev.weekday)} ${e(ev.time)} · ${e(ev.place)}</span><span class="ev-tags">${sourceTag(ev)}${ev.source === "member" ? `<span class="ev-by">${avatar(ev.by, "xs")}${e(person(ev.by).name)}</span>` : ""}</span></span>${n ? `<span class="mi">${n} 条回复</span>` : ""}</a>`;
  };
  const groups = [...new Set(list.map(ev => ev.group))].map(g => `<h2 class="day-h">${e(g)}</h2>${list.filter(ev => ev.group === g).map(card).join("")}`).join("");
  const filters = `<a class="chip ${source ? "" : "on"}" href="#events">全部</a>${Object.entries(SOURCES).map(([key, s]) => `<a class="chip ${source === key ? "on" : ""}" href="#events?source=${key}">${s.filter}</a>`).join("")}`;
  return {
    tab: "events", top: "title", title: "活动", chips: filters,
    html: `<div class="wrap"><div class="cols"><div class="main">${pageHead("活动")}<div class="filter desk">${filters}</div><div class="list">${groups || stateBox("近期没有收录的活动")}</div></div>
      <aside class="side"><section class="sb"><h2 class="sb-h">来源怎么看</h2><ul class="src-list">${Object.entries(SOURCES).map(([key, s]) => `<li><span class="tag ${s.cls}">${e(s.tag({ org: "组织名" }))}</span>${s.about}</li>`).join("")}</ul></section></aside></div></div>`
  };
}
function eventView(id) {
  const ev = state.events.find(x => x.id === id), base = { tab: "events", top: "sub", title: "活动", back: "events" };
  if (!ev || !eventShown(ev)) return { ...base, html: `<div class="read">${stateBox("这场活动已不再展示", '<a class="btn" href="#events">返回活动</a>')}</div>` };
  const talk = getPost(ev.discussion), n = talk ? talk.comments.length : 0;
  const out = (label, primary) => `<button type="button" class="btn ${primary ? "btn-primary " : ""}btn-block" data-action="outlink">${label}</button>`;
  const cta = {
    caaci: `${out("去 CAACI 官网报名", true)}<p class="hint">报名结果以 CAACI 官网邮件为准</p>`,
    partner: `${out("去主办方报名（docs.google.com）", true)}${out("查看原页", false)}<p class="hint">报名和名额由 ${e(ev.org)} 负责</p>`,
    campus: out("查看学校页面", false),
    member: talk ? `<a class="btn btn-primary btn-block" href="#post/${e(talk.id)}">参加讨论${n ? ` · ${n} 条回复` : ""}</a>` : ""
  }[ev.source];
  return {
    ...base, primary: ev.source !== "campus",
    html: `<div class="read"><article class="event">
      <h1>${e(ev.title)}</h1>
      <p class="src-line">${sourceTag(ev)}<span>${e(SOURCES[ev.source].line(ev))}</span></p>
      <div class="facts"><p class="fact">${icon("clock", 16)}<span>${e(ev.full)}</span></p><p class="fact">${icon("map-pin", 16)}<span>${e(ev.place)}</span></p></div>
      ${prose(ev.source === "member" && talk ? talk.body : ev.intro)}
      ${ev.source === "member" ? `<div class="organizer">${avatar(ev.by)}<span class="by-name">${e(person(ev.by).name)}</span>${badge(ev.by)}</div>` : ""}
      ${cta}
      ${ev.source === "member" ? '<p class="note">见面选公共场所；费用当面 AA，不要提前转账给不认识的人；遇到问题点话题里的「举报」。</p>' : ""}
      ${ev.checked ? `<p class="hint">来源信息核对于 ${e(ev.checked)}</p>` : ""}
    </article></div>`
  };
}

/* ---------- 我的、新来先看、演示说明、处理举报 ---------- */
const REPORT_STATUS = { pending: ["处理中", "ask"], hidden: ["已处理：内容已隐藏", ""], resolved: ["已结案：内容保留", ""] };
function reportList(admin) {
  return state.reports.map(r => {
    const p = getPost(r.postId), [label, cls] = REPORT_STATUS[r.status] || REPORT_STATUS.pending;
    return `<article class="report"><div class="report-top"><span class="tag ${cls}">${label}</span><span class="mi">举报 ${e(r.id)}</span></div><h3><a href="#post/${e(r.postId)}">${e(p?.title || "这条话题已被删除")}</a></h3><p>${e(r.reason)}${r.detail ? "：" + e(r.detail) : ""}</p>${admin ? `<div class="report-actions"><button type="button" class="btn" data-action="moderate" data-id="${e(r.id)}" data-result="hidden"${r.status === "hidden" ? " disabled" : ""}>隐藏</button><button type="button" class="btn" data-action="moderate" data-id="${e(r.id)}" data-result="resolved"${r.status === "resolved" ? " disabled" : ""}>${r.status === "hidden" ? "恢复显示" : "驳回举报"}</button></div>` : ""}</article>`;
  }).join("");
}
function ownRow(p, others) {
  return `<div class="own">${thumb(p, "item-img")}<a class="item-t" href="#product/${e(p.id)}">${e(p.title)}${others ? ` · ${e(person(p.by).name)}` : ""}</a><span class="tag ${p.status === "sold" ? "" : "ok"}">${statusText(p)}</span><button type="button" class="btn" data-action="sold" data-id="${e(p.id)}">${p.status === "sold" ? "恢复在售" : "标记为已售出"}</button></div>`;
}
function profileView() {
  const authored = state.posts.filter(p => p.by === "viewer" && boardOf(p.board));
  const pickIds = ids => visiblePosts().filter(p => ids.includes(p.id));
  const saved = pickIds(state.saved), watching = pickIds(state.followed), mine = state.products.filter(p => p.by === "viewer");
  const section = (title, rows, none) => `<div class="sub-h-row"><h2>${title}</h2>${rows.length ? `<span class="cnt">${rows.length}</span>` : ""}</div><div class="list">${rows.length ? rows.join("") : `<p class="none pad">${none}</p>`}</div>`;
  return {
    tab: "profile", top: "title", title: "我的",
    html: `<div class="read">${pageHead("我的")}
      <div class="me">${avatar("viewer", "lg")}<h2>我</h2></div>
      ${section("我的话题", authored.map(p => (p.hidden ? `<a class="tr" href="#post/${e(p.id)}"><span class="tr-main"><span class="tr-t">${e(p.title)}</span></span><span class="tag">已隐藏</span></a>` : topicRow(p, true))), "还没有发过话题")}
      ${section("我的收藏", saved.map(p => topicRow(p, true)), "还没有收藏")}
      ${section("订阅的话题", watching.map(p => topicRow(p, true)), "还没有订阅话题")}
      ${section("我的物品", mine.map(p => ownRow(p, false)), "你目前没有在售商品")}
      ${state.reports.length ? `<div class="sub-h-row"><h2>我的举报</h2></div><div class="list">${reportList(false)}</div>` : ""}
      <div class="sub-h-row"><h2>更多</h2></div>
      <div class="menu"><a href="#guide">新来先看${icon("chevron-right", 16)}</a><a href="#about">演示说明${icon("chevron-right", 16)}</a></div>
    </div>`
  };
}
function guideView() {
  const rows = featuredPosts();
  return { tab: "home", top: "sub", title: "新来先看", back: "home", html: `<div class="read">${pageHead("新来先看")}<div class="list">${rows.length ? rows.map(p => topicRow(p, true)).join("") : stateBox("还没有话题。")}</div></div>` };
}
function adminView() {
  return {
    tab: "profile", top: "sub", title: "处理举报", back: "about",
    html: `<div class="read">${pageHead("处理举报", '<a class="link" href="#about">返回演示说明</a>')}<div class="list">${state.reports.length ? reportList(true) : stateBox("现在没有举报。在任意话题里点「举报」，再回到这里处理。")}</div></div>`
  };
}
function aboutView() {
  const pending = state.reports.filter(r => r.status === "pending").length;
  const others = state.products.filter(p => p.by !== "viewer");
  return {
    tab: "profile", top: "sub", title: "演示说明", back: "home",
    html: `<div class="read">${pageHead("演示说明")}<article class="doc">
      <h2>这是什么</h2>
      <p>玉米地（Cornfield）是伊利诺伊华人论坛，现开放香槟地区。这里是它的演示站，用来看产品长什么样、怎么用。</p>
      <h2>可以试什么</h2>
      <ul><li>发话题，关联自己在售的商品，回复，收藏和订阅话题。</li><li>从商品页给卖家发私信；商品售出后，关联的话题和私信会跟着变。</li><li>看四种来源的活动：CAACI 主办、转发、学校活动、网友发起。</li><li>举报一条话题，再到下面自己处理。</li></ul>
      <h2>和正式版不一样的地方</h2>
      <p>这里的人物、话题、回复和商品都是虚构的。没有账号、登录、通知、报名和付款，报名按钮不会打开外部页面。你的操作只保存在这个浏览器里，别人看不到；点页面顶部的「重置」可以清掉。</p>
      <h2>处理举报</h2>
      <p>正式版只有管理员能处理举报。这里可以自己试一遍：隐藏、驳回、恢复显示。</p>
      <a class="btn" href="#admin">处理举报${pending ? `（${pending} 条待处理）` : ""}</a>
      <h2>替卖家改商品状态</h2>
      <p>正式版只有卖家本人能改。这里可以替别的卖家改，看关联的话题和私信怎么跟着变。</p>
      ${others.map(p => ownRow(p, true)).join("")}
      <h2>照片与图标</h2>
      <p>商品照片是图库素材，不是在售实物。</p>
      <ul>
        <li><a href="https://www.pexels.com/photo/a-monitor-on-a-desk-19761838/" target="_blank" rel="noopener noreferrer">显示器照片 · Amar Preciado / Pexels</a></li>
        <li><a href="https://www.pexels.com/photo/close-up-photo-of-stack-of-books-7034089/" target="_blank" rel="noopener noreferrer">书籍照片 · George Milton / Pexels</a></li>
        <li><a href="https://www.pexels.com/photo/black-and-silver-table-lamps-on-white-table-7439756/" target="_blank" rel="noopener noreferrer">台灯照片 · cottonbro studio / Pexels</a></li>
        <li><a href="https://www.pexels.com/license/" target="_blank" rel="noopener noreferrer">Pexels 素材许可</a></li>
        <li><a href="assets/feather-LICENSE.txt">Feather Icons 4.29.2 · MIT License</a></li>
      </ul>
    </article></div>`
  };
}

/* ---------- 外壳：页头、板块标签、底部 tab，再画当前这一页 ---------- */
function desktopNav(tab) {
  return `<details class="nav-menu"><summary class="nav-i ${tab === "home" ? "on" : ""}">社区${icon("chevron-down", 14)}</summary><div class="nav-pop">${BOARDS.map(b => `<a class="b-${b.slug}" href="#community?board=${b.slug}"><i class="bar"></i>${b.name}</a>`).join("")}<a class="all" href="#community">全部讨论</a></div></details>`
    + `<a class="nav-i ${tab === "market" ? "on" : ""}" href="#market"${tab === "market" ? ' aria-current="page"' : ""}>二手</a><a class="nav-i ${tab === "events" ? "on" : ""}" href="#events"${tab === "events" ? ' aria-current="page"' : ""}>活动</a>`;
}
function render() {
  const oldRoute = renderedRoute, focus = captureView();
  const { path, params } = route(), key = location.hash || "#home", desktop = wide.matches;
  const [root, ...rest] = path.split("/"), id = rest.join("/");
  if (oldRoute !== key) draftNote = root === "compose" && Boolean(state.draft && (state.draft.title || state.draft.body || state.draft.items.length));
  const view = root === "home" ? homeView(desktop)
    : root === "community" ? listView(params, desktop)
      : root === "post" ? postView(id)
        : root === "compose" ? composeView(params)
          : root === "market" ? marketView()
            : root === "product" ? productView(id)
              : root === "events" ? eventsView(params)
                : root === "event" ? eventView(id)
                  : root === "messages" ? messagesView(params)
                    : root === "profile" ? profileView()
                      : root === "guide" ? guideView()
                        : root === "admin" ? adminView()
                          : root === "about" ? aboutView()
                            : root === "offer" ? listView(new URLSearchParams("board=local-deals"), desktop)   // 优惠页已取消，旧链接落到吃喝好店
                              : { tab: "home", top: "sub", title: "页面不存在", back: "home", html: `<div class="read">${stateBox("页面不存在", '<a class="btn" href="#home">返回社区</a>')}</div>` };

  $("#topbar").className = `topbar m-${view.top}${view.back ? " has-back" : ""}${view.search ? " has-search" : ""}${searchOpen ? " search-open" : ""}`;
  $("#top-title").textContent = view.title;
  $("#top-back").href = "#" + (view.back || "home");
  $("#desktop-nav").innerHTML = desktopNav(view.tab);
  $("#top-compose").hidden = root === "compose";
  $("#top-compose").className = `btn tb-compose${view.primary ? "" : " btn-primary"}`;       // 一屏只留一个主色实心按钮（SPEC 9.4）
  $("#chips").innerHTML = view.chips || "";
  $("#chips").hidden = !view.chips;
  $("#mobile-nav").innerHTML = NAV.map(([to, glyph, label]) => `<a class="${view.tab === to ? "on" : ""}" href="#${to}"${view.tab === to ? ' aria-current="page"' : ""}>${icon(glyph, 22)}<span>${label}</span></a>`).join("");
  $("#fab").hidden = !view.fab;
  $("#fab").href = "#" + (view.fab || "compose");
  $("body").className = `${view.top === "sub" ? "is-sub" : "is-tab"}${view.fab ? " has-fab" : ""}${view.reply ? " has-reply" : ""}`;
  $("#main").innerHTML = view.html;
  renderedRoute = key;
  restoreView(key, focus, oldRoute === key);
  updateStorageNotice();
  document.title = `${view.title} · 玉米地`;
}
function hydrateIcons() {
  for (const node of document.querySelectorAll?.("[data-icon]") || []) node.innerHTML = icon(node.dataset.icon, Number(node.dataset.iconSize) || 18);
}

/* ---------- 操作 ---------- */
document.addEventListener("click", event => {
  const menu = $(".nav-menu");
  if (menu?.open && (!menu.contains?.(event.target) || event.target.closest?.("a"))) menu.open = false;
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const id = action.dataset.id;
  switch (action.dataset.action) {
    case "reset":
      $("#reset-start").hidden = true;
      $("#reset-confirmation").hidden = false;
      $("#reset-confirm-button").focus();
      break;
    case "reset-cancel":
      $("#reset-confirmation").hidden = true;
      $("#reset-start").hidden = false;
      $("#reset-start").focus();
      break;
    case "reset-confirm":
      state = seed();
      viewDrafts.clear();
      skipDraftCapture = true;
      persist();
      homeTab = HOME_TABS[0];
      startOpen = searchOpen = false;
      $("#search-input").value = "";
      $("#reset-confirmation").hidden = true;
      $("#reset-start").hidden = false;
      navigate("home");
      render();
      toast("已重置");
      break;
    case "back":                                   // 站内走过来的就退回上一页，直接打开的才用链接上的上级页
      if (visits > 0 && typeof history !== "undefined") { event.preventDefault(); history.back(); }
      break;
    case "search-open":
      searchOpen = true;
      $("#topbar").classList.add("search-open");
      $("#search-input").focus();
      break;
    case "search-close":
      searchOpen = false;
      $("#topbar").classList.remove("search-open");
      break;
    case "home-tab": homeTab = action.dataset.tab; render(); break;
    case "start-toggle": startOpen = !startOpen; render(); break;
    case "draft-clear":
      state.draft = null;
      draftNote = false;
      discardDraft();
      persist();
      render();
      break;
    case "save":
      if (state.saved.includes(id)) state.saved = state.saved.filter(x => x !== id); else state.saved.push(id);
      persist();
      render();
      toast(state.saved.includes(id) ? "已收藏" : "已取消收藏");
      break;
    case "follow":
      if (state.followed.includes(id)) state.followed = state.followed.filter(x => x !== id); else state.followed.push(id);
      persist();
      render();
      toast(state.followed.includes(id) ? "已订阅" : "已取消订阅");
      break;
    case "report":
      $("#report-form").reset();
      $('#report-form [name="postId"]').value = id;
      $("#report-dialog").showModal();
      break;
    case "close-report": $("#report-dialog").close(); break;
    case "sold": {
      const p = getProduct(id);
      if (p) {
        p.status = p.status === "sold" ? "available" : "sold";
        persist();
        render();
        toast(p.status === "sold" ? "已标记为售出" : "已恢复在售");
      }
      break;
    }
    case "contact": {
      const p = getProduct(id);
      if (p?.status === "available" && p.by !== "viewer") navigate("messages?product=" + encodeURIComponent(id));
      else toast("这件商品现在不能私信");
      break;
    }
    case "outlink": toast("演示站不会打开外部页面"); break;
    case "moderate": {
      const report = state.reports.find(x => x.id === id);
      if (report) {
        report.status = action.dataset.result;
        const p = getPost(report.postId);
        if (p) p.hidden = report.status === "hidden";
        persist();
        render();
        toast(report.status === "hidden" ? "已隐藏" : "内容保持显示");
      }
      break;
    }
  }
});

for (const type of ["input", "change"]) {
  document.addEventListener(type, event => {
    const form = event.target.closest?.('[data-form="compose"]');
    if (form) syncComposer(form, event.target.name);
  });
}

document.addEventListener("submit", event => {
  const form = event.target;
  if (form.id === "global-search") {
    event.preventDefault();
    const q = $("#search-input").value.trim();
    searchOpen = false;
    $("#topbar").classList.remove("search-open");
    $("#search-input").blur();
    navigate("community" + (q ? "?q=" + encodeURIComponent(q) : ""));
    return;
  }
  if (form.id === "report-form") {
    event.preventDefault();
    const data = new FormData(form), postId = String(data.get("postId"));
    if (!getPost(postId)) return;
    state.reports.unshift({ id: nextId("r"), postId, reason: String(data.get("reason")), detail: String(data.get("detail")).trim().slice(0, 500), status: "pending" });
    persist();
    $("#report-dialog").close();
    render();
    toast("已收到（演示站，可以到「演示说明」里自己处理）");
    return;
  }
  if (!form.dataset.form) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.dataset.form === "compose") {
    const draft = readComposer(data), title = draft.title.trim(), body = draft.body.trim();
    const errors = [
      ["board", boardOf(draft.board) ? "" : "请选一个板块", "#board-" + BOARDS[0].slug],
      ["title", !title ? "请填写标题" : title.length > TITLE_MAX ? `标题最多 ${TITLE_MAX} 字` : "", "#post-title"],
      ["body", !body ? "请填写正文" : body.length > BODY_MAX ? `正文最多 ${BODY_MAX} 字` : "", "#post-body"],
      ["items", draft.items.length > ITEM_MAX ? `已达 ${ITEM_MAX} 件上限` : "", "#item-" + draft.items[0]]
    ];
    for (const [field, message] of errors) showError(field, message);
    const first = errors.find(([, message]) => message);
    if (first) { $(first[2]).focus(); return; }                      // 错误写在字段下面，焦点到第一个出错的字段
    const post = { id: nextId("u"), board: draft.board, by: "viewer", at: Date.now(), title, body, comments: [] };
    if (draft.items.length) post.items = draft.items;
    state.posts.unshift(post);
    state.draft = null;
    discardDraft();
    persist();
    navigate("post/" + post.id);
    toast("已发布");
  } else if (form.dataset.form === "comment") {
    const body = String(data.get("body")).trim().slice(0, BODY_MAX), p = getPost(form.dataset.id);
    if (!body) { $("#comment-body").focus(); return; }
    if (!p || p.hidden) { toast("这条内容已被隐藏"); return; }
    p.comments.push({ by: "viewer", at: Date.now(), body });
    discardDraft();
    persist();
    render();
    toast("已回复");
  } else if (form.dataset.form === "message") {
    const body = String(data.get("body")).trim().slice(0, 1000), p = getProduct(form.dataset.id);
    if (!body) { $("#message-body").focus(); return; }
    if (!p || p.status === "sold" || p.by === "viewer") { toast("这件商品现在不能私信"); return; }
    state.messages.push({ productId: p.id, body });
    discardDraft();
    persist();
    render();
    $("#message-body")?.focus();
    toast("已发送（演示站，对方收不到）");
  }
});

window.addEventListener("hashchange", () => {
  visits++;
  searchOpen = false;
  syncSearchFromRoute();
  render();
  window.scrollTo(0, 0);
  $("#main").focus({ preventScroll: true });
});
wide.addEventListener?.("change", render);      // 跨过 1024 时首页每块放几条会变，重画一次

hydrateIcons();
syncSearchFromRoute();
render();
