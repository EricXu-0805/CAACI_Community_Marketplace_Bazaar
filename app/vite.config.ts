import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

export default defineConfig({
  plugins: [uni()],
  build: {
    target: "es2017",
    minify: "esbuild",
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("/vue/") || id.includes("@vue/")) return "vue";
          if (id.includes("@dcloudio")) return "uni";
        },
      },
    },
  },
  esbuild: {
    /*
     * PRESERVE console.error + console.warn in production. These are the
     * only debugging surface on mp-weixin once the app reaches real
     * devices — WeChat doesn't ship a remote-logging channel for us.
     *
     * Prior config used `drop: ["console", "debugger"]`, which stripped
     * EVERY console.* including the error handlers in App.vue's
     * onLaunch (onError, onUnhandledRejection, setTimeout try/catch).
     * That's why the compiled app.js had empty handlers `t=>{}` and we
     * couldn't see why text wasn't rendering — every silent failure was
     * genuinely silent.
     *
     * `pure` is the correct knob: esbuild treats listed calls as side-
     * effect-free and DCEs them when their return value is unused,
     * which is every console.log / debug / info site. console.error
     * and console.warn survive, keeping the crash-path visible.
     * `debugger` statements still drop unconditionally.
     */
    drop: ["debugger"],
    pure:
      process.env.NODE_ENV === "production"
        ? ["console.log", "console.debug", "console.info", "console.trace"]
        : [],
  },
});
