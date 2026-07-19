/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_BASE_URL?: string
  readonly VITE_SUPPORT_EMAIL?: string
  readonly VITE_RELEASE?: string
  readonly VITE_DEPLOY_ENV?: 'production' | 'preview' | 'development' | 'ci' | 'local'
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}

// heic-to publishes this subpath and its own declaration, but this project is
// intentionally still on TypeScript 4.9/node resolution for uni-app, which
// does not follow the package's conditional `exports.types` entry.
declare module 'heic-to/csp' {
  export { heicTo, isHeic } from 'heic-to'
}
