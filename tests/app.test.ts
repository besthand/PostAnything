import { describe, it, expect } from 'vitest'
import { createApp } from '../src/core/app.js'
import { loadConfig } from '../src/core/config.js'
import { InMemoryRateLimiter } from '../src/core/rateLimiter.js'
import { createLogger } from '../src/core/logger.js'
import type { AppDeps } from '../src/core/app.js'

const TOKEN = 'relay_' + 'w'.repeat(40)

const makeApp = (env: Record<string, string> = {}) => {
  const lines: string[] = []
  const deps: AppDeps = {
    config: loadConfig({ RELAY_TOKEN: TOKEN, ALLOWED_HOSTS: 'example.com', ...env }),
    resolver: { resolve: async () => ['93.184.216.34'] },
    httpClient: {
      send: async () => ({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      }),
    },
    rateLimiter: new InMemoryRateLimiter({ max: 1000, windowMs: 60_000 }),
    logger: createLogger((line) => lines.push(line)),
    generateRequestId: () => 'req_fixed',
  }
  return { app: createApp(deps), lines }
}

describe('GET /health', () => {
  it('不需 token，只回最低限度資訊', async () => {
    const { app } = makeApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('不外洩 allowlist 或設定', async () => {
    const { app } = makeApp()
    const text = await (await app.request('/health')).text()
    expect(text).not.toContain('example.com')
    expect(text).not.toContain(TOKEN)
  })
})

describe('POST /api/relay', () => {
  const send = (body: unknown, token: string | null = TOKEN) =>
    makeApp().app.request('/api/relay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })

  it('成功時回標準格式與 requestId', async () => {
    const res = await send({ method: 'GET', url: 'https://example.com/api' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      requestId: 'req_fixed',
      response: { status: 200 },
    })
  })

  it('缺 token 回 401 與 INVALID_RELAY_TOKEN', async () => {
    const res = await send({ method: 'GET', url: 'https://example.com/api' }, null)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      success: false,
      requestId: 'req_fixed',
      error: { code: 'INVALID_RELAY_TOKEN', message: 'Relay authentication failed.' },
    })
  })

  it('body 不是合法 JSON 回 400 INVALID_JSON', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{not json',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('INVALID_JSON')
  })

  it('SSRF 被擋時回 403', async () => {
    const res = await send({ method: 'GET', url: 'https://example.com.attacker.com/' })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('HOST_NOT_ALLOWED')
  })

  it('body 超過上限時回 413', async () => {
    const { app } = makeApp({ MAX_REQUEST_BODY_BYTES: '10' })
    const res = await app.request('/api/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        method: 'POST',
        url: 'https://example.com/a',
        bodyType: 'raw',
        body: 'x'.repeat(500),
      }),
    })
    expect(res.status).toBe(413)
    expect((await res.json()).error.code).toBe('REQUEST_TOO_LARGE')
  })

  it('回應帶 X-Request-Id header', async () => {
    const res = await send({ method: 'GET', url: 'https://example.com/api' })
    expect(res.headers.get('x-request-id')).toBe('req_fixed')
  })
})

describe('ALL /api/echo', () => {
  it('不需 token 就能呼叫，回音收到的內容', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/echo?source=agent', {
      method: 'POST',
      headers: { 'x-api-key': 'k1', 'content-type': 'application/json' },
      body: '{"title":"Hello"}',
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({
      method: 'POST',
      path: '/api/echo',
      query: { source: 'agent' },
      body: '{"title":"Hello"}',
    })
    expect(json.headers['x-api-key']).toBe('k1')
  })

  it('GET 也可以', async () => {
    const { app } = makeApp()
    const res = await app.request('/api/echo')
    expect(res.status).toBe(200)
    expect((await res.json()).method).toBe('GET')
  })
})

describe('安全 header', () => {
  it('所有回應都帶嚴格 CSP 與 nosniff', async () => {
    const { app } = makeApp()
    const res = await app.request('/health')
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).not.toContain('unsafe-inline')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })
})

describe('未知路由', () => {
  it('回 404 JSON', async () => {
    const { app } = makeApp()
    const res = await app.request('/admin')
    expect(res.status).toBe(404)
  })
})
