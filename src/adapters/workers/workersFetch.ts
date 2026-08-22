import { RelayError } from '../../core/errors.js'
import type { HttpClient, OutboundRequest, OutboundResponse } from '../../core/relay.js'

/**
 * Workers 只能用平台原生 fetch，無法指定連線 IP。
 * SSRF 保護在此為 best-effort：core/relay.ts 已用 DoH 驗過所有解析結果，
 * 但驗證與連線之間仍有 TOCTOU 空隙（DNS rebinding）。
 */
export function createWorkersHttpClient(fetchImpl: typeof fetch = fetch): HttpClient {
  return {
    async send(request: OutboundRequest): Promise<OutboundResponse> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), request.timeoutMs)

      try {
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: request.followRedirects ? 'follow' : 'manual',
          signal: controller.signal,
        })

        const headers: Record<string, string> = {}
        response.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value
        })

        const body = await readLimited(response, request.maxResponseBytes)

        return {
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
        }
      } catch (err) {
        if (err instanceof RelayError) throw err
        if ((err as { name?: string }).name === 'AbortError') {
          throw new RelayError(
            'TARGET_TIMEOUT',
            `The target server did not respond within ${request.timeoutMs} ms.`,
          )
        }
        throw new RelayError('TARGET_CONNECTION_FAILED', 'Failed to connect to the target server.')
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** 邊讀邊算 byte 數，超過上限立刻中止並丟 RESPONSE_TOO_LARGE。 */
const readLimited = async (response: Response, maxBytes: number): Promise<string> => {
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value === undefined) continue

    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new RelayError('RESPONSE_TOO_LARGE', `Response exceeds the ${maxBytes} byte limit.`)
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}
