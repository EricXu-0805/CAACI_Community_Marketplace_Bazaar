import { readFileSync } from 'node:fs'
import ts from 'typescript'

export const USER = '11111111-1111-4111-8111-111111111111'
export const SECOND_USER = '44444444-4444-4444-8444-444444444444'
export const EVENT = '22222222-2222-4222-8222-222222222222'
export const NOW = Date.parse('2026-11-22T16:00:00Z')
export const INPUT = {
  postId: '33333333-3333-4333-8333-333333333333',
  title: '\u3000Saturday\t badminton\u00a0', content: '  Bring a racket.\nSplit costs in person.  ',
  location: '\ufeffARC\u2028Court 1\u3000', startsAt: '2026-11-24T16:00:00.000Z',
  endsAt: '2026-11-24T18:00:00.000Z',
}
const dataUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
let instance = 0

// As in the neighboring composable suites, replace app/SaaS boundaries, while
// running the real account guard, result-state helpers, readers and text rules.
export async function memberWorld(t) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const name = `__memberEventWorld${++instance}`
  const state = {
    user: USER, verified: true, timeline: [], checks: [], moderations: [], wechat: [],
    calls: [], updates: [], flagged: false, restricted: false, rpcError: null,
    rpcThrow: null, onModerate: null, onRpc: null, switchValue: true, switchError: null,
    switchThrow: null, holdOpen: null, onOpen: null,
    rows: [{ id: EVENT, source_type: 'member', organizer_user_id: USER, cancelled_at: null }],
  }
  globalThis[name] = state
  t.after(() => { delete globalThis[name] })
  const world = `globalThis.${name}`
  const stubs = {
    'composables/useAuth.ts': `export const useAuth = () => ({
      currentUser: { get value() { const w=${world}; return w.user ? { id:w.user, is_illini_verified:w.verified } : null } },
      awaitAuthReady: async () => { ${world}.timeline.push('auth') },
    })`,
    'composables/useRestriction.ts': `export function assertWritesAllowed() {
      const w=${world}; w.timeline.push('writes'); if(w.restricted) throw new Error('suspension_active');
    }`,
    'composables/useSupabase.ts': `export const useSupabase = () => ({supabase:${world}.supabase})`,
    'composables/useModeration.ts': `export const useModeration = () => ({
      blockedIds:{value:new Set()}, ensureLoaded:async()=>({ok:true}),
    })`,
    'utils/region.ts': `export const ACTIVE_REGION = 'cu'`,
    'utils/contentSafety.ts': `export function checkContent(text, options) {
      const w=${world}; w.timeline.push('check'); w.checks.push({text,options}); return {ok:true};
    }
    export async function remoteModerate(text, token) {
      const w=${world}; w.timeline.push('remote'); w.moderations.push({text,token});
      w.onModerate?.(); return {flagged:w.flagged,categories:[]};
    }`,
    'composables/useWechatSecCheck.ts': `export async function mpTextGate(text, scene, token) {
      const w=${world}; w.timeline.push('wechat'); w.wechat.push({text,scene,token});
    }`,
  }
  state.supabase = {
    async rpc(name, args) {
      state.calls.push({ name, args: structuredClone(args) })
      if (name === 'community_member_events_open') {
        const answer = { data: state.switchValue, error: state.switchError }
        state.onOpen?.()
        if (state.holdOpen) await state.holdOpen
        if (state.switchThrow) throw state.switchThrow
        return answer
      }
      if (name === 'list_community_events') return { data: structuredClone(state.rows), error: null }
      state.timeline.push('rpc')
      state.onRpc?.()
      if (state.rpcThrow) throw state.rpcThrow
      return {
        data: state.rpcError ? null : { post_id: args.post_id_in, event_id: EVENT },
        error: state.rpcError, status: state.rpcError ? 400 : 200,
      }
    },
    from(table) {
      const filters = []
      let values
      let fields
      const query = {
        update(body) { values = structuredClone(body); return query },
        eq(key, value) { filters.push([key, value]); return query },
        select(columns) { fields = columns.split(',').map(value => value.trim()); return query },
        async single() {
          state.timeline.push('update')
          state.updates.push({ table, values, filters, fields })
          const row = state.rows.find(row => filters.every(([key, value]) => row[key] === value))
          if (!row) return { data: null, error: { code: 'PGRST116', message: 'No row' }, status: 406 }
          const changed = { ...row, ...values }
          state.rows = state.rows.map(row => row.id === changed.id ? changed : row)
          return { data: { id: changed.id, cancelled_at: changed.cancelled_at }, error: null, status: 200 }
        },
      }
      return query
    },
  }
  const root = new URL('../src/', import.meta.url)
  const urls = new Map()
  function compile(relative) {
    if (urls.has(relative)) return urls.get(relative)
    const file = new URL(relative, root)
    const input = stubs[relative] ?? readFileSync(file, 'utf8')
    let code = ts.transpileModule(input, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText
    for (const match of code.matchAll(/\bfrom\s+(['"])(\.[^'"]+)\1/g)) {
      const dependency = new URL(`${match[2]}.ts`, file).href.slice(root.href.length)
      code = code.replaceAll(match[0], `from '${compile(dependency)}'`)
    }
    const url = dataUrl(`${code}\n// world ${name}`)
    urls.set(relative, url)
    return url
  }
  const load = relative => import(compile(relative))
  const scope = await load('composables/accountScope.ts')
  scope.transitionAccount(USER)
  return { state, scope, load }
}
