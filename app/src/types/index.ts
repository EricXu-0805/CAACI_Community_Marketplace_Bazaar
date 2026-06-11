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
  | 'rideshare'
  | 'other'

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'defective'

export type ItemStatus = 'active' | 'reserved' | 'sold' | 'deleted'

export type MessageType = 'text' | 'image' | 'video'

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
  status_text?: string | null
  status_emoji?: string | null
  is_illini_verified?: boolean
  avg_rating?: number
  rating_count?: number
  tos_version?: string | null
  consented_at?: string | null
  onboarded_at?: string | null
  campus_area?: string | null
  trust_score?: number
  shadow_banned?: boolean
  suspension_level?: number
  suspended_until?: string | null
  warning_count?: number
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

export interface ImageDim {
  w: number
  h: number
}

export type OfferStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'expired'

export interface Offer {
  id: string
  conversation_id: string
  item_id: string | null
  from_user: string
  to_user: string
  price: number
  status: OfferStatus
  parent_offer_id: string | null
  note: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

export type MeetupStatus = 'pending' | 'accepted' | 'declined' | 'rescheduled' | 'expired'

export interface Meetup {
  id: string
  conversation_id: string
  item_id: string | null
  from_user: string
  to_user: string
  spot: string
  meet_at: string
  status: MeetupStatus
  parent_meetup_id: string | null
  note: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

export interface Post {
  id: string
  user_id: string
  content: string
  images: string[]
  image_dimensions?: ImageDim[]
  content_i18n?: Record<string, string> | null
  source_lang?: string | null
  is_official: boolean
  is_pinned: boolean
  like_count: number
  comment_count: number
  status: 'active' | 'deleted' | 'hidden'
  created_at: string
  updated_at: string
  profile?: Profile
  liked_by_me?: boolean
  post_items?: Array<{
    item: Pick<Item, 'id' | 'title' | 'title_i18n' | 'price' | 'images' | 'image_dimensions' | 'status'>
    display_order: number
  }>
}

export interface PostComment {
  id: string
  post_id: string
  user_id: string
  content: string
  parent_comment_id: string | null
  like_count?: number
  created_at: string
  profile?: Profile
  reply_to_name?: string | null
  liked_by_me?: boolean
}

export interface Item {
  id: string
  user_id: string
  title: string
  description: string
  title_i18n?: Record<string, string> | null
  description_i18n?: Record<string, string> | null
  source_lang?: string | null
  price: number
  category: ItemCategory
  condition: ItemCondition
  status: ItemStatus
  listing_type?: 'sell' | 'wanted'
  location: string
  location_verified?: boolean
  images: string[]
  image_dimensions?: ImageDim[]
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


