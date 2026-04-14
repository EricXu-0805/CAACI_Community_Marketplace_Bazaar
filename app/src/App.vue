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
  background-color: #f5f5f5;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
    'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #1d1d1f;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Apple-inspired responsive container */
.app-container {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100vh;
  background: #fff;
  position: relative;
}

@media (min-width: 768px) {
  page {
    background-color: #e8e8ed;
  }
  .app-container {
    box-shadow: 0 0 40px rgba(0,0,0,0.08);
    border-radius: 0;
  }
}
</style>
