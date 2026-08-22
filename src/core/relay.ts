import { assertAuthenticated } from './auth.js'
import type { Config } from './config.js'
import { RelayError } from './errors.js'
import { assertHeadersAllowed, sanitizeHeaders } from './headers.js'
import type { Logger, RelayLogFields } from './logger.js'
import type { RateLimiter } from './rateLimiter.js'
import { isPublicIp, parseIpv4, parseIpv6 } from './ssrf/ipRules.js'
import { isHostAllowed, normalizeHostname } from './ssrf/hostAllowlist.js'
import { applyQuery, buildBody, parsePayload } from './validation.js'

export interface DnsResolver {
  resolve(hostname: string): Promise<string[]>
}

export interface OutboundRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: string | undefined
  resolvedIps: string[]
  timeoutMs: number
  maxResponseBytes: number
  followRedirects: boolean
}

export interface OutboundResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export interface HttpClient {
  send(request: OutboundRequest): Promise<OutboundResponse>
}

export interface RelayDeps {
  config: Config
  resolver: DnsResolver
  httpClient: HttpClient
  rateLimiter: RateLimiter
  logger: Logger
  now?: () => number
}

export interface RelayInput {
  authorization: string | undefined | null
  payload: unknown
  /** rate limit 的分組鍵，通常是 client IP */
  clientKey: string
  requestId: string
}

export interface RelaySuccessBody {
  success: true
  requestId: string
  request: { method: string; url: string }
  response: OutboundResponse
}

const encoder = new TextEncoder()

/** hostname 本身就是 IP literal 時不需要（也不能）走 DNS。 */
const asIpLiteral = (hostname: string): string | null => {
  const host = normalizeHostname(hostname)
  if (parseIpv4(host) !== null) return host
  if (parseIpv6(host) !== null) return host
  return null
}

/**
 * requirement.md §51 的 13 步驟依序執行。順序本身就是安全設計：
 * 認證失敗不該觸發 DNS 查詢，host 不合法不該對外連線。
 */
export async function handleRelay(input: RelayInput, deps: RelayDeps): Promise<RelaySuccessBody> {
  const { config, logger } = deps
  const startedAt = (deps.now ?? (() => Date.now()))()

  const writeLog = (fields: Omit<RelayLogFields, 'requestId' | 'durationMs'>): void => {
    logger.log({
      ...fields,
      requestId: input.requestId,
      durationMs: (deps.now ?? (() => Date.now()))() - startedAt,
    })
  }

  // 0. Rate limit（defense-in-depth，主防線在平台層）
  const limit = await deps.rateLimiter.consume(input.clientKey)
  if (!limit.allowed) {
    throw new RelayError('RATE_LIMITED', 'Too many relay requests. Please retry later.')
  }

  // 1. Authentication
  assertAuthenticated(input.authorization, config.relayToken)

  // 2. Payload Schema Validation
  const payload = parsePayload(input.payload)

  // 3. Method Validation
  if (!config.allowedMethods.includes(payload.method)) {
    throw new RelayError('METHOD_NOT_ALLOWED', `HTTP method "${payload.method}" is not allowed.`)
  }

  // 4. Parse URL
  let url: URL
  try {
    url = new URL(payload.url)
  } catch {
    throw new RelayError('INVALID_URL', 'Target URL could not be parsed.')
  }

  // 5. Protocol Validation
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RelayError('INVALID_URL', `Protocol "${url.protocol}" is not allowed.`)
  }
  if (url.protocol === 'http:' && !config.allowHttp) {
    throw new RelayError('INVALID_URL', 'Plain http:// is disabled. Set ALLOW_HTTP=true to enable it.')
  }

  const host = normalizeHostname(url.hostname)
  const logBase = { method: payload.method, host, path: url.pathname }

  try {
    // 6. Host Allowlist
    if (!isHostAllowed(host, config.allowedHosts, config.allowAnyPublicHost)) {
      throw new RelayError('HOST_NOT_ALLOWED', `Host "${host}" is not in the allowlist.`)
    }

    // 7. DNS Resolution
    const literal = asIpLiteral(host)
    let resolvedIps: string[]
    if (literal !== null) {
      resolvedIps = [literal]
    } else {
      try {
        resolvedIps = await deps.resolver.resolve(host)
      } catch {
        throw new RelayError('DNS_LOOKUP_FAILED', `DNS lookup failed for "${host}".`)
      }
      if (resolvedIps.length === 0) {
        throw new RelayError('DNS_LOOKUP_FAILED', `DNS lookup returned no records for "${host}".`)
      }
    }

    // 8. SSRF Validation — 所有候選 IP 都必須通過
    for (const ip of resolvedIps) {
      if (!isPublicIp(ip)) {
        throw new RelayError('SSRF_BLOCKED', `Host "${host}" resolves to a blocked address.`)
      }
    }

    // 9. Header Filtering
    assertHeadersAllowed(payload.headers)
    const headers = sanitizeHeaders(payload.headers)

    // 10. Body Size Validation
    const built = buildBody(payload)
    if (built.body !== undefined) {
      const size = encoder.encode(built.body).length
      if (size > config.maxRequestBodyBytes) {
        throw new RelayError(
          'REQUEST_TOO_LARGE',
          `Request body is ${size} bytes, over the ${config.maxRequestBodyBytes} byte limit.`,
        )
      }
    }
    if (built.defaultContentType && headers['content-type'] === undefined) {
      headers['content-type'] = built.defaultContentType
    }

    const targetUrl = applyQuery(url, payload.query)

    // 11. Send HTTP Request（12. Response Size Validation 由 httpClient 邊讀邊檢查）
    let response: OutboundResponse
    try {
      response = await deps.httpClient.send({
        method: payload.method,
        url: targetUrl.toString(),
        headers,
        body: built.body,
        resolvedIps,
        timeoutMs: config.requestTimeoutMs,
        maxResponseBytes: config.maxResponseBodyBytes,
        followRedirects: config.followRedirects,
      })
    } catch (err) {
      if (err instanceof RelayError) throw err
      throw new RelayError('TARGET_CONNECTION_FAILED', 'Failed to connect to the target server.')
    }

    // 13. Return Response — Target 的狀態碼一律視為 Relay 成功
    writeLog({
      ...logBase,
      status: response.status,
      result: 'success',
      headerNames: Object.keys(headers),
    })

    return {
      success: true,
      requestId: input.requestId,
      request: { method: payload.method, url: targetUrl.toString() },
      response,
    }
  } catch (err) {
    writeLog({
      ...logBase,
      result: 'error',
      errorCode: err instanceof RelayError ? err.code : 'INTERNAL_ERROR',
    })
    throw err
  }
}
