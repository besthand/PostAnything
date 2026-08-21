import { z } from 'zod'

const SUPPORTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

const boolString = z.enum(['true', 'false']).transform((v) => v === 'true')

const intString = (fallback: number, min: number, max: number) =>
  z
    .string()
    .default(String(fallback))
    .refine((v) => /^\d+$/.test(v), '必須是非負整數')
    .transform((v) => Number(v))
    .refine((v) => v >= min && v <= max, `必須介於 ${min} 與 ${max} 之間`)

const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

const schema = z.object({
  RELAY_TOKEN: z
    .string({ required_error: 'RELAY_TOKEN 為必填' })
    .min(32, 'RELAY_TOKEN 長度至少 32 字元（建議 256-bit 亂數）'),
  ALLOWED_METHODS: z
    .string()
    .default('GET,POST,PUT,PATCH,DELETE')
    .transform((v) => csv(v).map((m) => m.toUpperCase()))
    .superRefine((methods, ctx) => {
      for (const m of methods) {
        if (!(SUPPORTED_METHODS as readonly string[]).includes(m)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `不支援的 HTTP method：${m}` })
        }
      }
    }),
  ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((v) => csv(v).map((h) => h.toLowerCase())),
  ALLOW_ANY_PUBLIC_HOST: boolString.default('false'),
  ALLOW_HTTP: boolString.default('false'),
  MAX_REQUEST_BODY_BYTES: intString(2097152, 1, 100 * 1024 * 1024),
  MAX_RESPONSE_BODY_BYTES: intString(5242880, 1, 100 * 1024 * 1024),
  REQUEST_TIMEOUT_MS: intString(30000, 1, 300000),
  FOLLOW_REDIRECTS: boolString.default('false'),
  RATE_LIMIT_MAX: intString(30, 1, 100000),
  RATE_LIMIT_WINDOW_MS: intString(60000, 1000, 3600000),
  PORT: intString(3000, 1, 65535),
  DOH_ENDPOINT: z.string().url().default('https://cloudflare-dns.com/dns-query'),
})

export interface Config {
  relayToken: string
  allowedMethods: string[]
  allowedHosts: string[]
  allowAnyPublicHost: boolean
  allowHttp: boolean
  maxRequestBodyBytes: number
  maxResponseBodyBytes: number
  requestTimeoutMs: number
  followRedirects: boolean
  rateLimitMax: number
  rateLimitWindowMs: number
  port: number
  dohEndpoint: string
}

/**
 * 解析環境變數。錯誤訊息只會提到欄位名稱與規則，絕不含 RELAY_TOKEN 的值，
 * 以免 secret 洩漏到 log 或 error stack。
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const input: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') input[key] = value
  }

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`設定錯誤 — ${summary}`)
  }

  const v = parsed.data
  return {
    relayToken: v.RELAY_TOKEN,
    allowedMethods: v.ALLOWED_METHODS,
    allowedHosts: v.ALLOWED_HOSTS,
    allowAnyPublicHost: v.ALLOW_ANY_PUBLIC_HOST,
    allowHttp: v.ALLOW_HTTP,
    maxRequestBodyBytes: v.MAX_REQUEST_BODY_BYTES,
    maxResponseBodyBytes: v.MAX_RESPONSE_BODY_BYTES,
    requestTimeoutMs: v.REQUEST_TIMEOUT_MS,
    followRedirects: v.FOLLOW_REDIRECTS,
    rateLimitMax: v.RATE_LIMIT_MAX,
    rateLimitWindowMs: v.RATE_LIMIT_WINDOW_MS,
    port: v.PORT,
    dohEndpoint: v.DOH_ENDPOINT,
  }
}
