import { describe, it, expect, vi } from 'vitest'
import { handleRelay } from '../src/core/relay.js'
import type { DnsResolver, HttpClient, OutboundRequest, RelayDeps } from '../src/core/relay.js'
import { loadConfig } from '../src/core/config.js'
import { RelayError } from '../src/core/errors.js'
import { InMemoryRateLimiter } from '../src/core/rateLimiter.js'
import { createLogger } from '../src/core/logger.js'

const TOKEN = 'relay_' + 'q'.repeat(40)

const makeDeps = (
  overrides: {
    env?: Record<string, string>
    resolve?: DnsResolver['resolve']
    send?: HttpClient['send']
    rateLimitMax?: number
  } = {},
): { deps: RelayDeps; sent: OutboundRequest[]; lines: string[] } => {
  const sent: OutboundRequest[] = []
  const lines: string[] = []
  const config = loadConfig({
    RELAY_TOKEN: TOKEN,
    ALLOWED_HOSTS: 'example.com',
    ...overrides.env,
  })
  return {
    sent,
    lines,
    deps: {
      config,
      resolver: { resolve: overrides.resolve ?? (async () => ['93.184.216.34']) },
      httpClient: {
        send: async (req) => {
          sent.push(req)
          if (overrides.send) return overrides.send(req)
          return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: '{"ok":true}',
          }
        },
      },
      rateLimiter: new InMemoryRateLimiter({
        max: overrides.rateLimitMax ?? 1000,
        windowMs: 60_000,
      }),
      logger: createLogger((line) => lines.push(line)),
    },
  }
}

const call = (payload: unknown, deps: RelayDeps, authorization = `Bearer ${TOKEN}`) =>
  handleRelay({ authorization, payload, clientKey: '203.0.113.9', requestId: 'req_test' }, deps)

describe('handleRelay 成功路徑', () => {
  it('回傳標準成功格式', async () => {
    const { deps } = makeDeps()
    const result = await call(
      { method: 'POST', url: 'https://example.com/webhook', bodyType: 'json', body: { a: 1 } },
      deps,
    )
    expect(result).toEqual({
      success: true,
      requestId: 'req_test',
      request: { method: 'POST', url: 'https://example.com/webhook' },
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      },
    })
  })

  it('把 query 附加到 URL 並做 encoding', async () => {
    const { deps, sent } = makeDeps()
    await call(
      { method: 'GET', url: 'https://example.com/api', query: { source: 'a b', type: 'x&y' } },
      deps,
    )
    expect(sent[0]?.url).toBe('https://example.com/api?source=a+b&type=x%26y')
  })

  it('bodyType=json 且使用者沒指定 Content-Type 時自動補上', async () => {
    const { deps, sent } = makeDeps()
    await call(
      { method: 'POST', url: 'https://example.com/w', bodyType: 'json', body: { a: 1 } },
      deps,
    )
    expect(sent[0]?.headers['content-type']).toBe('application/json')
    expect(sent[0]?.body).toBe('{"a":1}')
  })

  it('使用者已指定 Content-Type 時不覆寫', async () => {
    const { deps, sent } = makeDeps()
    await call(
      {
        method: 'POST',
        url: 'https://example.com/w',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        bodyType: 'json',
        body: { a: 1 },
      },
      deps,
    )
    expect(sent[0]?.headers['content-type']).toBe('application/vnd.api+json')
  })

  it('把已驗證的 IP 與 config 上限傳給 httpClient', async () => {
    const { deps, sent } = makeDeps()
    await call({ method: 'GET', url: 'https://example.com/api' }, deps)
    expect(sent[0]?.resolvedIps).toEqual(['93.184.216.34'])
    expect(sent[0]?.timeoutMs).toBe(30000)
    expect(sent[0]?.maxResponseBytes).toBe(5242880)
    expect(sent[0]?.followRedirects).toBe(false)
  })

  it('Target 回 404 仍視為 Relay 成功（requirement.md §30）', async () => {
    const { deps } = makeDeps({
      send: async () => ({ status: 404, statusText: 'Not Found', headers: {}, body: 'nope' }),
    })
    const result = await call({ method: 'GET', url: 'https://example.com/missing' }, deps)
    expect(result.success).toBe(true)
    expect(result.response.status).toBe(404)
  })

  it('寫出一行 log，且不含 token 或 body 內容', async () => {
    const { deps, lines } = makeDeps()
    await call(
      {
        method: 'POST',
        url: 'https://example.com/w',
        headers: { Authorization: 'Bearer target_secret' },
        bodyType: 'json',
        body: { password: 'p@ss' },
      },
      deps,
    )
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0] as string)
    expect(parsed).toMatchObject({
      requestId: 'req_test',
      method: 'POST',
      host: 'example.com',
      path: '/w',
      status: 200,
      result: 'success',
    })
    expect(parsed.headerNames).toContain('authorization')
    expect(lines[0]).not.toContain(TOKEN)
    expect(lines[0]).not.toContain('target_secret')
    expect(lines[0]).not.toContain('p@ss')
  })
})

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise
    expect.unreachable(`should throw ${code}`)
  } catch (err) {
    expect(err).toBeInstanceOf(RelayError)
    expect((err as RelayError).code).toBe(code)
  }
}

describe('handleRelay 錯誤路徑與檢查順序', () => {
  it('錯誤 token → INVALID_RELAY_TOKEN，且不會做 DNS 解析', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const { deps } = makeDeps({ resolve })
    await expectCode(call({ method: 'GET', url: 'https://example.com' }, deps, 'Bearer wrong'), 'INVALID_RELAY_TOKEN')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('認證先於 payload 驗證', async () => {
    const { deps } = makeDeps()
    await expectCode(call({ garbage: true }, deps, 'Bearer wrong'), 'INVALID_RELAY_TOKEN')
  })

  it('payload 不合法 → INVALID_JSON', async () => {
    const { deps } = makeDeps()
    await expectCode(call({ url: 'https://example.com' }, deps), 'INVALID_JSON')
  })

  it('method 不在 ALLOWED_METHODS → METHOD_NOT_ALLOWED', async () => {
    const { deps } = makeDeps()
    await expectCode(call({ method: 'OPTIONS', url: 'https://example.com' }, deps), 'METHOD_NOT_ALLOWED')
  })

  it('URL 無法解析 → INVALID_URL', async () => {
    const { deps } = makeDeps()
    await expectCode(call({ method: 'GET', url: 'not a url' }, deps), 'INVALID_URL')
  })

  it('非 http/https protocol → INVALID_URL', async () => {
    const { deps } = makeDeps()
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com', 'ws://example.com']) {
      await expectCode(call({ method: 'GET', url }, deps), 'INVALID_URL')
    }
  })

  it('ALLOW_HTTP=false 時 http:// 被拒；設為 true 時放行', async () => {
    const blocked = makeDeps()
    await expectCode(call({ method: 'GET', url: 'http://example.com/a' }, blocked.deps), 'INVALID_URL')

    const allowed = makeDeps({ env: { ALLOW_HTTP: 'true' } })
    const result = await call({ method: 'GET', url: 'http://example.com/a' }, allowed.deps)
    expect(result.success).toBe(true)
  })

  it('不在 allowlist 的 host → HOST_NOT_ALLOWED，且不做 DNS 解析', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const { deps } = makeDeps({ resolve })
    await expectCode(call({ method: 'GET', url: 'https://example.com.attacker.com/' }, deps), 'HOST_NOT_ALLOWED')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('DNS 查詢失敗 → DNS_LOOKUP_FAILED', async () => {
    const { deps } = makeDeps({
      resolve: async () => {
        throw new Error('ENOTFOUND')
      },
    })
    await expectCode(call({ method: 'GET', url: 'https://example.com/a' }, deps), 'DNS_LOOKUP_FAILED')
  })

  it('DNS 回空清單 → DNS_LOOKUP_FAILED', async () => {
    const { deps } = makeDeps({ resolve: async () => [] })
    await expectCode(call({ method: 'GET', url: 'https://example.com/a' }, deps), 'DNS_LOOKUP_FAILED')
  })

  it('任一候選 IP 為私有位址就整個拒絕 → SSRF_BLOCKED（requirement.md §23）', async () => {
    const { deps } = makeDeps({ resolve: async () => ['93.184.216.34', '127.0.0.1'] })
    await expectCode(call({ method: 'GET', url: 'https://example.com/a' }, deps), 'SSRF_BLOCKED')
  })

  it('URL 直接寫私有 IP 也擋下（ALLOW_ANY_PUBLIC_HOST=true 時）', async () => {
    const { deps } = makeDeps({ env: { ALLOW_ANY_PUBLIC_HOST: 'true', ALLOW_HTTP: 'true' } })
    for (const url of [
      'http://127.0.0.1/admin',
      'http://10.0.0.1/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
    ]) {
      await expectCode(call({ method: 'GET', url }, deps), 'SSRF_BLOCKED')
    }
  })

  it('localhost 走 DNS 解析後仍被擋', async () => {
    const { deps } = makeDeps({
      env: { ALLOW_ANY_PUBLIC_HOST: 'true', ALLOW_HTTP: 'true' },
      resolve: async () => ['127.0.0.1'],
    })
    await expectCode(call({ method: 'GET', url: 'http://localhost/' }, deps), 'SSRF_BLOCKED')
  })

  it('黑名單 header → INVALID_HEADER', async () => {
    const { deps } = makeDeps()
    await expectCode(
      call({ method: 'GET', url: 'https://example.com/a', headers: { Host: 'internal.service' } }, deps),
      'INVALID_HEADER',
    )
  })

  it('body 超過 MAX_REQUEST_BODY_BYTES → REQUEST_TOO_LARGE', async () => {
    const { deps } = makeDeps({ env: { MAX_REQUEST_BODY_BYTES: '10' } })
    await expectCode(
      call({ method: 'POST', url: 'https://example.com/a', bodyType: 'raw', body: 'x'.repeat(50) }, deps),
      'REQUEST_TOO_LARGE',
    )
  })

  it('body 大小用 byte 計算，不是字元數', async () => {
    const { deps } = makeDeps({ env: { MAX_REQUEST_BODY_BYTES: '5' } })
    await expectCode(
      call({ method: 'POST', url: 'https://example.com/a', bodyType: 'raw', body: '中文字' }, deps),
      'REQUEST_TOO_LARGE',
    )
  })

  it('httpClient 丟出的 RelayError 原樣往外傳', async () => {
    const { deps } = makeDeps({
      send: async () => {
        throw new RelayError('TARGET_TIMEOUT', 'The target server did not respond within 30000 ms.')
      },
    })
    await expectCode(call({ method: 'GET', url: 'https://example.com/a' }, deps), 'TARGET_TIMEOUT')
  })

  it('httpClient 丟出的非 RelayError → TARGET_CONNECTION_FAILED', async () => {
    const { deps } = makeDeps({
      send: async () => {
        throw new Error('ECONNREFUSED 93.184.216.34:443')
      },
    })
    await expectCode(call({ method: 'GET', url: 'https://example.com/a' }, deps), 'TARGET_CONNECTION_FAILED')
  })

  it('超過 rate limit → RATE_LIMITED，且不做認證以外的工作', async () => {
    const { deps } = makeDeps({ rateLimitMax: 1 })
    await call({ method: 'GET', url: 'https://example.com/a' }, deps)
    await expectCode(call({ method: 'GET', url: 'https://example.com/a' }, deps), 'RATE_LIMITED')
  })

  it('錯誤時也寫一行 log，帶 errorCode', async () => {
    const { deps, lines } = makeDeps({ resolve: async () => ['127.0.0.1'] })
    await expectCode(call({ method: 'GET', url: 'https://example.com/a' }, deps), 'SSRF_BLOCKED')
    const parsed = JSON.parse(lines[0] as string)
    expect(parsed.result).toBe('error')
    expect(parsed.errorCode).toBe('SSRF_BLOCKED')
  })
})
