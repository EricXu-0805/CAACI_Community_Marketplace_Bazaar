import { defineConfig } from "vite";
import type { Plugin } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

/*
 * Rewrites every `new URL(` and `new URLSearchParams(` reference inside
 * @supabase/* package code to go through `globalThis.` on mp builds.
 *
 * Why: WeChat mini-program JSCore exposes URL on globalThis but bare
 * identifier lookup inside vendor.js can return undefined (witnessed
 * on 3.15.x DevTools — globalThis.URL probe succeeds, but supabase-js's
 * `new URL(supabaseUrl)` still throws because the call site is in a
 * scope where bare `URL` doesn't reach the global). Forcing the lookup
 * through `globalThis.URL` (where our urlShim installs MiniURL) routes
 * the call to the polyfill regardless of scope quirks.
 *
 * Scoped to @supabase/* paths so we don't accidentally rewrite our own
 * code or unrelated deps. Only fires when UNI_PLATFORM is mp-* — H5
 * builds keep native URL.
 */
function mpUrlGlobalThisRewrite(): Plugin {
  return {
    name: "mp-supabase-url-globalthis",
    enforce: "pre",
    transform(code, id) {
      const platform = process.env.UNI_PLATFORM || "";
      if (!platform.startsWith("mp-")) return null;
      if (!id.includes("@supabase")) return null;
      if (!code.includes("new URL(") && !code.includes("new URLSearchParams("))
        return null;
      return {
        code: code
          .replace(/new URL\(/g, "new globalThis.URL(")
          .replace(/new URLSearchParams\(/g, "new globalThis.URLSearchParams("),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [mpUrlGlobalThisRewrite(), uni()],
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
