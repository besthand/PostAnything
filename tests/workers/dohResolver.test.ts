import { describe, it, expect } from 'vitest'
import { createDohResolver } from '../../src/adapters/workers/dohResolver.js'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/dns-json' } })

describe('createDohResolver', () => {
  it('用 DoH JSON API 查 A 與 AAAA 並合併結果', async () => {
    const seen: string[] = []
    const resolver = createDohResolver('https://dns.test/dns-query', async (input) => {
      const url = new URL(String(input))
      seen.push(url.searchParams.get('type') as string)
      return jsonResponse({
        Status: 0,
        Answer:
          url.searchParams.get('type') === 'A'
            ? [{ type: 1, data: '93.184.216.34' }]
            : [{ type: 28, data: '2606:2800:220:1::1946' }],
      })
    })

    expect(await resolver.resolve('example.com')).toEqual([
      '93.184.216.34',
      '2606:2800:220:1::1946',
    ])
    expect(seen.sort()).toEqual(['A', 'AAAA'])
  })

  it('忽略 CNAME 之類的非位址記錄', async () => {
    const resolver = createDohResolver('https://dns.test/dns-query', async (input) => {
      const url = new URL(String(input))
      if (url.searchParams.get('type') !== 'A') return jsonResponse({ Status: 0, Answer: [] })
      return jsonResponse({
        Status: 0,
        Answer: [
          { type: 5, data: 'alias.example.com.' },
          { type: 1, data: '93.184.216.34' },
        ],
      })
    })
    expect(await resolver.resolve('example.com')).toEqual(['93.184.216.34'])
  })

  it('兩種查詢都沒有位址時丟錯', async () => {
    const resolver = createDohResolver('https://dns.test/dns-query', async () =>
      jsonResponse({ Status: 3, Answer: [] }),
    )
    await expect(resolver.resolve('nope.invalid')).rejects.toThrow()
  })

  it('DoH 端點回非 200 時丟錯', async () => {
    const resolver = createDohResolver('https://dns.test/dns-query', async () =>
      new Response('nope', { status: 500 }),
    )
    await expect(resolver.resolve('example.com')).rejects.toThrow()
  })

  it('查詢帶正確的 name/type 與 Accept header', async () => {
    let capturedUrl = ''
    let capturedAccept = ''
    const resolver = createDohResolver('https://dns.test/dns-query', async (input, init) => {
      capturedUrl = String(input)
      capturedAccept = new Headers(init?.headers).get('accept') ?? ''
      return jsonResponse({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] })
    })
    await resolver.resolve('example.com')
    expect(capturedUrl).toContain('name=example.com')
    expect(capturedAccept).toBe('application/dns-json')
  })
})
