import { z } from 'zod'
import { RelayError } from './errors.js'

export type BodyType = 'none' | 'json' | 'raw' | 'form'

const stringRecord = z.record(z.string(), z.string())

const payloadSchema = z.object({
  method: z.string().min(1).transform((v) => v.trim().toUpperCase()),
  url: z.string().min(1),
  query: stringRecord.default({}),
  headers: stringRecord.default({}),
  bodyType: z.enum(['none', 'json', 'raw', 'form']).default('none'),
  body: z.unknown().optional(),
})

export interface RelayPayload {
  method: string
  url: string
  query: Record<string, string>
  headers: Record<string, string>
  bodyType: BodyType
  body: unknown
}

/** 解析 /api/relay 的 JSON payload。任何 schema 問題都回 INVALID_JSON。 */
export function parsePayload(input: unknown): RelayPayload {
  const parsed = payloadSchema.safeParse(input)
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new RelayError('INVALID_JSON', `Request payload is invalid — ${summary}`)
  }
  return { ...parsed.data, body: parsed.data.body } as RelayPayload
}

export interface BuiltBody {
  body: string | undefined
  defaultContentType: string | undefined
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 把 payload 的 body 轉成要送出的字串，並算出「使用者沒指定 Content-Type 時」
 * 應該補上的預設值（requirement.md §16 §17 §18）。
 */
export function buildBody(payload: RelayPayload): BuiltBody {
  switch (payload.bodyType) {
    case 'none':
      return { body: undefined, defaultContentType: undefined }

    case 'json': {
      if (typeof payload.body === 'string') {
        try {
          JSON.parse(payload.body)
        } catch {
          throw new RelayError('INVALID_JSON', 'Request body is not valid JSON.')
        }
        return { body: payload.body, defaultContentType: 'application/json' }
      }
      if (payload.body === undefined) {
        throw new RelayError('INVALID_JSON', 'bodyType is "json" but no body was provided.')
      }
      return { body: JSON.stringify(payload.body), defaultContentType: 'application/json' }
    }

    case 'raw': {
      if (typeof payload.body !== 'string') {
        throw new RelayError('INVALID_JSON', 'bodyType is "raw" but body is not a string.')
      }
      return { body: payload.body, defaultContentType: undefined }
    }

    case 'form': {
      if (!isPlainObject(payload.body)) {
        throw new RelayError(
          'INVALID_JSON',
          'bodyType is "form" but body is not an object of string key/value pairs.',
        )
      }
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(payload.body)) {
        if (typeof value !== 'string') {
          throw new RelayError('INVALID_JSON', `Form field "${key}" must be a string.`)
        }
        params.append(key, value)
      }
      return { body: params.toString(), defaultContentType: 'application/x-www-form-urlencoded' }
    }
  }
}

/** 由 Backend 負責 URL encoding，Agent 只填原始文字（requirement.md §12）。 */
export function applyQuery(url: URL, query: Record<string, string>): URL {
  const next = new URL(url.toString())
  for (const [key, value] of Object.entries(query)) {
    next.searchParams.append(key, value)
  }
  return next
}
