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
  ['电脑', ['computer', 'laptop', 'macbook', 'pc', 'dell', 'thinkpad', 'surface']],
  ['笔记本', ['laptop', 'notebook', 'macbook', 'thinkpad', 'surface']],
  ['手机', ['phone', 'iphone', 'samsung', 'pixel', 'android']],
  ['耳机', ['headphone', 'earphone', 'airpod', 'earbud', 'beats', 'sony']],
  ['平板', ['tablet', 'ipad', 'surface']],
  ['显示器', ['monitor', 'display', 'screen']],
  ['键盘', ['keyboard', 'mechanical']],
  ['鼠标', ['mouse', 'logitech']],
  ['相机', ['camera', 'canon', 'sony', 'nikon', 'fuji']],
  ['自行车', ['bike', 'bicycle', 'cycling']],
  ['车', ['car', 'vehicle', 'toyota', 'honda']],
  ['沙发', ['sofa', 'couch']],
  ['桌子', ['desk', 'table']],
  ['椅子', ['chair', 'herman miller']],
  ['床', ['bed', 'mattress']],
  ['书', ['book', 'textbook']],
  ['衣服', ['clothes', 'clothing', 'jacket', 'coat']],
  ['鞋', ['shoe', 'sneaker', 'nike', 'adidas']],
  ['包', ['bag', 'backpack', 'purse']],
  ['租房', ['housing', 'apartment', 'sublease', 'sublet', 'rent']],
  ['转租', ['sublease', 'sublet', 'rent']],
  ['家具', ['furniture', 'ikea']],
  ['冰箱', ['fridge', 'refrigerator']],
  ['微波炉', ['microwave']],
  ['台灯', ['lamp', 'desk lamp', 'light']],
  // English → Chinese
  ['laptop', ['笔记本', '电脑']],
  ['phone', ['手机']],
  ['bike', ['自行车', '单车']],
  ['desk', ['桌子', '书桌']],
  ['chair', ['椅子']],
]

export function expandSearch(query: string): string[] {
  const q = query.toLowerCase().trim()
  const terms = new Set<string>([q])
  for (const [keyword, synonyms] of SEARCH_SYNONYMS) {
    if (q.includes(keyword.toLowerCase())) {
      for (const s of synonyms) terms.add(s)
    }
  }
  return Array.from(terms)
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
