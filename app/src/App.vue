<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app"
import { useAuth } from "./composables/useAuth"

const { init } = useAuth()

onLaunch(() => {
  init()
})
</script>

<style>
page {
  background-color: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
    'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #1d1d1f;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* --- Desktop: hide uni-app bottom tabBar --- */
@media (min-width: 768px) {
  uni-tabbar, .uni-tabbar, .uni-tabbar-bottom {
    display: none !important;
  }
}
</style>
