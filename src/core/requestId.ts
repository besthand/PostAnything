const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

const defaultRandomBytes = (n: number): Uint8Array => {
  const bytes = new Uint8Array(n)
  // globalThis.crypto 在 Node 20+ 與 Cloudflare Workers 都存在
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/**
 * 產生 `req_<時間戳><亂數>` 形式的請求 ID。
 * 不需要資料庫，也不必全域唯一 — 只要能在 log 裡對得上就夠了。
 */
export function newRequestId(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  const stamp = Date.now().toString(36)
  const random = Array.from(randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('')
  return `req_${stamp}${random}`
}
