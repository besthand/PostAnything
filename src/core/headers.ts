import { RelayError } from './errors.js'

/** requirement.md §14 的禁用清單，全小寫比對。 */
export const BLOCKED_HEADERS: readonly string[] = [
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]

/** 基礎設施 header，避免使用者偽造上游身分。 */
export const BLOCKED_HEADER_PREFIXES: readonly string[] = ['cf-', 'x-vercel-', 'x-aws-']

const SENSITIVE_HEADERS: readonly string[] = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
]

/** RFC 7230 token 字元集。 */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function isBlockedHeader(name: string): boolean {
  const lower = name.trim().toLowerCase()
  if (BLOCKED_HEADERS.includes(lower)) return true
  return BLOCKED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name.trim().toLowerCase()] = value.trim()
  }
  return out
}

export function assertHeadersAllowed(headers: Record<string, string>): void {
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim().toLowerCase()

    if (!HEADER_NAME_RE.test(name)) {
      throw new RelayError('INVALID_HEADER', `Header name is not a valid HTTP token.`)
    }
    if (isBlockedHeader(name)) {
      throw new RelayError('INVALID_HEADER', `Header "${name}" is not allowed.`)
    }
    if (/[\r\n]/.test(rawValue)) {
      throw new RelayError('INVALID_HEADER', `Header "${name}" contains a line break.`)
    }
  }
}

export function stripBlockedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(sanitizeHeaders(headers))) {
    if (!isBlockedHeader(name)) out[name] = value
  }
  return out
}

export function maskSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(sanitizeHeaders(headers))) {
    out[name] = SENSITIVE_HEADERS.includes(name) ? '********' : value
  }
  return out
}
