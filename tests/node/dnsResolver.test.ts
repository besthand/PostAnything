import { describe, it, expect } from 'vitest'
import { createNodeDnsResolver } from '../../src/adapters/node/dnsResolver.js'

describe('createNodeDnsResolver', () => {
  it('合併 A 與 AAAA 結果', async () => {
    const resolver = createNodeDnsResolver({
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
    })
    expect(await resolver.resolve('example.com')).toEqual([
      '93.184.216.34',
      '2606:2800:220:1:248:1893:25c8:1946',
    ])
  })

  it('只有 A 記錄時也成功', async () => {
    const resolver = createNodeDnsResolver({
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => {
        throw new Error('ENODATA')
      },
    })
    expect(await resolver.resolve('example.com')).toEqual(['93.184.216.34'])
  })

  it('兩種記錄都查不到時丟錯', async () => {
    const resolver = createNodeDnsResolver({
      resolve4: async () => {
        throw new Error('ENOTFOUND')
      },
      resolve6: async () => {
        throw new Error('ENOTFOUND')
      },
    })
    await expect(resolver.resolve('nope.invalid')).rejects.toThrow()
  })

  it('兩種記錄都回空陣列時丟錯', async () => {
    const resolver = createNodeDnsResolver({
      resolve4: async () => [],
      resolve6: async () => [],
    })
    await expect(resolver.resolve('empty.invalid')).rejects.toThrow()
  })
})
