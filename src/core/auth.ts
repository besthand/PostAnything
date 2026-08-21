import { RelayError } from './errors.js'

const encoder = new TextEncoder()

/**
 * 常數時間字串比對。不用 node:crypto 的 timingSafeEqual，
 * 因為 core 必須能在 Cloudflare Workers 上執行。
 * 長度不同時仍走完整個迴圈，避免以長度做 early return。
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = encoder.encode(a)
  const bb = encoder.encode(b)
  const length = Math.max(ab.length, bb.length)

  let diff = ab.length ^ bb.length
  for (let i = 0; i < length; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

const AUTH_FAILED = 'Relay authentication failed.'

export function assertAuthenticated(
  authorizationHeader: string | undefined | null,
  relayToken: string,
): void {
  if (!authorizationHeader) throw new RelayError('INVALID_RELAY_TOKEN', AUTH_FAILED)

  const match = /^bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  if (!match) throw new RelayError('INVALID_RELAY_TOKEN', AUTH_FAILED)

  const presented = match[1] as string
  if (!timingSafeEqualString(presented, relayToken)) {
    throw new RelayError('INVALID_RELAY_TOKEN', AUTH_FAILED)
  }
}
