const SUPABASE_STORAGE_MARKER = "/storage/v1/object/public/"
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/"

export function thumbUrl(
  url: string | null | undefined,
  size: "list" | "card" | "detail" | "avatar" = "list",
): string {
  if (!url) return ""
  if (!url.includes(SUPABASE_STORAGE_MARKER)) return url
  const rendered = url.replace(SUPABASE_STORAGE_MARKER, SUPABASE_RENDER_PATH)
  // Do NOT add `resize=cover` for list/card: without a matching `height`
  // Supabase image-transform crops to a square and chops tall/wide photos.
  const params =
    size === "avatar" ? "width=96&height=96&quality=75&resize=cover"
    : size === "list" ? "width=480&quality=72"
    : size === "card" ? "width=640&quality=75"
    : "width=1280&quality=82"
  return `${rendered}?${params}`
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}

const RATE_LIMIT_MESSAGES: Record<string, { en: string; zh: string }> = {
  rate_limit_items_hour:    { en: 'Too many items this hour. Try again later.',       zh: '本小时发布太多,稍后再试' },
  rate_limit_items_day:     { en: 'Daily item limit reached. Try again tomorrow.',    zh: '今日已达发布上限' },
  duplicate_item:           { en: 'You just posted this. Wait a moment.',              zh: '刚刚已发布过这条,请稍等' },
  rate_limit_posts_hour:    { en: 'Too many posts this hour. Slow down.',              zh: '本小时发帖太多,慢一点' },
  rate_limit_posts_day:     { en: 'Daily post limit reached.',                         zh: '今日已达发帖上限' },
  duplicate_post:           { en: 'You just posted that. Please wait.',                zh: '刚刚已发过这条' },
  rate_limit_comments_hour: { en: 'Commenting too fast. Please wait a minute.',        zh: '评论太快,请稍等' },
  rate_limit_comments_day:  { en: 'Daily comment limit reached.',                      zh: '今日评论已达上限' },
  duplicate_comment:        { en: 'You just wrote that. Please wait.',                 zh: '刚刚写过这条评论' },
  rate_limit_messages_minute: { en: 'Slow down — too many messages.',                  zh: '发送太快,请慢一点' },
  rate_limit_messages_hour: { en: 'Hourly message limit reached.',                     zh: '本小时消息已达上限' },
  duplicate_message:        { en: 'Duplicate message blocked.',                        zh: '重复消息已拦截' },
  rate_limit_reports_hour:  { en: 'Too many reports recently.',                        zh: '举报太频繁' },
  rate_limit_reports_day:   { en: 'Daily report limit reached.',                       zh: '今日举报已达上限' },
  reports_unique_reporter_target: { en: 'You have already reported this.',             zh: '你已举报过这个' },
}

export function friendlyErrorMessage(err: any, lang: 'en' | 'zh' = 'en'): string {
  if (!err) return ''
  const raw = String(err?.message || err?.code || err || '').toLowerCase()
  for (const key of Object.keys(RATE_LIMIT_MESSAGES)) {
    if (raw.includes(key.toLowerCase())) {
      return RATE_LIMIT_MESSAGES[key][lang]
    }
  }
  if (raw.includes('duplicate key') || err?.code === '23505') {
    return lang === 'zh' ? '刚刚已提交过,请稍等' : 'Already submitted. Please wait.'
  }
  if (raw.includes('jwt') || raw.includes('not authenticated')) {
    return lang === 'zh' ? '请重新登录' : 'Please sign in again'
  }
  if (err?.code === '23514' && raw.includes('reports_target_type_check')) {
    return lang === 'zh' ? '举报功能尚未就绪,请联系管理员' : 'Report type not allowed yet — DB migration pending'
  }
  if (err?.code === '42703') {
    return lang === 'zh' ? '功能即将上线,请刷新后重试' : 'Feature rolling out — please refresh'
  }
  return err?.message || (lang === 'zh' ? '操作失败' : 'Something went wrong')
}

export function haptic(style: 'light' | 'medium' | 'heavy' = 'light') {
  // #ifdef H5
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      const ms = style === 'light' ? 8 : style === 'medium' ? 15 : 25
      navigator.vibrate(ms)
    }
  } catch {}
  // #endif
  // #ifndef H5
  try { uni.vibrateShort?.({ type: style === 'heavy' ? 'heavy' : 'light' } as any) } catch {}
  // #endif
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

const SEARCH_SYNONYMS: [string, string[]][] = [
  ['电脑', ['computer', 'laptop', 'macbook', 'pc', 'dell', 'thinkpad', 'surface', 'lenovo', 'hp', 'asus', 'acer', 'razer', 'alienware']],
  ['笔记本', ['laptop', 'notebook', 'macbook', 'thinkpad', 'surface', '电脑']],
  ['台式', ['desktop', 'pc', 'tower']],
  ['苹果', ['apple', 'mac', 'macbook', 'imac', 'iphone', 'ipad']],
  ['手机', ['phone', 'iphone', 'samsung', 'pixel', 'android', 'oneplus', 'xiaomi', 'huawei']],
  ['iphone', ['苹果', '手机', 'iPhone']],
  ['ipad', ['平板', '苹果平板']],
  ['mac', ['apple', 'macbook', '苹果', 'imac']],
  ['耳机', ['headphone', 'earphone', 'airpod', 'earbud', 'beats', 'sony', 'bose', 'sennheiser', 'earbuds', 'headphones']],
  ['airpod', ['耳机', 'airpods', 'apple earbud']],
  ['平板', ['tablet', 'ipad', 'surface']],
  ['显示器', ['monitor', 'display', 'screen', 'lg', 'dell monitor', 'asus monitor']],
  ['键盘', ['keyboard', 'mechanical', 'keychron', 'logitech keyboard', 'apple keyboard', 'magic keyboard']],
  ['鼠标', ['mouse', 'logitech', 'razer', 'magic mouse']],
  ['相机', ['camera', 'canon', 'sony', 'nikon', 'fuji', 'fujifilm', 'gopro', 'dslr', 'mirrorless']],
  ['摄像机', ['camcorder', 'video camera']],
  ['打印机', ['printer', 'hp printer', 'canon printer', 'epson']],
  ['游戏机', ['console', 'playstation', 'ps5', 'ps4', 'xbox', 'switch', 'nintendo']],
  ['switch', ['nintendo', '任天堂', '游戏机']],
  ['ps5', ['playstation', 'ps4', '游戏机', 'sony console']],
  ['充电器', ['charger', 'adapter', 'power brick', 'magsafe', 'usb-c']],
  ['数据线', ['cable', 'usb', 'lightning', 'usb-c', 'thunderbolt']],
  ['电池', ['battery', 'power bank', '充电宝', 'anker']],
  ['充电宝', ['power bank', 'portable charger', 'anker', '移动电源']],

  ['自行车', ['bike', 'bicycle', 'cycling', 'trek', 'giant', 'specialized', 'mountain bike', 'road bike']],
  ['山地车', ['mountain bike', 'mtb']],
  ['公路车', ['road bike']],
  ['电动车', ['electric scooter', 'e-bike', 'ebike', 'scooter']],
  ['滑板', ['skateboard', 'longboard', 'penny']],
  ['车', ['car', 'vehicle', 'toyota', 'honda', 'civic', 'corolla', 'camry', 'altima']],
  ['轮胎', ['tire', 'tires']],
  ['头盔', ['helmet']],

  ['沙发', ['sofa', 'couch', 'loveseat', 'sectional']],
  ['茶几', ['coffee table']],
  ['餐桌', ['dining table', 'dinner table']],
  ['餐椅', ['dining chair']],
  ['桌子', ['desk', 'table', 'ikea linnmon', 'bekant']],
  ['书桌', ['desk', 'study desk', 'ikea linnmon', 'standing desk']],
  ['办公椅', ['office chair', 'herman miller', 'ikea markus', 'ergonomic chair']],
  ['椅子', ['chair', 'herman miller', 'aeron', 'ikea chair']],
  ['床', ['bed', 'mattress', 'bedframe', 'twin', 'full', 'queen', 'king']],
  ['床垫', ['mattress', 'tuft and needle', 'purple', 'casper', 'tempur']],
  ['床架', ['bed frame', 'bedframe', 'platform bed']],
  ['衣柜', ['wardrobe', 'closet', 'ikea pax']],
  ['书柜', ['bookshelf', 'bookcase', 'ikea billy']],
  ['货架', ['shelf', 'shelving', 'kallax']],
  ['抽屉', ['drawer', 'dresser']],
  ['台灯', ['lamp', 'desk lamp', 'light', 'floor lamp']],
  ['镜子', ['mirror', 'full length mirror']],
  ['地毯', ['rug', 'carpet']],

  ['书', ['book', 'textbook', 'hardcover', 'paperback']],
  ['教材', ['textbook', 'course book', 'course material']],
  ['笔记', ['notes', 'notebook']],
  ['文具', ['stationery', 'pen', 'pencil', 'highlighter']],

  ['衣服', ['clothes', 'clothing', 'jacket', 'coat', 'shirt', 'hoodie']],
  ['外套', ['jacket', 'coat', 'north face', 'patagonia', 'canada goose']],
  ['羽绒服', ['down jacket', 'puffer', 'uniqlo down']],
  ['卫衣', ['hoodie', 'sweatshirt']],
  ['t恤', ['t-shirt', 'tee', 'shirt']],
  ['裤子', ['pants', 'jeans', 'trousers']],
  ['裙子', ['skirt', 'dress']],
  ['连衣裙', ['dress']],
  ['鞋', ['shoe', 'sneaker', 'nike', 'adidas', 'new balance', 'converse', 'vans']],
  ['运动鞋', ['sneaker', 'nike', 'adidas', 'new balance', 'running shoes']],
  ['靴子', ['boots', 'doc martens', 'timberland', 'uggs']],
  ['包', ['bag', 'backpack', 'purse', 'handbag', 'tote']],
  ['书包', ['backpack', 'school bag', 'jansport', 'northface backpack']],
  ['手提包', ['handbag', 'tote', 'purse']],
  ['帽子', ['hat', 'cap', 'beanie']],
  ['围巾', ['scarf']],

  ['租房', ['housing', 'apartment', 'sublease', 'sublet', 'rent', 'lease', 'studio']],
  ['转租', ['sublease', 'sublet', 'rent', 'takeover']],
  ['室友', ['roommate']],
  ['公寓', ['apartment', 'studio', 'one bedroom', 'two bedroom']],

  ['家具', ['furniture', 'ikea']],
  ['厨具', ['kitchen', 'cookware', 'pot', 'pan']],
  ['锅', ['pot', 'pan', 'wok', 'cooker']],
  ['电饭锅', ['rice cooker', 'zojirushi']],
  ['冰箱', ['fridge', 'refrigerator', 'mini fridge']],
  ['微波炉', ['microwave']],
  ['烤箱', ['oven', 'toaster oven', 'air fryer']],
  ['空气炸锅', ['air fryer', 'ninja']],
  ['洗衣机', ['washer', 'washing machine']],
  ['烘干机', ['dryer']],
  ['吸尘器', ['vacuum', 'dyson', 'roomba']],
  ['加湿器', ['humidifier']],
  ['净水器', ['water filter', 'brita']],
  ['电风扇', ['fan', 'electric fan']],
  ['空调', ['ac', 'air conditioner']],

  ['化妆品', ['makeup', 'cosmetics', 'lipstick', 'foundation']],
  ['护肤品', ['skincare', 'lotion', 'serum']],
  ['香水', ['perfume', 'cologne']],

  ['乐器', ['instrument', 'guitar', 'piano', 'keyboard', 'violin']],
  ['吉他', ['guitar', 'acoustic', 'electric', 'fender', 'gibson', 'yamaha']],
  ['钢琴', ['piano', 'keyboard', 'yamaha piano']],

  ['玩具', ['toy', 'lego', 'plush']],
  ['毛绒', ['plush', 'stuffed animal']],

  ['团购', ['group buy', 'bulk', 'share']],
  ['换币', ['exchange', 'currency', 'rmb', 'cny', 'yuan', 'dollar', 'usd']],
  ['人民币', ['rmb', 'cny', 'yuan', 'chinese yuan']],
  ['美元', ['usd', 'dollar', 'us dollar', 'cash']],

  ['laptop', ['笔记本', '电脑']],
  ['phone', ['手机']],
  ['bike', ['自行车', '单车']],
  ['car', ['车', '汽车']],
  ['desk', ['桌子', '书桌']],
  ['chair', ['椅子']],
  ['bed', ['床']],
  ['mattress', ['床垫']],
  ['sofa', ['沙发']],
  ['couch', ['沙发']],
  ['lamp', ['台灯', '灯']],
  ['monitor', ['显示器']],
  ['keyboard', ['键盘']],
  ['mouse', ['鼠标']],
  ['book', ['书']],
  ['textbook', ['教材', '书']],
  ['jacket', ['外套']],
  ['shoe', ['鞋']],
  ['shoes', ['鞋']],
  ['sneaker', ['运动鞋']],
  ['apartment', ['公寓', '房子']],
  ['sublease', ['转租']],
  ['sublet', ['转租']],
  ['fridge', ['冰箱']],
  ['microwave', ['微波炉']],
  ['oven', ['烤箱']],
  ['guitar', ['吉他']],
  ['piano', ['钢琴']],
  ['camera', ['相机']],
  ['console', ['游戏机']],
  ['switch', ['任天堂', '游戏机']],
  ['charger', ['充电器']],
  ['airpod', ['耳机']],
  ['airpods', ['耳机']],
  ['headphone', ['耳机']],
  ['headphones', ['耳机']],
  ['ipad', ['平板']],
  ['tablet', ['平板']],
  ['ikea', ['宜家', '家具']],

  ['打印机', ['printer', 'hp printer', 'epson printer']],
  ['扫描仪', ['scanner']],
  ['路由器', ['router', 'wifi router', 'asus router', 'tp-link', 'netgear']],
  ['wifi', ['router', 'wireless', '路由器']],
  ['mac mini', ['mac', 'apple', 'mini', 'm1', 'm2', 'm4']],
  ['imac', ['mac', 'apple', 'desktop mac', '苹果一体机']],
  ['watch', ['apple watch', 'smart watch', 'fitbit', 'garmin', '手表']],
  ['手表', ['watch', 'apple watch', 'smart watch', 'fitbit']],
  ['投影仪', ['projector', 'xgimi', 'anker projector']],
  ['projector', ['投影仪', '投影机']],
  ['书架', ['bookshelf', 'ikea billy', 'shelf', 'bookcase']],
  ['收纳', ['storage', 'organizer', 'container', 'bin']],
  ['抱枕', ['throw pillow', 'cushion']],
  ['被子', ['comforter', 'duvet', 'quilt', 'blanket']],
  ['枕头', ['pillow']],
  ['床单', ['sheet', 'bedsheet', 'fitted sheet']],
  ['毛巾', ['towel']],
  ['浴巾', ['bath towel']],
  ['花瓶', ['vase']],
  ['绿植', ['plant', 'houseplant', 'succulent', '多肉']],
  ['衣架', ['hanger']],
  ['鞋架', ['shoe rack']],

  ['ps4', ['playstation', 'sony console', '游戏机']],
  ['xbox', ['microsoft console', '游戏机']],
  ['nintendo', ['switch', '任天堂', '游戏机']],
  ['vr', ['quest', 'oculus', 'vision pro', 'vr headset']],
  ['quest', ['oculus', 'meta', 'vr']],
  ['手柄', ['controller', 'gamepad', 'dualshock', 'joycon']],
  ['controller', ['gamepad', '手柄', 'dualshock']],
  ['耳麦', ['headset', 'gaming headset']],
  ['麦克风', ['microphone', 'mic', 'blue yeti', 'shure']],
  ['音箱', ['speaker', 'bluetooth speaker', 'jbl', 'bose', 'sonos']],
  ['sonos', ['speaker', '音箱']],

  ['硬盘', ['hard drive', 'ssd', 'hdd', 'external drive', 'samsung t7', 'wd']],
  ['ssd', ['solid state', 'nvme', '硬盘', 'samsung', 'crucial']],
  ['内存', ['ram', 'memory', 'ddr4', 'ddr5', 'crucial', 'corsair']],
  ['显卡', ['gpu', 'graphics card', 'nvidia', 'rtx', 'radeon', 'amd']],
  ['cpu', ['processor', 'intel', 'amd', 'ryzen', '处理器']],
  ['主板', ['motherboard', 'mobo', 'asus', 'msi']],
  ['机箱', ['pc case', 'chassis', 'corsair case', 'nzxt']],
  ['电源', ['psu', 'power supply']],

  ['奶粉', ['formula', 'baby formula']],
  ['尿布', ['diaper', 'pampers', 'huggies']],
  ['婴儿车', ['stroller', 'baby stroller']],
  ['儿童座椅', ['car seat', 'booster seat']],

  ['健身器材', ['gym equipment', 'dumbbell', 'barbell', 'treadmill', 'bike trainer']],
  ['哑铃', ['dumbbell', 'weights']],
  ['跑步机', ['treadmill']],
  ['瑜伽垫', ['yoga mat', 'exercise mat']],
  ['网球拍', ['tennis racket', 'racquet']],
  ['羽毛球拍', ['badminton racket', 'yonex']],
  ['篮球', ['basketball', 'spalding']],
  ['足球', ['soccer ball', 'football']],
  ['乒乓球', ['ping pong', 'table tennis']],

  ['餐具', ['utensil', 'cutlery', 'fork', 'spoon', 'knife', 'chopstick']],
  ['筷子', ['chopstick']],
  ['碗', ['bowl']],
  ['盘子', ['plate', 'dish']],
  ['杯子', ['cup', 'mug', 'tumbler', 'yeti', 'stanley']],
  ['水壶', ['kettle', 'water bottle', 'hydro flask', 'stanley']],
  ['保温杯', ['thermos', 'hydro flask', 'yeti', 'insulated bottle']],
  ['菜刀', ['kitchen knife', 'chef knife', 'santoku']],
  ['砧板', ['cutting board', 'chopping board']],
  ['咖啡机', ['coffee maker', 'nespresso', 'keurig', 'breville', 'delonghi']],
  ['咖啡豆', ['coffee beans', 'coffee']],
  ['磨豆机', ['grinder', 'coffee grinder', 'baratza']],

  ['吹风机', ['hair dryer', 'dyson airwrap', 'blow dryer']],
  ['卷发棒', ['curler', 'curling iron', 'dyson']],
  ['直发器', ['straightener', 'flat iron']],
  ['电动牙刷', ['electric toothbrush', 'oral-b', 'philips sonicare']],
  ['剃须刀', ['shaver', 'razor', 'braun', 'philips shaver']],

  ['月卡', ['monthly pass', 'transit pass']],
  ['健身卡', ['gym membership', 'gym card']],
  ['车险', ['car insurance', 'auto insurance']],
  ['机票', ['flight', 'airline ticket', 'united', 'delta', 'aa']],
  ['火车票', ['amtrak ticket', 'train ticket']],

  ['宠物', ['pet', 'dog', 'cat']],
  ['狗粮', ['dog food']],
  ['猫粮', ['cat food']],
  ['猫砂', ['cat litter']],
  ['宠物笼', ['pet crate', 'pet carrier', 'cage']],

  ['学习用品', ['school supplies', 'stationery']],
  ['活页夹', ['binder', 'folder']],
  ['笔记本电脑包', ['laptop bag', 'laptop sleeve']],
  ['水彩', ['watercolor', 'paint']],
  ['画笔', ['brush', 'paint brush']],
  ['计算器', ['calculator', 'ti-84', 'ti-nspire', 'casio']],
  ['ti-84', ['calculator', '计算器']],

  ['iphone', ['苹果', '手机', 'iPhone', 'iphone 15', 'iphone 14', 'iphone 13', 'iphone 12']],
  ['iphone 15', ['iphone', 'apple phone']],
  ['samsung', ['galaxy', 'android', 's23', 's24', '三星']],
  ['galaxy', ['samsung', 'android']],
  ['pixel', ['google phone', 'android']],
  ['oneplus', ['android', '一加']],

  ['kindle', ['e-reader', 'amazon ereader', '电子书']],
  ['电子书', ['kindle', 'e-reader', 'ebook']],
  ['耳塞', ['earplug', 'loop', 'earbuds']],
  ['墨镜', ['sunglasses', 'ray-ban', 'oakley']],
  ['眼镜', ['glasses', 'spectacles', 'warby parker']],

  ['gift card', ['礼品卡', 'amazon gift', 'starbucks gift']],
  ['礼品卡', ['gift card', 'amazon', 'starbucks']],
  ['coupon', ['优惠券', 'discount']],

  ['学生票', ['student ticket', 'student pass']],
  ['演唱会票', ['concert ticket', 'tour ticket']],
  ['比赛票', ['game ticket', 'sports ticket', 'illini', 'basketball ticket']],
  ['illini', ['uiuc', 'university of illinois', 'champaign', 'urbana']],

  ['printer', ['打印机', '打印']],
  ['router', ['路由器']],
  ['speaker', ['音箱', '喇叭']],
  ['microphone', ['麦克风']],
  ['gpu', ['显卡']],
  ['cpu', ['处理器']],
  ['ram', ['内存']],
  ['ssd', ['硬盘']],
  ['hard drive', ['硬盘']],
  ['watch', ['手表']],
  ['pillow', ['枕头']],
  ['blanket', ['毛毯', '毯子']],
  ['towel', ['毛巾']],
  ['hanger', ['衣架']],
  ['treadmill', ['跑步机']],
  ['dumbbell', ['哑铃']],
  ['kettle', ['水壶']],
  ['thermos', ['保温杯']],
  ['mug', ['杯子', '马克杯']],
  ['cup', ['杯子']],
  ['knife', ['刀', '菜刀']],
  ['coffee', ['咖啡']],
  ['grinder', ['磨豆机']],
  ['toaster', ['面包机', '烤面包机']],
  ['blender', ['搅拌机', '榨汁机']],
  ['calculator', ['计算器']],
  ['binder', ['活页夹']],
  ['pen', ['笔', '钢笔']],
  ['pencil', ['铅笔']],
  ['notebook', ['笔记本']],
  ['diaper', ['尿布']],
  ['stroller', ['婴儿车']],
  ['dog food', ['狗粮']],
  ['cat food', ['猫粮']],
  ['cat litter', ['猫砂']],
  ['gift card', ['礼品卡']],
  ['kindle', ['电子书']],
  ['sunglasses', ['墨镜']],
  ['glasses', ['眼镜']],
  ['projector', ['投影仪']],
  ['vr', ['虚拟现实头显', 'quest']],
  ['quest', ['vr', 'oculus', '头显']],
  ['airpod max', ['airpods max', '头戴耳机']],
  ['airpods max', ['airpod max', 'over-ear']],
  ['m1', ['macbook', 'mac mini', 'apple silicon']],
  ['m2', ['macbook', 'mac mini', 'apple silicon']],
  ['m3', ['macbook', 'mac', 'apple silicon']],
  ['m4', ['macbook', 'apple silicon']],
  ['rtx', ['nvidia', 'gpu', '显卡']],
  ['nvidia', ['rtx', 'gpu', '显卡']],
  ['amd', ['ryzen', 'radeon', 'cpu', 'gpu']],
  ['intel', ['cpu', '处理器']],
  ['ps5', ['游戏机', 'playstation']],
  ['ps4', ['游戏机', 'playstation']],
  ['xbox', ['游戏机']],
  ['nintendo', ['游戏机', '任天堂']],

  ['苹果', ['apple', 'iphone', 'ipad', 'macbook', 'mac', 'airpods', 'apple watch']],
  ['三星', ['samsung', 'galaxy']],
  ['华为', ['huawei']],
  ['小米', ['xiaomi', 'redmi', 'mi']],
  ['任天堂', ['nintendo', 'switch']],
  ['索尼', ['sony', 'playstation', 'ps5']],
  ['微软', ['microsoft', 'xbox', 'surface']],
  ['谷歌', ['google', 'pixel', 'nest']],
  ['戴尔', ['dell', 'xps', 'alienware']],
  ['联想', ['lenovo', 'thinkpad', 'legion']],
  ['华硕', ['asus', 'rog', 'zenbook']],
  ['宜家', ['ikea']],
  ['优衣库', ['uniqlo']],
  ['耐克', ['nike', 'air jordan', 'dunk']],
  ['阿迪', ['adidas', 'yeezy']],
  ['露露', ['lululemon']],

  ['免费', ['free', 'giveaway', '赠送']],
  ['包邮', ['free shipping', 'shipping included']],
  ['议价', ['negotiable', 'obo', 'or best offer']],
  ['议价空间', ['negotiable', 'obo']],
  ['全新', ['brand new', 'new', 'sealed', 'unopened']],
  ['九成新', ['like new', 'mint']],
  ['八成新', ['good condition']],
  ['二手', ['used', 'pre-owned']],
  ['自提', ['pickup', 'self pickup', 'local pickup']],
  ['配送', ['delivery', 'drop off']],
  ['急售', ['urgent sale', 'must sell', 'moving sale']],
  ['毕业', ['graduation', 'graduating', 'moving out', 'move out']],
]

export function expandSearch(query: string): string[] {
  const q = query.toLowerCase().trim()
  if (!q) return [q]
  const terms = new Set<string>([q])
  for (const [keyword, synonyms] of SEARCH_SYNONYMS) {
    if (q.includes(keyword.toLowerCase())) {
      for (const s of synonyms) terms.add(s.toLowerCase())
    }
  }
  return Array.from(terms).slice(0, 12)
}

const TRANSLATE_DICT: Record<string, string> = {
  'desk': '书桌',
  'chair': '椅子',
  'table': '桌子',
  'bed': '床',
  'mattress': '床垫',
  'sofa': '沙发',
  'couch': '沙发',
  'lamp': '台灯',
  'mirror': '镜子',
  'rug': '地毯',
  'shelf': '架子',
  'bookshelf': '书架',
  'wardrobe': '衣柜',
  'dresser': '抽屉柜',
  'fridge': '冰箱',
  'refrigerator': '冰箱',
  'microwave': '微波炉',
  'oven': '烤箱',
  'fan': '风扇',
  'ac': '空调',
  'laptop': '笔记本电脑',
  'computer': '电脑',
  'pc': '台式电脑',
  'monitor': '显示器',
  'keyboard': '键盘',
  'mouse': '鼠标',
  'phone': '手机',
  'iphone': 'iPhone',
  'ipad': 'iPad',
  'tablet': '平板',
  'airpods': 'AirPods 耳机',
  'headphones': '耳机',
  'charger': '充电器',
  'cable': '数据线',
  'battery': '电池',
  'camera': '相机',
  'guitar': '吉他',
  'piano': '钢琴',
  'book': '书',
  'textbook': '教材',
  'notebook': '笔记本',
  'backpack': '背包',
  'bag': '包',
  'shoes': '鞋',
  'sneakers': '运动鞋',
  'jacket': '外套',
  'coat': '大衣',
  'hoodie': '卫衣',
  'shirt': '衬衫',
  'pants': '裤子',
  'jeans': '牛仔裤',
  'dress': '连衣裙',
  'hat': '帽子',
  'scarf': '围巾',
  'bike': '自行车',
  'bicycle': '自行车',
  'car': '汽车',
  'scooter': '滑板车',
  'helmet': '头盔',
  'apartment': '公寓',
  'sublease': '转租',
  'sublet': '转租',
  'rent': '租',
  'new': '全新',
  'like new': '几乎全新',
  'used': '二手',
  'excellent': '极佳',
  'good': '良好',
  'fair': '一般',
  'free': '免费',
  'negotiable': '可议价',
  'obo': '可议价',
  'pickup': '自取',
  'delivery': '送货',
  'price': '价格',
}

const TRANSLATE_REV: Record<string, string> = {}
for (const [en, zh] of Object.entries(TRANSLATE_DICT)) {
  TRANSLATE_REV[zh] = en
}

export function quickTranslate(text: string, targetLang: 'en' | 'zh'): string {
  if (!text) return text
  const dict = targetLang === 'zh' ? TRANSLATE_DICT : TRANSLATE_REV
  let result = text
  const entries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length)
  for (const [src, dst] of entries) {
    if (!src) continue
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = targetLang === 'zh'
      ? new RegExp(`\\b${escaped}\\b`, 'gi')
      : new RegExp(escaped, 'g')
    result = result.replace(pattern, dst)
  }
  return result
}

export function formatPrice(price: number, freeLabel = 'Free'): string {
  if (price === 0) return freeLabel
  return '$' + (Number.isInteger(price) ? price.toString() : price.toFixed(2))
}

export function compressImage(
  src: string,
  maxWidth = 1200,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve) => {
    // #ifdef H5
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = img.width * ratio
      canvas.height = img.height * ratio
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(src)
    img.src = src
    // #endif

    // #ifndef H5
    uni.compressImage({
      src,
      quality: quality * 100,
      success: (res) => resolve(res.tempFilePath),
      fail: () => resolve(src),
    })
    // #endif
  })
}
