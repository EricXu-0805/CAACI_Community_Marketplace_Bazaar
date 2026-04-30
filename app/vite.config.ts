import path from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { sentryVitePlugin } from "@sentry/vite-plugin";

/*
 * VITE_RELEASE auto-derivation order:
 *   1. VITE_RELEASE env var (manual override — useful for testing or
 *      pinning a release name across multiple deploys)
 *   2. VERCEL_GIT_COMMIT_SHA — auto-injected by Vercel at build time,
 *      first 7 chars match `git log --oneline` short SHAs
 *   3. 'dev' — local development fallback so Sentry still tags events
 *      with a sensible release rather than `undefined`
 *
 * Wired into the bundle via Vite's `define` (string-replace at build
 * time), not via the env-var pipeline, because VERCEL_* vars are not
 * VITE_-prefixed and Vite's default env loader filters them out.
 */
const RELEASE_TAG =
  process.env.VITE_RELEASE
  || (process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7))
  || 'dev';

/*
 * Sentry source-map upload gate.
 *
 * Source maps are valuable in production — they turn
 *   at e (assets/index-DRvVKW3T.js:1:54312)
 * into
 *   at handleSubmit (src/pages/login/index.vue:42:15)
 * inside Sentry's stack trace viewer.
 *
 * The trade-off: shipping .map files publicly leaks the original
 * source. The fix is `build.sourcemap: 'hidden'` (generate the .map
 * but omit the //# sourceMappingURL comment), pair that with
 * @sentry/vite-plugin to upload the .map files to Sentry, then delete
 * them from the build output so Vercel never serves them.
 *
 * The plugin is gated on SENTRY_AUTH_TOKEN being present:
 *   · Local dev: token absent → plugin skipped, build is fast, no
 *     source maps generated (sourcemap option still in effect but
 *     plugin won't upload anything)
 *   · Vercel production deploys: token present in env → plugin runs,
 *     uploads to Sentry, deletes .map files post-upload
 *   · CI (GitHub Actions): we deliberately do NOT pass the token, so
 *     CI builds stay fast and don't pollute Sentry releases. Vercel
 *     is the source of truth for what's deployed.
 *
 * mp-* builds (UNI_PLATFORM=mp-weixin etc.) skip the plugin entirely:
 *   1. Sentry browser SDK doesn't run on mp targets so symbolicating
 *      mp stack traces with H5 source maps is meaningless
 *   2. Vite's sourcemap output for mp-weixin is a different beast (mp
 *      packages files into wxs bundles); the plugin would try to
 *      upload them under the same release as H5 and pollute the data
 */
const isMpBuild = (process.env.UNI_PLATFORM || "").startsWith("mp-");
const sentryEnabled =
  !isMpBuild
  && !!process.env.SENTRY_AUTH_TOKEN
  && !!process.env.SENTRY_ORG
  && !!process.env.SENTRY_PROJECT;

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
/*
 * Override uni-h5-vite's plugin/config.js chunkFileNames hook for chunks
 * whose facade module resolves outside app/src/ (i.e. node_modules
 * content reached via dynamic import). uni-h5-vite prepends a dirname-
 * relative-to-src prefix to every chunk's [name]. For in-src chunks
 * that produces the existing project convention
 * (`composables-useFavorites.<hash>.js`, `pages-publish-index.<hash>.js`).
 * For node_modules content the relative path begins with `../`,
 * yielding a chunk filename like `..-node_modules-heic-to-dist-heic-to.<hash>.js`
 * — whose leading `..-` is an invalid ES module specifier prefix that
 * the browser's module resolver rejects when the chunk is dynamic-
 * imported (witnessed for heic-to in commit f4adfb8 — see
 * _ai_notes/HEIC_VITE_CHUNK_DIAGNOSIS.md §10).
 *
 * Why a Vite plugin (not user-config rollupOptions): Vite merges plugin
 * `config` hook returns ON TOP of user config, so chunkFileNames set in
 * user rollupOptions.output is overwritten by uni-h5-vite's plugin
 * (uni-h5-vite runs as `uni()` in our plugins array). Empirically
 * verified — user-config chunkFileNames was never invoked. The fix is
 * to wrap our override in a plugin with `enforce: 'post'` so it runs
 * AFTER uni() and gets the last write into the merged config.
 *
 * The function mirrors uni-h5-vite's in-src naming exactly (so chunk
 * names like `composables-useFavorites.<hash>.js` are unchanged and
 * browser caches stay valid for existing users) and only diverges when
 * dirname starts with `..` — i.e. node_modules content. Those chunks
 * become `assets/[name].[hash].js`, where `[name]` is whatever
 * manualChunks() set it to (`heic-to`, `supabase`, etc.).
 */
function chunkFileNamesForNodeModules(): Plugin {
  return {
    name: "override-chunk-filenames-for-node-modules",
    enforce: "post",
    config() {
      return {
        build: {
          rollupOptions: {
            output: {
              chunkFileNames: (chunkInfo: { facadeModuleId?: string | null }) => {
                const inputDir = process.env.UNI_INPUT_DIR || path.resolve(__dirname, "src");
                if (chunkInfo.facadeModuleId) {
                  const dirname = path
                    .relative(inputDir, path.dirname(chunkInfo.facadeModuleId))
                    .replace(/\\/g, "/");
                  if (dirname && !dirname.startsWith("..")) {
                    return `assets/${dirname.replace(/\//g, "-")}-[name].[hash].js`;
                  }
                }
                return "assets/[name].[hash].js";
              },
            },
          },
        },
      };
    },
  };
}

function mpWebApiGlobalThisRewrite(): Plugin {
  const APIS = ["URL", "URLSearchParams", "Headers", "AbortController", "AbortSignal"];
  const constructorRe = new RegExp(
    `new (${APIS.join("|")})\\(`,
    "g",
  );
  return {
    name: "mp-supabase-webapi-globalthis",
    enforce: "pre",
    transform(code, id) {
      const platform = process.env.UNI_PLATFORM || "";
      if (!platform.startsWith("mp-")) return null;
      if (!id.includes("@supabase")) return null;
      if (!constructorRe.test(code)) return null;
      constructorRe.lastIndex = 0;
      return {
        code: code.replace(constructorRe, (_m, ctor) => `new globalThis.${ctor}(`),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [
    mpWebApiGlobalThisRewrite(),
    uni(),
    chunkFileNamesForNodeModules(),
    ...(sentryEnabled
      ? [
          sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN!,
            org: process.env.SENTRY_ORG!,
            project: process.env.SENTRY_PROJECT!,
            release: { name: RELEASE_TAG },
            sourcemaps: {
              assets: ["./dist/build/h5/**"],
              filesToDeleteAfterUpload: ["./dist/build/h5/**/*.map"],
            },
            telemetry: false,
          }),
        ]
      : []),
  ],
  define: {
    'import.meta.env.VITE_RELEASE': JSON.stringify(RELEASE_TAG),
  },
  build: {
    target: "es2017",
    minify: "esbuild",
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    sourcemap: sentryEnabled ? "hidden" : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("/vue/") || id.includes("@vue/")) return "vue";
          if (id.includes("@dcloudio")) return "uni";
          if (id.includes("/heic-to/")) return "heic-to";
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
