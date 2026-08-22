import { describe, it, expect } from 'vitest'
import { createApp } from '../src/core/app.js'
import { loadConfig } from '../src/core/config.js'
import { InMemoryRateLimiter } from '../src/core/rateLimiter.js'
import { createLogger } from '../src/core/logger.js'

const deps = () => ({
  config: loadConfig({ RELAY_TOKEN: 'relay_' + 's'.repeat(40) }),
  resolver: { resolve: async () => ['93.184.216.34'] },
  httpClient: { send: async () => ({ status: 200, statusText: 'OK', headers: {}, body: '' }) },
  rateLimiter: new InMemoryRateLimiter({ max: 100, windowMs: 60_000 }),
  logger: createLogger(() => undefined),
})

describe('staticMiddleware 掛載點', () => {
  it('API 路由優先於靜態檔 middleware', async () => {
    const app = createApp({
      ...deps(),
      staticMiddleware: async (c) => c.text('STATIC'),
    })
    expect(await (await app.request('/health')).json()).toEqual({ status: 'ok' })
  })

  it('非 API 路徑交給靜態檔 middleware，且仍套用安全 header', async () => {
    const app = createApp({
      ...deps(),
      staticMiddleware: async (c) => c.html('<h1>relay</h1>'),
    })
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('<h1>relay</h1>')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
  })

  it('沒提供 staticMiddleware 時維持 404 JSON', async () => {
    const app = createApp(deps())
    expect((await app.request('/')).status).toBe(404)
  })
})
