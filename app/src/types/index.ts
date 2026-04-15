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
  favorite_count?: number
  negotiable?: boolean
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


