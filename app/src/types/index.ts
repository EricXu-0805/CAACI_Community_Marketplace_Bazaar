// ============================================
// CAACI Marketplace - Type Definitions
// ============================================

export type ItemCategory =
  | 'furniture'
  | 'electronics'
  | 'clothing'
  | 'books'
  | 'housing'
  | 'vehicles'
  | 'daily'
  | 'food'
  | 'other'

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair'

export type ItemStatus = 'active' | 'reserved' | 'sold' | 'deleted'

export type MessageType = 'text' | 'image'

// ============================================
// Database row types
// ============================================

export interface Profile {
  id: string
  phone: string | null
  email: string | null
  wechat_openid: string | null
  nickname: string
  avatar_url: string
  bio: string
  location: string
  created_at: string
  updated_at: string
}

export interface Item {
  id: string
  user_id: string
  title: string
  description: string
  price: number
  category: ItemCategory
  condition: ItemCondition
  status: ItemStatus
  location: string
  images: string[]
  view_count: number
  created_at: string
  updated_at: string
  // Joined fields
  profile?: Profile
}

export interface Conversation {
  id: string
  item_id: string | null
  buyer_id: string
  seller_id: string
  last_message_at: string
  created_at: string
  // Joined fields
  item?: Item
  buyer?: Profile
  seller?: Profile
  last_message?: Message
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  message_type: MessageType
  is_read: boolean
  created_at: string
  // Joined fields
  sender?: Profile
}

export interface Favorite {
  id: string
  user_id: string
  item_id: string
  created_at: string
  item?: Item
}

// ============================================
// UI helper types
// ============================================

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  furniture: '家具',
  electronics: '电子产品',
  clothing: '服饰',
  books: '书籍',
  housing: '转租/住房',
  vehicles: '交通工具',
  daily: '日用品',
  food: '食品',
  other: '其他',
}

export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: '全新',
  like_new: '几乎全新',
  good: '良好',
  fair: '一般',
}

export const STATUS_LABELS: Record<ItemStatus, string> = {
  active: '在售',
  reserved: '已预定',
  sold: '已售出',
  deleted: '已删除',
}
