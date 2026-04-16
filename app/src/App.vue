<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app"
import { useAuth } from "./composables/useAuth"

const { init } = useAuth()

onLaunch(() => {
  init()
  uni.onUnhandledRejection?.((e: any) => {
    console.error('Unhandled rejection:', e.reason)
  })
})
</script>

<style>
page {
  background-color: #f7f7f8;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
    'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: #1a1a1a;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  letter-spacing: -0.01em;
}

uni-tabbar, .uni-tabbar, .uni-tabbar-bottom {
  display: none !important;
}

view, text { box-sizing: border-box; }

input, textarea {
  font-family: inherit;
  letter-spacing: inherit;
}
</style>
