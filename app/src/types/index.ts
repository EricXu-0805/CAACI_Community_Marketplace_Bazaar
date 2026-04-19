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
  | 'currency_exchange'
  | 'other'

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'defective'

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
  uid?: string
  is_illini_verified?: boolean
  avg_rating?: number
  rating_count?: number
  created_at: string
  updated_at: string
}

export interface Rating {
  id: string
  rater_id: string
  ratee_id: string
  item_id: string
  stars: number
  comment: string | null
  created_at: string
  rater?: Profile
}

export interface Post {
  id: string
  user_id: string
  content: string
  images: string[]
  is_official: boolean
  is_pinned: boolean
  like_count: number
  comment_count: number
  status: 'active' | 'deleted' | 'hidden'
  created_at: string
  updated_at: string
  attached_item_id?: string | null
  profile?: Profile
  liked_by_me?: boolean
  attached_item?: Pick<Item, 'id' | 'title' | 'price' | 'images' | 'status'> | null
}

export interface PostComment {
  id: string
  post_id: string
  user_id: string
  content: string
  parent_comment_id: string | null
  created_at: string
  profile?: Profile
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
  location_verified?: boolean
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
  is_pinned_buyer?: boolean
  is_pinned_seller?: boolean
  is_muted_buyer?: boolean
  is_muted_seller?: boolean
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


