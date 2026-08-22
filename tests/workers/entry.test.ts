import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import worker from '../../src/adapters/workers/entry.js'

const TOKEN = 'relay_wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww'

describe('Workers entry', () => {
  it('/health 在 workerd 上正常回應', async () => {
    const res = await worker.fetch(new Request('https://relay.test/health'), env as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('/api/relay 沒帶 token 回 401', async () => {
    const res = await worker.fetch(
      new Request('https://relay.test/api/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'GET', url: 'https://example.com/' }),
      }),
      env as never,
    )
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('INVALID_RELAY_TOKEN')
  })

  it('/api/relay 帶正確 token 但目標 host 不在 allowlist → 403', async () => {
    const res = await worker.fetch(
      new Request('https://relay.test/api/relay', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ method: 'GET', url: 'https://evil.test/' }),
      }),
      env as never,
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('HOST_NOT_ALLOWED')
  })

  it('/api/echo 在 workerd 上回音', async () => {
    const res = await worker.fetch(
      new Request('https://relay.test/api/echo?a=1', {
        method: 'POST',
        headers: { 'x-probe': 'p' },
        body: 'hello',
      }),
      env as never,
    )
    const json = await res.json()
    expect(json).toMatchObject({ method: 'POST', query: { a: '1' }, body: 'hello' })
    expect(json.headers['x-probe']).toBe('p')
  })
})
