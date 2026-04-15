<template>
  <view class="tabbar">
    <view class="tab" @click="go('/pages/index/index')">
      <view :class="['ico', 'ico-home', { active: current === 'index' }]"></view>
      <text :class="['lbl', { active: current === 'index' }]">{{ t('nav.home') }}</text>
    </view>
    <view class="tab" @click="go('/pages/messages/index')">
      <view class="ico-wrap">
        <view :class="['ico', 'ico-msg', { active: current === 'messages' }]"></view>
        <view v-if="unreadCount > 0" class="badge-dot"></view>
      </view>
      <text :class="['lbl', { active: current === 'messages' }]">{{ t('nav.messages') }}</text>
    </view>
    <view class="tab fab-slot" @click="go('/pages/publish/index')">
      <view class="fab"><view class="fab-plus"></view></view>
    </view>
    <view class="tab" @click="go('/pages/profile/index')">
      <view :class="['ico', 'ico-me', { active: current === 'profile' }]"></view>
      <text :class="['lbl', { active: current === 'profile' }]">{{ t('nav.profile') }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useSupabase } from '../composables/useSupabase'
import { useAuth } from '../composables/useAuth'

defineProps<{ current: string }>()
const { t } = useI18n()
const { supabase } = useSupabase()
const { currentUser } = useAuth()

const unreadCount = ref(0)

onMounted(async () => {
  if (!currentUser.value) return
  try {
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .neq('sender_id', currentUser.value.id)
      .eq('is_read', false)
      .in('conversation_id',
        (await supabase
          .from('conversations')
          .select('id')
          .or(`buyer_id.eq.${currentUser.value.id},seller_id.eq.${currentUser.value.id}`)
        ).data?.map((c: any) => c.id) || []
      )
    unreadCount.value = count || 0
  } catch {}
})

function go(url: string) { uni.switchTab({ url }) }
</script>

<style scoped>
.tabbar {
  display: none; position: fixed; bottom: 0; left: 0; right: 0;
  height: 50px; padding-bottom: env(safe-area-inset-bottom, 0px);
  background: rgba(252,252,253,0.88);
  backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 0.5px solid rgba(0,0,0,0.08);
  z-index: 999; align-items: flex-end; justify-content: space-around;
}
.tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 4px 0 2px; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.lbl { font-size: 10px; color: #8e8e93; margin-top: 2px; font-weight: 500; }
.lbl.active { color: #1a1a1a; }

.ico { width: 24px; height: 24px; position: relative; }
.ico-wrap { position: relative; }

.ico-home::before {
  content: ''; position: absolute; bottom: 0; left: 2px; right: 2px; height: 12px;
  border: 1.8px solid #8e8e93; border-top: none; border-radius: 0 0 3px 3px;
}
.ico-home::after {
  content: ''; position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
  width: 0; height: 0;
  border-left: 9px solid transparent; border-right: 9px solid transparent;
  border-bottom: 8px solid #8e8e93;
}
.ico-home.active::before { border-color: #1a1a1a; }
.ico-home.active::after { border-bottom-color: #1a1a1a; }

.ico-msg::before {
  content: ''; position: absolute; top: 2px; left: 1px;
  width: 20px; height: 15px;
  border: 1.8px solid #8e8e93; border-radius: 10px 10px 10px 2px;
}
.ico-msg.active::before { border-color: #1a1a1a; }

.ico-me::before {
  content: ''; position: absolute; top: 1px; left: 7px;
  width: 10px; height: 10px; border: 1.8px solid #8e8e93; border-radius: 50%;
}
.ico-me::after {
  content: ''; position: absolute; bottom: 0; left: 2px;
  width: 20px; height: 9px;
  border: 1.8px solid #8e8e93; border-radius: 10px 10px 0 0; border-bottom: none;
}
.ico-me.active::before, .ico-me.active::after { border-color: #1a1a1a; }

.badge-dot {
  position: absolute; top: 0; right: 0;
  width: 8px; height: 8px; border-radius: 50%;
  background: #FF3B30;
  border: 1.5px solid rgba(252,252,253,0.88);
}

.fab-slot { position: relative; }
.fab {
  width: 42px; height: 42px; border-radius: 13px;
  background: #1a1a1a;
  display: flex; align-items: center; justify-content: center;
  margin-top: -12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  transition: transform 0.12s;
}
.fab:active { transform: scale(0.9); }
.fab-plus { width: 18px; height: 18px; position: relative; }
.fab-plus::before, .fab-plus::after {
  content: ''; position: absolute; background: #fff; border-radius: 1px;
}
.fab-plus::before { width: 18px; height: 2px; top: 8px; left: 0; }
.fab-plus::after { width: 2px; height: 18px; top: 0; left: 8px; }

@media (max-width: 767px) { .tabbar { display: flex; } }
</style>
