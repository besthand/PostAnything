import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/core/config.js'

const base = { RELAY_TOKEN: 'relay_' + 'a'.repeat(40) }

describe('loadConfig', () => {
  it('套用預設值', () => {
    const c = loadConfig(base)
    expect(c.allowedMethods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    expect(c.allowedHosts).toEqual([])
    expect(c.allowAnyPublicHost).toBe(false)
    expect(c.allowHttp).toBe(false)
    expect(c.maxRequestBodyBytes).toBe(2097152)
    expect(c.maxResponseBodyBytes).toBe(5242880)
    expect(c.requestTimeoutMs).toBe(30000)
    expect(c.followRedirects).toBe(false)
    expect(c.rateLimitMax).toBe(30)
    expect(c.rateLimitWindowMs).toBe(60000)
    expect(c.port).toBe(3000)
  })

  it('RELAY_TOKEN 缺少或過短時丟出錯誤', () => {
    expect(() => loadConfig({})).toThrow(/RELAY_TOKEN/)
    expect(() => loadConfig({ RELAY_TOKEN: 'short' })).toThrow(/RELAY_TOKEN/)
  })

  it('錯誤訊息不含 token 內容', () => {
    const secret = 'relay_' + 'b'.repeat(40)
    try {
      loadConfig({ RELAY_TOKEN: secret, ALLOWED_METHODS: 'GET,TRACE' })
      expect.unreachable('should throw')
    } catch (err) {
      expect(String(err)).not.toContain(secret)
    }
  })

  it('normalize method 為大寫、host 為小寫並去掉空白', () => {
    const c = loadConfig({
      ...base,
      ALLOWED_METHODS: ' get , post ',
      ALLOWED_HOSTS: ' Example.COM , api.test.tw ',
    })
    expect(c.allowedMethods).toEqual(['GET', 'POST'])
    expect(c.allowedHosts).toEqual(['example.com', 'api.test.tw'])
  })

  it('拒絕不在 HTTP method 白名單內的值', () => {
    expect(() => loadConfig({ ...base, ALLOWED_METHODS: 'GET,TRACE' })).toThrow(/TRACE/)
  })

  it('布林值只接受 true/false 字串', () => {
    expect(loadConfig({ ...base, ALLOW_HTTP: 'true' }).allowHttp).toBe(true)
    expect(loadConfig({ ...base, ALLOW_HTTP: 'false' }).allowHttp).toBe(false)
    expect(() => loadConfig({ ...base, ALLOW_HTTP: 'yes' })).toThrow()
  })
})
