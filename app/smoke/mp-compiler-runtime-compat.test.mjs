import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// This covers the actual DCloud MP compiler/runtime contract. A tiny setData
// host is sufficient for Vue component effects and emitted native handlers;
// it intentionally does not claim WeChat WXML/layout or app/page lifecycle coverage.
// Resolve from this file after copying it to app/smoke; never load Vite/dotenv.
test('DCloud MP compiled input, reactivity, and component teardown agree', async (t) => {
  const appDir = fileURLToPath(new URL('../', import.meta.url))
  const envKeys = ['NODE_ENV', 'UNI_PLATFORM', 'UNI_INPUT_DIR', 'UNI_CLI_CONTEXT']
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  t.after(() => {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
  })
  Object.assign(process.env, {
    NODE_ENV: 'production', UNI_PLATFORM: 'mp-weixin',
    UNI_INPUT_DIR: path.join(appDir, 'src'), UNI_CLI_CONTEXT: appDir,
  })
  const appRequire = createRequire(path.join(appDir, 'package.json'))
  // The Uni CLI loads aliases before any compiler import. This selects its
  // bundled compiler-sfc/core, rather than the separate official root package.
  appRequire('./build-compat/compiler/bootstrap.cjs')
  appRequire('@dcloudio/uni-cli-shared/dist/alias')
  appRequire('@dcloudio/uni-cli-shared/dist/polyfill')
  const ts = appRequire('typescript')
  const shared = appRequire('@dcloudio/uni-cli-shared')
  const sfcPath = shared.resolveBuiltIn('@vue/compiler-sfc')
  const sfc = appRequire(sfcPath)
  const mpCompiler = appRequire('@dcloudio/uni-mp-compiler')
  const uniShared = appRequire('@dcloudio/uni-shared')
  const polyfill = appRequire('@dcloudio/uni-mp-vite/dist/plugin/polyfill.js')
  polyfill.rewriteCompileScriptOnce()
  polyfill.rewriteCompilerSfcParseOnce()
  const runtimePath = appRequire.resolve('@dcloudio/uni-mp-vue/dist/vue.runtime.esm.js')
  const runtimeRequire = createRequire(runtimePath)
  const errors = []
  const sandbox = vm.createContext({
    process: { env: { NODE_ENV: 'production', UNI_PLATFORM: 'mp-weixin' } },
    console: { warn: (...args) => errors.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')), log() {} },
    setTimeout, clearTimeout, queueMicrotask,
    __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_CREATED_DEFERRED__: false,
    uni: { invokeCreateVueAppHook() {} },
  })

  function evaluate(source, filename, requireModule) {
    const code = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText
    const module = { exports: {} }
    vm.runInContext(`(function(require,module,exports){${code}\n})`, sandbox, { filename })(requireModule, module, module.exports)
    return module.exports
  }
  const Vue = evaluate(readFileSync(runtimePath, 'utf8'), runtimePath, runtimeRequire)
  const emitted = new Map()
  function compileComponent(source, name) {
    const filename = path.join(appDir, 'src', 'components', `${name}.vue`)
    const { descriptor, errors: parseErrors } = sfc.parse(source, { filename })
    assert.deepEqual(parseErrors, [])
    const compiled = sfc.compileScript(descriptor, {
      id: `canary-${name}`, inlineTemplate: true, isProd: true,
      templateOptions: {
        compiler: mpCompiler,
        compilerOptions: {
          mode: 'module', prefixIdentifiers: true, hoistStatic: false,
          // @vitejs/plugin-vue adds this for <script setup lang="ts">.
          expressionPlugins: ['typescript'],
          root: path.join(appDir, 'src'),
          isNativeTag: uniShared.isMiniProgramNativeTag,
          miniProgram: {
            class: { array: true }, event: { key: true }, directive: 'wx:',
            slot: { fallbackContent: false, dynamicSlotNames: true },
            component: { ':host': true, dir: 'wxcomponents', vShow: shared.COMPONENT_CUSTOM_HIDDEN },
            emitFile(file) { emitted.set(file.fileName, file.source); return file.fileName },
          },
        },
      },
    })
    return evaluate(compiled.content, filename, specifier => {
      assert.equal(specifier, 'vue', `unexpected component dependency ${specifier}`)
      return Vue
    }).default
  }

  function applyDataPath(target, key, value) {
    const fields = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let i = 0; i < fields.length - 1; i++) {
      cursor = cursor[fields[i]] ??= /^\d+$/.test(fields[i + 1]) ? [] : {}
    }
    cursor[fields.at(-1)] = value
  }
  const app = Vue.createApp({})
  app.config.errorHandler = error => errors.push(String(error?.stack || error))
  const root = app.mount()
  function mount(component, props = {}) {
    const writes = []
    const host = {
      data: {},
      setData(patch, done) {
        const copy = JSON.parse(JSON.stringify(patch))
        writes.push(copy)
        for (const [key, value] of Object.entries(copy)) applyDataPath(this.data, key, value)
        if (done) queueMicrotask(done)
      },
      selectAllComponents() { return [] },
    }
    const instance = root.$createComponent({ type: component, props }, {
      mpType: 'component', mpInstance: host, parentComponent: root.$,
      onBeforeSetup(instance) {
        Object.assign(instance.ctx, { mpType: 'component', $mpType: 'component', $mpPlatform: 'mp-weixin', $scope: host })
      },
    })
    // uni-mp-weixin's native ready hook marks this before subsequent updates.
    // We model only that host state, not automatic native lifecycle delivery.
    instance.$.isMounted = true
    return { instance, host, writes, destroy: () => root.$destroyComponent(instance) }
  }
  async function flush() { await Vue.nextTick(); await Promise.resolve(); await Vue.nextTick() }
  const values = value => typeof value === 'object' && value !== null
    ? Object.values(value).flatMap(values) : [value]

  // Real application SFC through actual compiler + MP native event adapter.
  const input = compileComponent(readFileSync(path.join(appDir, 'src/components/UCodeInput.vue'), 'utf8'), 'UCodeInput')
  const models = []
  let field
  field = mount(input, { modelValue: '', 'onUpdate:modelValue': value => {
    models.push(value)
    Vue.updateProps(field.instance.$, { modelValue: value, 'onUpdate:modelValue': field.instance.$.vnode.props['onUpdate:modelValue'] }, field.instance.$.vnode.props)
  } })
  await flush()
  const event = Object.keys(field.host).find(key => /^e\d/.test(key) && typeof field.host[key] === 'function')
  assert.ok(event, 'compiled input must install a real MP event handler')
  field.host[event]({ type: 'input', detail: { value: '12x34567' }, target: { dataset: { eventsync: true } } })
  await flush()
  assert.deepEqual(models, ['123456'], 'native input must emit exactly one normalized value')
  assert.ok(values(field.host.data).includes('123456'), 'parent model update must repaint the compiled child value')
  field.destroy()

  // A small feature canary exercises nested reactive props, computed rendering,
  // branching/list helpers, watch invalidation, and actual component teardown.
  const feature = compileComponent(`<template><view><text v-if="form.visible">{{ doubled }}</text><text v-else>hidden</text><text v-for="row in form.rows" :key="row.id">{{ row.label }}</text></view></template>
  <script setup lang="ts">
  import { computed, watch, onUnmounted, onScopeDispose } from 'vue'
  const props = defineProps<{ form: { price: number; visible: boolean; rows: { id: string; label: string }[] }; audit: (kind: string, value?: number) => void }>()
  const doubled = computed(() => props.form.price * 2)
  watch(() => props.form.price, (value, old, cleanup) => { props.audit('watch', value); cleanup(() => props.audit('cleanup', value)) })
  onUnmounted(() => props.audit('unmounted'))
  onScopeDispose(() => props.audit('disposed'))
  </script>`, 'ReactivityCanary')
  const form = Vue.reactive({ price: 2, visible: true, rows: [{ id: 'a', label: 'row-a' }] })
  const audit = []
  const component = mount(feature, { form, audit: (...entry) => audit.push(entry) })
  await flush()
  const featureTemplate = String([...emitted].find(([file]) => file.includes('ReactivityCanary'))?.[1] || '')
  const visibilityBinding = featureTemplate.match(/\bwx:if="{{(\w+)}}"/)?.[1]
  assert.ok(visibilityBinding, 'compiler must bind the native conditional branch')
  assert.equal(component.host.data[visibilityBinding], true)
  assert.ok(values(component.host.data).includes('4'), 'initial computed render')
  form.price = 3; form.price = 4
  form.rows = [{ id: 'b', label: 'row-b' }, { id: 'a', label: 'row-a' }]
  await flush()
  assert.ok(values(component.host.data).includes('8'), 'nested prop mutation invalidates computed and MP render effect')
  assert.equal(audit.filter(row => row[0] === 'watch').length, 1, 'same-tick watch is batched')
  assert.equal(audit.find(row => row[0] === 'watch')[1], 4)
  assert.ok(values(component.host.data).includes('row-b'), 'keyed list update reaches setData')
  form.price = 5; form.visible = false
  await flush()
  assert.equal(component.host.data[visibilityBinding], false, 'native branch binding follows reactive state')
  assert.ok(audit.some(row => row[0] === 'cleanup' && row[1] === 4), 'watch invalidation cleanup runs')
  component.destroy()
  await flush()
  const writesAtUnmount = component.writes.length
  const auditsAtUnmount = audit.length
  assert.equal(audit.filter(row => row[0] === 'unmounted').length, 1)
  assert.equal(audit.filter(row => row[0] === 'disposed').length, 1)
  assert.ok(audit.some(row => row[0] === 'cleanup' && row[1] === 5), 'unmount runs final watcher cleanup')
  form.price = 9; form.rows.push({ id: 'c', label: 'row-c' }); form.visible = true
  await flush()
  assert.equal(component.writes.length, writesAtUnmount, 'destroyed component no longer renders')
  assert.equal(audit.length, auditsAtUnmount, 'destroyed watcher stays stopped')
  assert.deepEqual(errors, [], 'no swallowed runtime/compiler integration errors')
  assert.ok(emitted.size >= 2, 'actual MP compiler emitted native templates')
})
