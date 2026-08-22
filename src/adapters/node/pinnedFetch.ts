import { Agent, request as undiciRequest } from 'undici'
import { RelayError } from '../../core/errors.js'
import type { HttpClient, OutboundRequest, OutboundResponse } from '../../core/relay.js'

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void

/**
 * 把 DNS 解析結果釘死在已驗證的 IP 上。
 * 若不這麼做，攻擊者可以在「SSRF 檢查」與「實際連線」之間
 * 換掉 DNS 回應（DNS rebinding / TOCTOU），繞過整個防護。
 */
const pinnedLookup =
  (ip: string) =>
  (_hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    const family = ip.includes(':') ? 6 : 4
    if (options?.all) {
      callback(null, [{ address: ip, family }])
      return
    }
    callback(null, ip, family)
  }

export function createPinnedHttpClient(): HttpClient {
  return {
    async send(request: OutboundRequest): Promise<OutboundResponse> {
      const pinnedIp = request.resolvedIps[0]
      if (pinnedIp === undefined) {
        throw new RelayError('DNS_LOOKUP_FAILED', 'No validated IP address to connect to.')
      }

      const agent = new Agent({
        connect: { lookup: pinnedLookup(pinnedIp) as never },
        headersTimeout: request.timeoutMs,
        bodyTimeout: request.timeoutMs,
      })

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), request.timeoutMs)

      try {
        // undici 7 的 request() 本身不 follow redirect（需另外掛 redirect interceptor
        // 才會跟隨）；FOLLOW_REDIRECTS 預設就是 false，故此處不需要額外處理 3xx。
        const response = await undiciRequest(request.url, {
          method: request.method as never,
          headers: request.headers,
          body: request.body,
          dispatcher: agent,
          signal: controller.signal,
        })

        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '')
        }

        // 邊讀邊算大小，超過就立刻中止，不把整包吞進記憶體
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of response.body) {
          const buf = Buffer.from(chunk)
          total += buf.length
          if (total > request.maxResponseBytes) {
            controller.abort()
            throw new RelayError(
              'RESPONSE_TOO_LARGE',
              `Response exceeds the ${request.maxResponseBytes} byte limit.`,
            )
          }
          chunks.push(buf)
        }

        return {
          status: response.statusCode,
          statusText: STATUS_TEXT[response.statusCode] ?? '',
          headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }
      } catch (err) {
        if (err instanceof RelayError) throw err
        if (isAbortError(err)) {
          throw new RelayError(
            'TARGET_TIMEOUT',
            `The target server did not respond within ${request.timeoutMs} ms.`,
          )
        }
        throw new RelayError('TARGET_CONNECTION_FAILED', 'Failed to connect to the target server.')
      } finally {
        clearTimeout(timer)
        await agent.close().catch(() => undefined)
      }
    },
  }
}

const isAbortError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { name?: string; code?: string }
  return (
    e.name === 'AbortError' ||
    e.code === 'UND_ERR_ABORTED' ||
    e.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    e.code === 'UND_ERR_BODY_TIMEOUT'
  )
}

/** undici 只給 statusCode，statusText 自行補上讓 Agent 好判讀。 */
const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}
