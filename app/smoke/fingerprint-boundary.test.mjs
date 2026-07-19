import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fingerprintPath = resolve(appRoot, 'src/utils/fingerprint.ts')
const fingerprintSource = readFileSync(fingerprintPath, 'utf8')

function compileFingerprintModule() {
  const compiled = ts.transpileModule(fingerprintSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${Math.random()}`)
}

function installGlobals({ cryptoApi, storage }) {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const uniDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'uni')
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: cryptoApi })
  Object.defineProperty(globalThis, 'uni', {
    configurable: true,
    value: {
      getStorageSync: key => storage.get(key) ?? '',
      setStorageSync: (key, value) => { storage.set(key, value) },
      getSystemInfoSync: () => ({
        platform: 'test',
        osVersion: '1',
        brand: 'test',
        model: 'test',
        language: 'en',
        screenWidth: 1024,
        screenHeight: 768,
      }),
    },
  })
  return () => {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
    else delete globalThis.crypto
    if (uniDescriptor) Object.defineProperty(globalThis, 'uni', uniDescriptor)
    else delete globalThis.uni
  }
}

function deterministicCrypto({ withRandom = true, withDigest = true } = {}) {
  return {
    ...(withRandom ? {
      getRandomValues(bytes) {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1
        return bytes
      },
    } : {}),
    ...(withDigest ? {
      subtle: {
        async digest(name, input) {
          assert.equal(name, 'SHA-256')
          const { createHash } = await import('node:crypto')
          return createHash('sha256').update(Buffer.from(input)).digest()
        },
      },
    } : {}),
  }
}

test('fingerprint is stable 64-char SHA-256 only with secure random and durable storage', async () => {
  const storage = new Map()
  const restore = installGlobals({ cryptoApi: deterministicCrypto(), storage })
  try {
    const module = await compileFingerprintModule()
    const first = await module.deviceFingerprintHash()
    const second = await module.deviceFingerprintHash()
    assert.match(first, /^[0-9a-f]{64}$/)
    assert.equal(second, first)
    assert.match(storage.get('device_salt_v1'), /^[0-9a-f]{32}$/)
  } finally {
    restore()
  }
})

test('fingerprint fails closed when cryptographic randomness is unavailable', async () => {
  const storage = new Map()
  const restore = installGlobals({
    cryptoApi: deterministicCrypto({ withRandom: false }),
    storage,
  })
  try {
    const module = await compileFingerprintModule()
    assert.equal(await module.deviceFingerprintHash(), null)
    assert.equal(storage.has('device_salt_v1'), false)
  } finally {
    restore()
  }
})

test('fingerprint fails closed when the storage write is not durable', async () => {
  const storage = new Map()
  const restore = installGlobals({ cryptoApi: deterministicCrypto(), storage })
  const originalSet = globalThis.uni.setStorageSync
  globalThis.uni.setStorageSync = () => {}
  try {
    const module = await compileFingerprintModule()
    assert.equal(await module.deviceFingerprintHash(), null)
  } finally {
    globalThis.uni.setStorageSync = originalSet
    restore()
  }
})

test('fingerprint fails closed when SHA-256 is unavailable', async () => {
  const storage = new Map()
  const restore = installGlobals({
    cryptoApi: deterministicCrypto({ withDigest: false }),
    storage,
  })
  try {
    const module = await compileFingerprintModule()
    assert.equal(await module.deviceFingerprintHash(), null)
  } finally {
    restore()
  }
})

test('source contains no weak collision-prone fallback or shared nosalt identity', () => {
  assert.doesNotMatch(fingerprintSource, /Math\.random\s*\(/)
  assert.doesNotMatch(fingerprintSource, /fnv1a/i)
  assert.doesNotMatch(fingerprintSource, /['"]nosalt['"]/);
})
