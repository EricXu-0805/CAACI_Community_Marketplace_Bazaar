<template>
  <view class="swipe-row" :class="{ 'is-open': offset !== 0 }">
    <view v-if="offset !== 0" class="swipe-action" :class="{ 'on-left': offset > 0 }" role="button" tabindex="0" :aria-label="actionLabel" @click.stop="activateAction">
      <UIcon name="trash" size="sm" /><text>{{ actionLabel }}</text>
    </view>
    <view class="swipe-content" :style="{ transform: `translateX(${offset}px)` }"
      @touchstart="start" @touchmove="move" @touchend="end" @touchcancel="cancel">
      <view ref="linkEl" class="swipe-link" role="button" tabindex="0" :aria-label="label"
        aria-keyshortcuts="Delete Shift+F10" @click="open" @longpress="menu">
        <slot />
      </view>
      <view class="swipe-visible-action" role="button" tabindex="0" :aria-label="actionLabel" @click.stop="activateAction">
        <UIcon name="trash" size="sm" />
      </view>
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import UIcon from './UIcon.vue'
import { useDomKeydown } from '../composables/useDomKeydown'
const linkEl = ref<unknown>(null)
useDomKeydown(linkEl, keydown)
defineProps<{ label: string; actionLabel: string }>()
const emit = defineEmits<{ (e: 'open'): void; (e: 'action'): void; (e: 'menu'): void }>()
const offset = ref(0)
let startX=0, startY=0, initialOffset=0, horizontal=false, vertical=false, suppressClickUntil=0
function start(event:any) {
 const touch=event.touches?.[0];if(!touch)return
 startX=touch.clientX;startY=touch.clientY;initialOffset=offset.value;horizontal=false;vertical=false
}
function move(event:any) {
 const touch=event.touches?.[0];if(!touch || vertical)return
 const dx=touch.clientX-startX,dy=touch.clientY-startY
 if(!horizontal && Math.max(Math.abs(dx),Math.abs(dy))>12) {
  horizontal=Math.abs(dx)>Math.abs(dy)*1.2;vertical=!horizontal
 }
 if(horizontal)offset.value=Math.max(-88,Math.min(88,initialOffset+dx))
}
function end() {
 if(horizontal){offset.value=Math.abs(offset.value)>30 ? Math.sign(offset.value)*88 : 0;suppressClickUntil=Date.now()+450}
 horizontal=false;vertical=false
}
function cancel(){offset.value=0;horizontal=false;vertical=false}
function open(){if(Date.now()<suppressClickUntil)return;if(offset.value){offset.value=0;return}emit('open')}
function activateAction(){offset.value=0;emit('action')}
function menu(){suppressClickUntil=Date.now()+450;emit('menu')}
function keydown(event:KeyboardEvent){
 if(event.key==='Escape'){event.preventDefault();offset.value=0}
 if(event.key==='Delete'||event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10')){event.preventDefault();event.stopPropagation();menu()}
}
</script>
<style scoped>
.swipe-row{position:relative;overflow:hidden;border-radius:14px;background:var(--accent-danger);}
.swipe-content{position:relative;display:flex;align-items:center;background:var(--bg-elev-1);transition:transform 180ms var(--ease-std);touch-action:pan-y;}
.swipe-link{flex:1;min-width:0;cursor:pointer;}
.swipe-visible-action{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:44px;min-height:48px;color:var(--text-muted);cursor:pointer;}
.swipe-visible-action:hover{color:var(--accent-danger);}
.swipe-action{position:absolute;right:0;inset-block:0;width:88px;display:flex;flex-direction:column;gap:4px;align-items:center;justify-content:center;font-size:12px;color:#fff;cursor:pointer;}
.swipe-action.on-left{left:0;right:auto;}
@media(prefers-reduced-motion:reduce){.swipe-content{transition:none;}}
</style>
