// #ifdef H5
import { useI18n } from '../composables/useI18n'
import { addBreadcrumb } from './sentry'
// #endif

const SUPABASE_STORAGE_MARKER = "/storage/v1/object/public/"
const SUPABASE_RENDER_PATH = "/storage/v1/render/image/public/"

export function thumbUrl(
  url: string | null | undefined,
  size: "list" | "card" | "detail" | "avatar" = "list",
): string {
  if (!url) return ""
  if (!url.includes(SUPABASE_STORAGE_MARKER)) return url
  const rendered = url.replace(SUPABASE_STORAGE_MARKER, SUPABASE_RENDER_PATH)
  // Supabase image-transform defaults to resize=cover. With ONLY a width
  // param (no height), cover treats the original image's height as the
  // target height and crops width down to 640 — producing a tall vertical
  // sliver of the original photo, not a proportional thumbnail. Empirically
  // verified 2025-04-24: a 1080×1920 source came back as 640×1920, not
  // 640×1138. Fix is resize=contain, which scales proportionally and
  // ignores the missing height. Avatar stays cover because circular
  // avatars want square crops.
  const params =
    size === "avatar" ? "width=96&height=96&quality=75&resize=cover"
    : size === "list" ? "width=480&quality=72&resize=contain"
    : size === "card" ? "width=640&quality=75&resize=contain"
    : "width=1280&quality=82&resize=contain"
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

const MODERATION_MESSAGES: Record<string, { en: string; zh: string }> = {
  too_short:        { en: 'Content is too short.',                           zh: '内容太短' },
  too_long:         { en: 'Content is too long.',                            zh: '内容太长' },
  contact_info:     { en: 'Please use in-app chat — no phone, WeChat, or email allowed here.', zh: '请使用站内私信，不要留手机号、微信或邮箱' },
  sensitive_word:   { en: 'Content contains disallowed terms.',              zh: '内容包含违规词，请修改后重试' },
  suspicious_link:  { en: 'Links are not allowed in this field.',            zh: '此处不允许发送链接' },
  qr_image:         { en: 'Images containing QR codes are not allowed.',     zh: '图片中检测到二维码，不允许发送' },
  spam_pattern:     { en: 'This looks like spam. Please rewrite.',           zh: '疑似垃圾内容，请修改' },
}

export function friendlyErrorMessage(err: any, lang: 'en' | 'zh' = 'en'): string {
  if (!err) return ''
  const rawMessage = String(err?.message || err?.code || err || '')
  const raw = rawMessage.toLowerCase()

  if (raw.startsWith('suspension_active:')) {
    const parts = rawMessage.split(':')
    const lvl = parts[1] || '?'
    return lang === 'zh'
      ? `账号已被限制（L${lvl}），请查看协议详情`
      : `Your account is suspended (L${lvl}). See Terms for details.`
  }

  if (raw.startsWith('moderation_block:')) {
    const cat = raw.split(':')[1] as keyof typeof MODERATION_MESSAGES
    if (cat && MODERATION_MESSAGES[cat]) return MODERATION_MESSAGES[cat][lang]
    return lang === 'zh' ? '内容未通过审核' : 'Content blocked by moderation'
  }

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

  /*
   * English-keyed reverse mappings — added 2025-04-25.
   *
   * The existing dictionary mostly maps from Chinese keys (苹果) to
   * English variants (apple/macbook/iphone). When a user types in
   * English, expandSearch() walks the dictionary looking for keywords
   * that q.includes(keyword) — so 'apple' fails to match key '苹果',
   * meaning "apple" → ["apple"] only, never expanding to macbook etc.
   *
   * These entries fill that gap: top-level English category nouns
   * (apple, mac, bike, book, phone, etc.) gain explicit synonym lists
   * so an EN→EN search ("apple" → MacBook listings) actually finds
   * relevant items even though the title doesn't contain "apple".
   *
   * Order matters slightly: longer keywords first so "mac mini" matches
   * before bare "mac" steals the trigger. expandSearch dedupes results
   * via the Set, so duplication across entries is harmless.
   */
  ['apple', ['macbook', 'iphone', 'ipad', 'airpods', 'imac', 'mac', '苹果', 'apple watch']],
  ['mac', ['macbook', 'imac', 'apple', 'mac mini', 'mac studio']],
  ['phone', ['iphone', 'pixel', 'samsung', 'galaxy', '手机']],
  ['laptop', ['macbook', 'thinkpad', 'xps', 'computer', '笔记本', '电脑']],
  ['computer', ['laptop', 'desktop', 'pc', 'imac', 'macbook', '电脑']],
  ['bike', ['bicycle', '自行车', '单车', 'cycle', 'mountain bike']],
  ['bicycle', ['bike', '自行车', '单车']],
  ['book', ['textbook', '书', '教材', '课本', 'novel']],
  ['textbook', ['book', 'course book', '教材', '课本']],
  ['headphones', ['airpods', 'earbuds', '耳机']],
  ['earbuds', ['airpods', 'headphones', '耳机']],
  ['monitor', ['display', '显示器', 'screen']],
  ['keyboard', ['mechanical keyboard', '键盘']],
  ['speaker', ['speakers', '音箱', 'sonos', 'bose']],
  ['tv', ['television', '电视', 'samsung tv', 'lg tv']],
  ['fridge', ['refrigerator', '冰箱']],
  ['couch', ['sofa', '沙发']],
  ['desk', ['table', '桌子', '书桌']],
  ['chair', ['椅子', 'office chair', 'gaming chair']],
  ['bed', ['mattress', '床', '床垫']],
  ['lamp', ['light', '台灯']],
  ['backpack', ['bag', '背包', '书包']],
  ['shoes', ['sneakers', 'boots', '鞋']],
  ['jacket', ['coat', 'hoodie', '外套']],
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

/*
 * Client-side image compression — storage budget mitigation.
 *
 * At projected UIUC adoption (~5000 students × ~10 photos/month) raw
 * 4K phone photos at 3-5 MB each would exhaust Supabase free tier
 * 1 GB Storage cap inside the first year. Compressing to a 1080-px
 * long edge at JPEG quality 82 brings a typical 4032×3024 phone
 * shot down to ≈ 500 KB while preserving display quality at every
 * card/cell size we render (the largest is 750 rpx ≈ ~360 px on
 * desktop, ~280 px on phones, both well below 1080).
 *
 * Long edge (vs width) matters for portrait phone shots — the camera
 * stores them at 3024×4032 and the previous "compare against width"
 * gate ran the resize on the wrong axis, sometimes downscaling
 * landscape wide shots while leaving 4 K portraits untouched.
 *
 * H5 path: createImageBitmap(blob, { imageOrientation: 'from-image' })
 * is the canonical way to apply EXIF orientation BEFORE the canvas
 * draw — without it, photos taken in portrait mode land sideways
 * because the camera writes a "rotate 90°" EXIF tag instead of
 * baking the rotation into the pixels. The option ships in Chrome
 * 79+ / Firefox 77+ / Safari 14.1+, which covers ~99 % of our
 * student user base. On older Safari it silently no-ops
 * (orientation may render wrong, but the upload still succeeds —
 * graceful degradation).
 *
 * mp-weixin path: uni.compressImage's compressedWidth /
 * compressedHeight params (basic library 2.10.0+) handle the resize
 * server-side on the WeChat runtime, no canvas dance required. EXIF
 * is applied automatically by the WeChat JPEG decoder.
 *
 * Skip-if-already-small: if the long edge is already ≤ maxLongEdge
 * we return the source unchanged to avoid a re-encode that would
 * only chip away at quality without saving meaningful bytes.
 *
 * HEIC handling (batch 3b-β, 2026-04-30):
 * iPhone's default camera format is HEIC. Chrome and Firefox cannot
 * decode HEIC via createImageBitmap — the call throws InvalidStateError.
 * Before this fix, that exception was caught and the original HEIC
 * blob URL was returned silently; the upload then stored the HEIC
 * bytes in Supabase mislabeled as image/jpeg, producing listings with
 * unrenderable images on every browser except Safari 17+ and native
 * iOS/macOS preview. The new flow: detect HEIC by mime + magic-bytes
 * before createImageBitmap, try Safari 17+ native decode first (zero
 * library cost), and only on native-decode failure dynamic-import
 * heic-to to convert HEIC → JPEG. The library is wrapped in #ifdef H5
 * + dynamic import, so it never reaches the mp-weixin bundle and never
 * loads on JPEG/PNG flows. HEIC failures HARD-fail (throw) so the
 * caller surfaces an explicit "image format not supported" toast
 * instead of producing a broken listing — see batch 3b-β plan §4.1
 * Q2 (HARD-FAIL universally) for the rationale.
 */

/*
 * Backwards-compat overloads. Existing positional calls
 *   compressImage(src)               · compressImage(src, 1600)
 *   compressImage(src, 1080, 0.82)
 * keep working unchanged. New options-form
 *   compressImage(src, { entryPoint: 'publish' })
 * threads an optional entryPoint tag through to Sentry breadcrumbs
 * for triage ("which user surface produced this HEIC failure?").
 */
export interface CompressOptions {
  maxLongEdge?: number
  quality?: number
  /*
   * Free-form tag attached to image.heic Sentry breadcrumbs. Convention:
   * one of 'publish' | 'plaza' | 'chat' | 'profile' | 'onboarding'.
   * Optional; absent value yields entry_point: undefined in the
   * breadcrumb data, which Sentry renders as the literal string.
   */
  entryPoint?: string
}

export function compressImage(src: string): Promise<string>
export function compressImage(src: string, maxLongEdge: number, quality?: number): Promise<string>
export function compressImage(src: string, options: CompressOptions): Promise<string>
export function compressImage(
  src: string,
  arg2?: number | CompressOptions,
  arg3?: number,
): Promise<string> {
  let maxLongEdge = 1080
  let quality = 0.82
  let entryPoint: string | undefined

  if (typeof arg2 === 'object' && arg2 !== null) {
    if (typeof arg2.maxLongEdge === 'number') maxLongEdge = arg2.maxLongEdge
    if (typeof arg2.quality === 'number') quality = arg2.quality
    entryPoint = arg2.entryPoint
  } else {
    if (typeof arg2 === 'number') maxLongEdge = arg2
    if (typeof arg3 === 'number') quality = arg3
  }

  return new Promise((resolve, reject) => {
    // #ifdef H5
    /*
     * H5: hand HEIC errors UP to the caller (reject), but keep the
     * legacy "return src on non-HEIC failure" contract for everything
     * else (fetch fail, OOM on large JPEG, etc.). compressH5 throws
     * only HeicConversionError; all other paths still return src.
     */
    void compressH5(src, maxLongEdge, quality, entryPoint).then(resolve, reject)
    // #endif

    // #ifndef H5
    /*
     * mp-weixin: HEIC is decoded natively by the WeChat runtime on iOS;
     * Android WeChat support is verified empirically. No HEIC-specific
     * code path here. Keep the silent-fallback contract so any future
     * uni.compressImage failure produces the original src unchanged.
     */
    void compressMP(src, maxLongEdge, quality).then(resolve, () => resolve(src))
    // #endif
  })
}

// #ifdef H5
/*
 * HEIC support helpers. All H5-only — uni-app conditional compilation
 * strips this entire block from the mp-weixin / mp-alipay / etc. builds,
 * so the heic-to library never reaches a mini-program bundle.
 */

/*
 * Marker error for HEIC conversion failures. We propagate this to the
 * caller (publish/plaza/chat/profile/onboarding) so it can show a
 * specific 'heic.unsupported' toast instead of generic 'upload failed'.
 *
 * NOT exported as a class (instanceof checks fail across module
 * boundaries with bundler-side class identity). Callers check the
 * heic discriminator field instead: `if (err?.heic === true) …`.
 */
function makeHeicError(message: string): Error & { heic: true } {
  const e = new Error(message) as Error & { heic: true }
  e.heic = true
  e.name = 'HeicConversionError'
  return e
}

/*
 * Detect HEIC by mime type + ISO BMFF magic-bytes. Cheap (reads only
 * the first 12 bytes of the blob) and runs WITHOUT loading the heic-to
 * library — that's the whole point of doing detection before library
 * import. JPEG/PNG flows pay zero library cost.
 *
 * MIME-type check first (fast path; works when uni.chooseImage's blob
 * is well-typed). Magic-bytes fallback for blobs with empty .type
 * (sometimes happens with createObjectURL + fetch on Chrome).
 *
 * HEIC/HEIF brand codes from ISO/IEC 23008-12 + 14496-12:
 *   heic  — HEVC single image
 *   heix  — HEVC single image, 10-bit
 *   hevc  — HEVC image sequence
 *   hevx  — HEVC image sequence, 10-bit
 *   mif1  — image format compatibility (covers most iOS HEIC files)
 *   msf1  — image sequence format
 */
async function looksLikeHeic(blob: Blob): Promise<boolean> {
  const t = (blob.type || '').toLowerCase()
  if (t === 'image/heic' || t === 'image/heif' || t === 'image/heic-sequence' || t === 'image/heif-sequence') {
    return true
  }
  try {
    const head = blob.slice(0, 12)
    const buf = await head.arrayBuffer()
    const view = new Uint8Array(buf)
    // 'ftyp' at offset 4 → 0x66 0x74 0x79 0x70
    if (view.length >= 12 && view[4] === 0x66 && view[5] === 0x74 && view[6] === 0x79 && view[7] === 0x70) {
      const brand = String.fromCharCode(view[8], view[9], view[10], view[11]).toLowerCase()
      if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'hevx' || brand === 'mif1' || brand === 'msf1') {
        return true
      }
    }
  } catch {
    /* fall through to false */
  }
  return false
}

/*
 * Dynamic-import wrapper around heic-to. The await import() is what
 * Vite picks up to code-split heic-to into its own chunk — so the
 * ~2 MB libheif payload only downloads on the first HEIC pick, not
 * on initial page load. JPEG-only sessions never load it at all.
 *
 * heic-to's quality is set to 0.92 (vs the canvas re-encode's 0.82)
 * so the intermediate blob doesn't compound losses. The final
 * dataUrl from canvas.toDataURL still encodes at the caller's
 * requested quality (default 0.82); heic-to's quality only matters
 * if the long-edge skip-resize branch returns the heic-to blob
 * directly without canvas re-encode.
 *
 * Note: heic-to rejects with various shapes (string, ErrorEvent,
 * Error) — caller wraps in errorToShortString to normalize.
 */
async function heicToJpegBlob(blob: Blob): Promise<Blob> {
  const { heicTo } = await import('heic-to')
  return heicTo({ blob, type: 'image/jpeg', quality: 0.92 })
}

/*
 * FileReader wrapper to base64-encode a blob, used when the long edge
 * is already ≤ maxLongEdge AND the source was HEIC. We can't return
 * the original src in that case (the original is the unrenderable HEIC
 * blob URL); we have to return a data: URL of the converted JPEG so
 * the upload step gets actual JPEG bytes.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('FileReader read failed'))
    reader.readAsDataURL(blob)
  })
}

/*
 * heic-to does NOT throw structured Error objects; rejection values
 * include raw strings ('Can\'t convert canvas to blob.'), ErrorEvent
 * objects, or plain Errors depending on which internal path failed.
 * Normalize to a short string for breadcrumb data + caller toast.
 */
function errorToShortString(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; name?: unknown; type?: unknown }
    if (typeof e.message === 'string') return e.message
    if (typeof e.name === 'string') return e.name
    if (typeof e.type === 'string') return e.type
  }
  try { return String(err) } catch { return 'unknown' }
}

/*
 * Module-level guard for nested showLoading calls. uni.showLoading
 * does NOT support stacking — a second call replaces the title, and
 * a single hideLoading dismisses both. We only ever show ONE loading
 * (ours), and only hide what we showed. If a caller is already showing
 * its own loading when HEIC conversion starts, our call will stomp the
 * outer title to "Converting image…" — which is at least truthful, and
 * none of the current call sites do that anyway (they use button-disable
 * or progress bars instead). See batch 3b-β plan §3.3.
 */
let heicLoadingShownByUs = false

function tryShowHeicLoading(): void {
  if (heicLoadingShownByUs) return
  heicLoadingShownByUs = true
  try {
    /*
     * useI18n() is module-level safe: currentLang is a top-level ref
     * and t() just reads it synchronously. The .computed it creates
     * leaks (no effect scope to dispose it) but the leak is one
     * computed per HEIC operation — negligible at our scale.
     */
    const { t } = useI18n()
    uni.showLoading({ title: t('heic.converting'), mask: true })
  } catch (err) {
    /* showLoading failure is non-fatal; conversion still proceeds */
    console.warn('[compress-debug] showLoading failed', err)
    heicLoadingShownByUs = false
  }
}

function tryHideHeicLoading(): void {
  if (!heicLoadingShownByUs) return
  heicLoadingShownByUs = false
  try { uni.hideLoading() } catch { /* swallow — already hidden or torn down */ }
}

async function compressH5(
  src: string,
  maxLongEdge: number,
  quality: number,
  entryPoint?: string,
): Promise<string> {
  const shortSrc = src.slice(0, 60) + (src.length > 60 ? '…' : '')
  let origBlob: Blob
  try {
    const resp = await fetch(src)
    origBlob = await resp.blob()
  } catch (err) {
    console.warn('[compress-debug] H5 fetch failed for', shortSrc, err)
    return src
  }
  const origKB = Math.round(origBlob.size / 1024)

  /*
   * HEIC detection runs BEFORE createImageBitmap so we can route HEIC
   * blobs through the converter without first triggering the (always-
   * failing on Chrome/Firefox) native decode. Detection is byte-level,
   * doesn't load the heic-to library.
   */
  let heicInput = false
  try {
    heicInput = await looksLikeHeic(origBlob)
  } catch {
    /* detection error → treat as non-HEIC and fall through */
  }

  let workingBlob: Blob = origBlob
  let bitmap: ImageBitmap | null = null

  if (heicInput) {
    addBreadcrumb({
      category: 'image.heic',
      level: 'info',
      message: 'heic detected',
      data: {
        size_before_bytes: origBlob.size,
        mime_in: origBlob.type || 'unknown',
        entry_point: entryPoint,
      },
    })

    /*
     * Try Safari 17+ native HEIC decode first. Saves the ~2 MB heic-to
     * download for the ~40 % of our user base on Safari (iOS + macOS).
     * On Chrome/Firefox this throws InvalidStateError immediately and
     * we fall through to the heic-to dynamic import.
     */
    try {
      bitmap = await createImageBitmap(origBlob, { imageOrientation: 'from-image' as 'none' })
      addBreadcrumb({
        category: 'image.heic',
        level: 'info',
        message: 'heic native-decoded',
        data: { size_before_bytes: origBlob.size, entry_point: entryPoint },
      })
    } catch {
      /*
       * Native decode failed → invoke heic-to. Show loading overlay
       * because conversion is 1–8 s on real-world phones and silent
       * waits feel broken. The overlay hides on completion (success
       * or failure) via the finally block.
       */
      tryShowHeicLoading()
      const t0 = Date.now()
      try {
        workingBlob = await heicToJpegBlob(origBlob)
        const dt = Date.now() - t0
        if (!workingBlob || workingBlob.size === 0 || !workingBlob.type.startsWith('image/')) {
          throw makeHeicError('heic-to returned invalid blob')
        }
        addBreadcrumb({
          category: 'image.heic',
          level: 'info',
          message: 'heic converted',
          data: {
            size_before_bytes: origBlob.size,
            size_after_bytes: workingBlob.size,
            convert_ms: dt,
            mime_out: workingBlob.type,
            entry_point: entryPoint,
            library: 'heic-to',
          },
        })
      } catch (convErr) {
        const dt = Date.now() - t0
        addBreadcrumb({
          category: 'image.heic',
          level: 'warning',
          message: 'heic conversion failed',
          data: {
            size_before_bytes: origBlob.size,
            mime_in: origBlob.type || 'unknown',
            err_msg_truncated: errorToShortString(convErr).slice(0, 80),
            convert_ms: dt,
            entry_point: entryPoint,
          },
        })
        /*
         * HARD-FAIL per batch 3b-β Q2: throw a HEIC-marker error so
         * callers (publish/plaza/chat/profile/onboarding) can show
         * 'heic.unsupported' toast and refuse to create the listing.
         * Re-wrap if the original error is already a heic-marker
         * error (e.g. the invalid-blob validation above).
         */
        if ((convErr as { heic?: unknown })?.heic === true) throw convErr as Error
        throw makeHeicError(errorToShortString(convErr) || 'HEIC conversion failed')
      } finally {
        tryHideHeicLoading()
      }
    }
  }

  /*
   * Skip recreating the bitmap if Safari already produced one. For
   * non-Safari HEIC AND non-HEIC paths, create the bitmap from
   * workingBlob (which is either the converted JPEG or the original).
   */
  if (!bitmap) {
    try {
      bitmap = await createImageBitmap(workingBlob, { imageOrientation: 'from-image' as 'none' })
    } catch (err) {
      console.warn('[compress-debug] H5 createImageBitmap failed for', shortSrc, err)
      /*
       * Post-conversion bitmap failure on a HEIC: workingBlob holds
       * valid JPEG bytes from heic-to; return as data URL so the
       * upload still gets renderable bytes (at full size, no resize).
       * Non-HEIC failures keep the legacy "return src" contract.
       */
      if (heicInput) return blobToDataUrl(workingBlob)
      return src
    }
  }

  const origW = bitmap.width
  const origH = bitmap.height
  const longEdge = Math.max(origW, origH)

  if (longEdge <= maxLongEdge) {
    console.log(`[compress-debug] H5 skip (≤${maxLongEdge}): ${origW}x${origH}, ${origKB}KB`)
    bitmap.close?.()
    /*
     * For converted HEIC: src is the unrenderable HEIC blob URL, so
     * we MUST return the converted blob's data URL even when skipping
     * the resize. For non-HEIC: src is already a valid JPEG/PNG blob
     * URL; return it unchanged (legacy skip-if-small path).
     */
    if (heicInput) return blobToDataUrl(workingBlob)
    return src
  }

  const ratio = maxLongEdge / longEdge
  const targetW = Math.round(origW * ratio)
  const targetH = Math.round(origH * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    if (heicInput) return blobToDataUrl(workingBlob)
    return src
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  // toDataURL returns base64; actual byte size ≈ length × 0.75
  const compressedKB = Math.round((dataUrl.length * 0.75) / 1024)
  console.log(`[compress-debug] H5: ${origW}x${origH} ${origKB}KB → ${targetW}x${targetH} ${compressedKB}KB q${Math.round(quality * 100)}`)
  return dataUrl
}
// #endif

// #ifndef H5
function compressMP(src: string, maxLongEdge: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    /*
     * Measure first so we can pass compressedWidth/compressedHeight
     * (uni.compressImage on mp-weixin since basic library 2.10.0).
     * If the runtime is older or getImageInfo fails we fall back to
     * uni.compressImage without target dims — still gets us the
     * quality re-encode even if it doesn't downscale.
     */
    uni.getImageInfo({
      src,
      success: (info) => {
        const w = info.width || 0
        const h = info.height || 0
        const longEdge = Math.max(w, h)
        const shortSrc = src.slice(0, 60) + (src.length > 60 ? '…' : '')

        if (longEdge > 0 && longEdge <= maxLongEdge) {
          console.log(`[compress-debug] mp skip (≤${maxLongEdge}): ${w}x${h}`)
          resolve(src)
          return
        }

        const opts: UniApp.CompressImageOptions = {
          src,
          quality: Math.round(quality * 100),
          success: (res) => {
            console.log(`[compress-debug] mp: ${w}x${h} → max ${maxLongEdge}px q${Math.round(quality * 100)}`)
            resolve(res.tempFilePath)
          },
          fail: (err) => {
            console.warn('[compress-debug] mp compress fail for', shortSrc, err)
            resolve(src)
          },
        }
        if (longEdge > 0) {
          const ratio = maxLongEdge / longEdge
          ;(opts as UniApp.CompressImageOptions & { compressedWidth?: number; compressedHeight?: number }).compressedWidth = Math.round(w * ratio)
          ;(opts as UniApp.CompressImageOptions & { compressedWidth?: number; compressedHeight?: number }).compressedHeight = Math.round(h * ratio)
        }
        uni.compressImage(opts)
      },
      fail: (err) => {
        const shortSrc = src.slice(0, 60) + (src.length > 60 ? '…' : '')
        console.warn('[compress-debug] mp getImageInfo fail for', shortSrc, err)
        uni.compressImage({
          src,
          quality: Math.round(quality * 100),
          success: (res) => resolve(res.tempFilePath),
          fail: () => resolve(src),
        })
      },
    })
  })
}
// #endif

/*
 * Read the natural pixel dimensions of any image source we can reach
 * (temp file path from uni.chooseImage, a blob:/data: URL on H5, an
 * http(s) URL, or a Supabase storage URL).
 *
 * Returns { w: 0, h: 0 } on failure so callers can write the result
 * straight into image_dimensions[] without worrying about exceptions.
 * We use this at publish time to save dimensions alongside each uploaded
 * URL — paired with the jsonb column from migration 014 it means cards
 * can size correctly on first paint (no CLS) instead of waiting for
 * each <image> to fire @load.
 */
export function getImageDimensions(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    if (!src) return resolve({ w: 0, h: 0 })
    const shortSrc = src.slice(0, 60) + (src.length > 60 ? '…' : '')

    // #ifdef H5
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const dims = { w: img.naturalWidth || 0, h: img.naturalHeight || 0 }
      console.log('[dims-debug] H5 onload:', shortSrc, '→', dims.w, 'x', dims.h)
      resolve(dims)
    }
    img.onerror = (e) => {
      console.warn('[dims-debug] H5 onerror for:', shortSrc, e)
      resolve({ w: 0, h: 0 })
    }
    img.src = src
    // #endif

    // #ifndef H5
    uni.getImageInfo({
      src,
      success: (res) => {
        const dims = { w: res.width || 0, h: res.height || 0 }
        console.log('[dims-debug] mp getImageInfo OK:', shortSrc, '→', dims.w, 'x', dims.h)
        resolve(dims)
      },
      fail: (err) => {
        console.warn('[dims-debug] mp getImageInfo fail:', shortSrc, err)
        resolve({ w: 0, h: 0 })
      },
    })
    // #endif
  })
}
