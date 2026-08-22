import { describe, it, expect } from 'vitest'
import { buildEcho } from '../src/core/echo.js'

const fixedNow = () => new Date('2026-08-21T23:00:00.000Z')

describe('buildEcho', () => {
  it('回音 method、path、query、body 與時間', async () => {
    const req = new Request('https://relay.example.com/api/echo?source=agent&type=article', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title":"Hello"}',
    })
    expect(await buildEcho(req, fixedNow)).toEqual({
      method: 'POST',
      path: '/api/echo',
      query: { source: 'agent', type: 'article' },
      headers: { 'content-type': 'application/json' },
      body: '{"title":"Hello"}',
      receivedAt: '2026-08-21T23:00:00.000Z',
    })
  })

  it('沒有 body 時回空字串', async () => {
    const result = await buildEcho(new Request('https://r.tw/api/echo'), fixedNow)
    expect(result.method).toBe('GET')
    expect(result.body).toBe('')
    expect(result.query).toEqual({})
  })

  it('移除黑名單 header 但保留自訂 header', async () => {
    const req = new Request('https://r.tw/api/echo', {
      headers: {
        'x-api-key': 'k123',
        authorization: 'Bearer target_token',
        'x-forwarded-for': '1.2.3.4',
      },
    })
    const result = await buildEcho(req, fixedNow)
    expect(result.headers['x-api-key']).toBe('k123')
    expect(result.headers['authorization']).toBe('Bearer target_token')
    expect(result.headers).not.toHaveProperty('x-forwarded-for')
    expect(result.headers).not.toHaveProperty('host')
  })

  it('重複的 query key 取最後一個', async () => {
    const result = await buildEcho(new Request('https://r.tw/api/echo?a=1&a=2'), fixedNow)
    expect(result.query).toEqual({ a: '2' })
  })
})
