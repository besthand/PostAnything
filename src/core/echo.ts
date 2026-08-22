import { stripBlockedHeaders } from './headers.js'

export interface EchoResult {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body: string
  receivedAt: string
}

/**
 * 把收到的請求原樣回音，讓 Agent 可以對照 Relay Page 上填的內容
 * 是否真的送達目標（design §6）。
 */
export async function buildEcho(
  request: Request,
  now: () => Date = () => new Date(),
): Promise<EchoResult> {
  const url = new URL(request.url)

  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams) query[key] = value

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const body = request.body === null ? '' : await request.text()

  return {
    method: request.method,
    path: url.pathname,
    query,
    headers: stripBlockedHeaders(headers),
    body,
    receivedAt: now().toISOString(),
  }
}
