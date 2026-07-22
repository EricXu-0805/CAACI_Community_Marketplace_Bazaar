/**
 * Allocate a UUID before sending a chat message so every retry of that
 * logical send can reuse the database primary key. Web runtimes use
 * cryptographic randomness when available; the fallback preserves the UUID v4
 * shape for older mini-program engines where Web Crypto is absent.
 */
export function createClientMessageId(): string {
  const bytes = new Uint8Array(16)
  const cryptoApi = (globalThis as any)?.crypto
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}
