<template>
  <view class="chat-media">
    <button v-if="url && message.message_type === 'image'" class="media-photo-button" :aria-label="t('chat.openPhoto')" :disabled="loading" @click="preview">
      <image :src="url" class="chat-photo" mode="aspectFit" :alt="t('chat.photo')" @error="mediaError" />
    </button>
    <video v-else-if="url" :src="url" class="chat-video" :controls="true" :autoplay="false" :show-center-play-btn="true" @error="mediaError" />
    <button v-else-if="valid" class="media-retry" :disabled="loading" @click="load()">
      <UIcon :name="message.message_type === 'image' ? 'image' : 'video'" size="md" />
      <text>{{ loading ? t('msg.loading') : t('chat.loadMedia') }}</text>
    </button>
    <text v-else class="media-legacy">{{ t('chat.mediaUnavailable') }}</text>
  </view>
</template>
<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useSupabase } from '../composables/useSupabase'
import { useI18n } from '../composables/useI18n'
import { captureActiveAccountRequest, isAccountRequestCurrent, onAccountTransition } from '../composables/accountScope'
import { CHAT_MEDIA_BUCKET, CHAT_MEDIA_URL_TTL, validChatMediaPath } from '../utils/chatMedia'
import type { Message } from '../types'
import UIcon from './UIcon.vue'
const props=defineProps<{message:Message}>()
const {t}=useI18n(), {supabase}=useSupabase()
const url=ref(''),loading=ref(false)
let version=0, alive=true
const valid=computed(()=>validChatMediaPath(props.message.content,props.message.message_type,props.message.sender_id,props.message.conversation_id,props.message.id))
const removeTransition=onAccountTransition(()=>{version++;url.value='';loading.value=false})
function isTransientSigningFailure(error:unknown):boolean{
  if(!(error instanceof Error))return false
  const storageError=error as Error & {status?:number;originalError?:unknown}
  if(storageError.status!==undefined)return storageError.status>=500 && storageError.status<600
  // Storage wraps rejected fetches. Do not treat arbitrary TypeErrors (including
  // an invalid signed URL) or unknown errors as permission to keep private media.
  const cause=error.name==='StorageUnknownError'?storageError.originalError:error
  if(!(cause instanceof Error))return false
  if(cause.name==='AbortError')return /^(response_headers_timeout|response_body_timeout)$/.test(cause.message)
  return cause.name==='TypeError' && /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network request failed|the network connection was lost\.?)$/i.test(cause.message)
}
async function load(preservePhoto=false):Promise<string|null>{
  const token=captureActiveAccountRequest(), request=++version
  if(!preservePhoto)url.value=''
  if(!alive || !token || !valid.value || props.message._pending) { url.value='';loading.value=false;return null }
  const isCurrent=()=>alive && request===version && isAccountRequestCurrent(token)
  loading.value=true
  try{
    const {data,error}=await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(props.message.content,CHAT_MEDIA_URL_TTL)
    if(error||!data?.signedUrl) throw error || new Error('media_unavailable')
    const candidate=new URL(data.signedUrl),base=new URL(import.meta.env.VITE_SUPABASE_URL || '')
    if(candidate.origin!==base.origin || candidate.pathname !== `/storage/v1/object/sign/${CHAT_MEDIA_BUCKET}/${props.message.content}`) throw new Error('media_invalid_url')
    if(!isCurrent())return null
    // Preview renewal must not reload the already-rendered thumbnail.
    if(!preservePhoto)url.value=data.signedUrl
    return data.signedUrl
  }catch(error){
    if(isCurrent()){
      if(!preservePhoto || !isTransientSigningFailure(error))url.value=''
      if(preservePhoto)uni.showToast({title:t('error.loadFailed'),icon:'none'})
    }
    // A retained thumbnail is never a fallback preview URL after failed renewal.
    return null
  }
  finally{if(alive&&request===version)loading.value=false}
}
function mediaError(){url.value=''}
async function preview(){
  // Renew at interaction time so a photo can still open after a long chat.
  const token=captureActiveAccountRequest(), request=version+1
  const signedUrl=await load(true)
  if(signedUrl && alive && request===version && isAccountRequestCurrent(token))uni.previewImage({current:signedUrl,urls:[signedUrl]})
}
// Polling replaces message objects even when the media identity is unchanged.
// Independent primitive watch sources keep an already loaded image/video mounted.
watch([
  () => props.message.id,
  () => props.message.sender_id,
  () => props.message.conversation_id,
  () => props.message.message_type,
  () => props.message.content,
  () => !!props.message._pending,
], () => void load(), { immediate: true })
onUnmounted(()=>{alive=false;version++;url.value='';removeTransition()})
</script>
<style scoped>
.chat-media{max-width:min(64vw,320px);border-radius:16px;overflow:hidden;background:var(--bg-elev-2)}
.chat-photo,.chat-video{display:block;width:min(64vw,320px);height:240px;background:var(--bg-elev-2)}
.media-photo-button{display:block;margin:0;padding:0;border:0;background:transparent;line-height:1;border-radius:0}
.media-photo-button::after{border:0}
.media-retry{display:flex;align-items:center;gap:10px;min-height:80px;padding:18px;color:var(--text-secondary);font-size:14px;background:transparent;border:0;white-space:normal;line-height:1.5}
.media-retry::after{border:0}.media-legacy{display:block;padding:12px;color:var(--text-muted);font-size:13px}
</style>
