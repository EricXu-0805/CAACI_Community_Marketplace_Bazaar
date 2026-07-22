import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { localDevServerBoundary } from "./dev-server-boundary.mjs";

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
const DEPLOY_ENV_TAG = process.env.VERCEL_ENV?.trim().toLowerCase()
  || (process.env.CI === 'true' ? 'ci' : 'local');

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
 * The plugin is gated on both credentials and a deployment identity:
 *   · Local dev and `vercel build`: no Vercel commit SHA → plugin skipped,
 *     even if Vercel CLI downloaded preview credentials. This keeps a local
 *     verification build from mutating the external Sentry project.
 *   · Vercel production/preview deploys: token + auto-injected commit SHA →
 *     plugin runs, uploads to Sentry, deletes .map files post-upload
 *   · An intentional manual upload must opt in with
 *     SENTRY_UPLOAD_SOURCEMAPS=true and an explicit VITE_RELEASE.
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
const hasManualSentryUploadIdentity =
  process.env.SENTRY_UPLOAD_SOURCEMAPS === "true"
  && !!process.env.VITE_RELEASE?.trim();
const hasSentryUploadIdentity =
  !!process.env.VERCEL_GIT_COMMIT_SHA
  || hasManualSentryUploadIdentity;
const sentryEnabled =
  !isMpBuild
  && hasSentryUploadIdentity
  && !!process.env.SENTRY_AUTH_TOKEN
  && !!process.env.SENTRY_ORG
  && !!process.env.SENTRY_PROJECT;

/*
 * Fail the build before a privileged Supabase key can be inlined into a
 * browser or mini-program bundle. Vite intentionally exposes every VITE_*
 * value to client code, so a typo here is a credential leak, not merely a
 * runtime configuration error. Never include the value in the error message.
 */
function isPrivilegedSupabaseKey(value: string): boolean {
  const candidate = value.trim();
  if (/^sb_secret_/.test(candidate)) return true;

  const parts = candidate.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function rejectPrivilegedSupabaseKeyInPublicEnv(): Plugin {
  return {
    name: "reject-privileged-supabase-key-in-public-env",
    enforce: "pre",
    config(_config, configEnv) {
      const loaded = {
        ...loadEnv(configEnv.mode, __dirname, ""),
        ...process.env,
      };
      for (const name of ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"]) {
        const value = loaded[name];
        if (typeof value === "string" && isPrivilegedSupabaseKey(value)) {
          throw new Error(
            `[supabase-key-guard] ${name} contains a privileged Supabase key; use only a publishable or legacy anon key in VITE_* variables`,
          );
        }
      }
    },
  };
}

function normalizeBuildAppOrigin(raw: unknown): string {
  const value = String(raw || '').trim();
  const match = /^(https?):\/\/(localhost|127\.0\.0\.1|\[::1\]|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i.exec(value);
  if (!match) return '';
  const protocol = match[1].toLowerCase();
  const hostname = match[2].toLowerCase();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (protocol !== 'https' && !(protocol === 'http' && loopback)) return '';
  const port = match[3] || '';
  if (port && (Number(port) < 1 || Number(port) > 65535)) return '';
  const defaultPort = (protocol === 'https' && port === '443')
    || (protocol === 'http' && port === '80');
  return `${protocol}://${hostname}${port && !defaultPort ? `:${Number(port)}` : ''}`;
}

function vercelPreviewOrigin(raw: unknown): string {
  const host = String(raw || '').trim().toLowerCase();
  if (!host) return '';
  const origin = normalizeBuildAppOrigin(`https://${host}`);
  if (!origin) return '';
  try {
    return new URL(origin).host.toLowerCase() === host ? origin : '';
  } catch {
    return '';
  }
}

const SUPABASE_PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const VERCEL_DEPLOY_ENVIRONMENTS = new Set(['production', 'preview', 'development']);

function buildSupabaseProject(raw: unknown): { origin: string; projectRef: string } | null {
  try {
    const url = new URL(String(raw || '').trim());
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
    if (
      url.protocol !== 'https:'
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname !== '/' && url.pathname !== '')
      || !match
    ) return null;
    return { origin: url.origin, projectRef: match[1] };
  } catch {
    return null;
  }
}

function deploymentConfigurationBoundary(): Plugin {
  let manifest = {
    schema: 1,
    environment: DEPLOY_ENV_TAG,
    deployable: false,
    projectRef: '',
    appOrigin: '',
    release: RELEASE_TAG,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) || '',
  };

  return {
    name: 'deployment-configuration-boundary',
    enforce: 'pre',
    config(_config, configEnv) {
      const loaded = {
        ...loadEnv(configEnv.mode, __dirname, ''),
        ...process.env,
      };
      const actualEnvironment = String(loaded.VERCEL_ENV || '').trim().toLowerCase();
      const expectedEnvironment = String(loaded.DEPLOYMENT_EXPECTED_VERCEL_ENV || '').trim().toLowerCase();
      const vercelIdentityPresent = loaded.VERCEL === '1'
        || !!actualEnvironment
        || !!String(loaded.VERCEL_URL || '').trim();
      const environment = actualEnvironment || (loaded.CI === 'true' ? 'ci' : 'local');
      const project = buildSupabaseProject(loaded.VITE_SUPABASE_URL);
      const appOriginRaw = String(loaded.DEPLOYMENT_APP_ORIGIN || '').trim();
      const explicitAppOrigin = normalizeBuildAppOrigin(appOriginRaw);
      const previewOrigin = actualEnvironment === 'preview'
        ? vercelPreviewOrigin(loaded.VERCEL_URL)
        : '';
      const appOrigin = explicitAppOrigin || (!appOriginRaw ? previewOrigin : '');

      if (vercelIdentityPresent) {
        if (!VERCEL_DEPLOY_ENVIRONMENTS.has(actualEnvironment)) {
          throw new Error('[deployment-boundary] VERCEL_ENV is missing or unsupported');
        }
        if (expectedEnvironment !== actualEnvironment) {
          throw new Error('[deployment-boundary] DEPLOYMENT_EXPECTED_VERCEL_ENV does not match VERCEL_ENV');
        }
        if (actualEnvironment !== 'development' && loaded.VERCEL !== '1') {
          throw new Error('[deployment-boundary] Vercel deployment identity is incomplete');
        }

        const expectedProjectRef = String(loaded.SUPABASE_EXPECTED_PROJECT_REF || '').trim().toLowerCase();
        if (!SUPABASE_PROJECT_REF_RE.test(expectedProjectRef)) {
          throw new Error('[deployment-boundary] SUPABASE_EXPECTED_PROJECT_REF is missing or invalid');
        }
        if (!project || project.projectRef !== expectedProjectRef) {
          throw new Error('[deployment-boundary] VITE_SUPABASE_URL does not match the expected project ref');
        }
        if (!appOrigin || (actualEnvironment !== 'development' && !appOrigin.startsWith('https://'))) {
          throw new Error('[deployment-boundary] DEPLOYMENT_APP_ORIGIN must be the exact deployment origin');
        }
        if (actualEnvironment === 'preview') {
          if (!previewOrigin || appOrigin !== previewOrigin) {
            throw new Error('[deployment-boundary] Preview app origin does not match VERCEL_URL');
          }
        }
      }

      manifest = {
        schema: 1,
        environment,
        deployable: vercelIdentityPresent
          && ['production', 'preview'].includes(actualEnvironment)
          && !!String(loaded.VERCEL_GIT_COMMIT_SHA || '').trim(),
        projectRef: project?.projectRef || '',
        appOrigin,
        release: RELEASE_TAG,
        commit: String(loaded.VERCEL_GIT_COMMIT_SHA || '').trim().slice(0, 40),
      };

      return {
        define: {
          'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(environment),
        },
      };
    },
    generateBundle() {
      if (isMpBuild) return;
      this.emitFile({
        type: 'asset',
        fileName: 'deployment-manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

/*
 * A mini-program has no window.location fallback. Reject an artifact that
 * would compile every first-party API/share/recovery URL to the empty string;
 * CI and pre-push provide explicit non-production origins for this reason.
 * H5 remains same-origin at runtime and deliberately does not require this.
 */
function requireMpAppOrigin(): Plugin {
  return {
    name: 'require-mp-app-origin',
    enforce: 'pre',
    config(_config, configEnv) {
      if (!isMpBuild) return;
      const loaded = {
        ...loadEnv(configEnv.mode, __dirname, ''),
        ...process.env,
      };
      if (!normalizeBuildAppOrigin(loaded.VITE_BASE_URL)) {
        throw new Error(
          '[app-origin-guard] VITE_BASE_URL must be an exact HTTPS origin (or loopback HTTP for local emulators) for mp builds',
        );
      }
    },
  };
}

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
 * For node_modules content the relative path begins with `../`, which can
 * yield a chunk filename whose leading `..-` is an invalid ES module
 * specifier prefix when a dependency is dynamically imported.
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
 * manualChunks() set it to (for example, `supabase`).
 */
function chunkFileNamesForNodeModules(): Plugin {
  return {
    name: "override-chunk-filenames-for-node-modules",
    enforce: "post",
    config() {
      /*
       * H5-only. On mp-* targets uni-mp-vite owns the output layout: page
       * chunks MUST land at their pages/<page>.js paths for WeChat to
       * resolve app.json's pages list. This post-enforce override was
       * winning that write on mp too, renaming every page entry into
       * assets/<base64-of-vue-path>.js — the bundle built exit-0 but could
       * never boot ("未找到 pages/index/index.js").
       */
      if (isMpBuild) return {};
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

/*
 * uni-h5 injects a hidden `body::after` animation whose only purpose is to
 * preload DCloud's remote `shadow-grey.png`. The app does not use uni's page
 * head shadow, and our production CSP intentionally allows images only from
 * this origin, data/blob URLs, and the configured Supabase project. Leaving
 * the preload in place therefore creates a production-only CSP error three
 * seconds after every page load.
 *
 * Keep the CSP strict and remove only the hidden preload request after
 * uni-h5's own transform has appended it. This does not alter any visible
 * component or mini-program output.
 */
function removeUniH5RemoteShadowPreload(): Plugin {
  const remotePreload = 'url(https://cdn.dcloud.net.cn/img/shadow-grey.png)';
  return {
    name: 'remove-uni-h5-remote-shadow-preload',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      if (isMpBuild) return;
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset' || !output.fileName.endsWith('.css')) continue;
        const source = typeof output.source === 'string'
          ? output.source
          : Buffer.from(output.source).toString('utf8');
        if (!source.includes('shadow-preload') || !source.includes(remotePreload)) continue;
        output.source = source.replaceAll(remotePreload, 'none');
      }
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
    localDevServerBoundary(),
    deploymentConfigurationBoundary(),
    rejectPrivilegedSupabaseKeyInPublicEnv(),
    requireMpAppOrigin(),
    mpWebApiGlobalThisRewrite(),
    uni(),
    removeUniH5RemoteShadowPreload(),
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
    'import.meta.env.VITE_DEPLOY_ENV': JSON.stringify(DEPLOY_ENV_TAG),
  },
  server: {
    // The Uni plugin still pins vulnerable Vite 5.2.8. Never expose that
    // development server on a LAN interface, silently move to another port,
    // or grant arbitrary browser origins readable access.
    host: "127.0.0.1",
    strictPort: true,
    cors: {
      origin: /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i,
    },
  },
  build: {
    target: "es2017",
    minify: "esbuild",
    cssCodeSplit: true,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
    sourcemap: sentryEnabled ? "hidden" : false,
    // mp-* builds get NO custom rollup output: uni-mp-vite's own chunking
    // (common/vendor.js + per-page entry files) is load-bearing for WeChat.
    rollupOptions: isMpBuild
      ? {}
      : {
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
