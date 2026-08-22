import { describe, it, expect } from 'vitest'
import { createRelayApp } from '../../src/adapters/vercel/handler.js'

const TOKEN = 'relay_' + 'v'.repeat(40)

describe('createRelayApp', () => {
  it('用傳入的 env 建立 app（不讀 process.env）', async () => {
    const app = createRelayApp({ RELAY_TOKEN: TOKEN, ALLOWED_HOSTS: 'example.com' })
    const res = await app.request('/health')
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('/api/relay 走完整驗證流程', async () => {
    const app = createRelayApp({ RELAY_TOKEN: TOKEN, ALLOWED_HOSTS: 'example.com' })
    const res = await app.request('/api/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'GET', url: 'https://example.com/' }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('INVALID_RELAY_TOKEN')
  })

  it('/api/echo 不需 token', async () => {
    const app = createRelayApp({ RELAY_TOKEN: TOKEN })
    const res = await app.request('/api/echo?a=1')
    expect(res.status).toBe(200)
    expect((await res.json()).query).toEqual({ a: '1' })
  })

  it('設定錯誤時丟出可辨識的錯誤', () => {
    expect(() => createRelayApp({})).toThrow(/RELAY_TOKEN/)
  })
})
