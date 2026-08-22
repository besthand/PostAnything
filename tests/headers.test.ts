import { describe, it, expect } from 'vitest'
import {
  assertHeadersAllowed,
  isBlockedHeader,
  maskSensitiveHeaders,
  sanitizeHeaders,
  stripBlockedHeaders,
} from '../src/core/headers.js'
import { RelayError } from '../src/core/errors.js'

describe('isBlockedHeader', () => {
  it.each([
    'Host',
    'content-length',
    'Connection',
    'Transfer-Encoding',
    'Upgrade',
    'Proxy-Authorization',
    'Proxy-Connection',
    'Forwarded',
    'X-Forwarded-For',
    'X-Forwarded-Host',
    'X-Forwarded-Proto',
    'X-Real-IP',
    'CF-Connecting-IP',
    'x-vercel-id',
    'X-AWS-Request-Id',
  ])('阻擋 %s', (name) => {
    expect(isBlockedHeader(name)).toBe(true)
  })

  it.each(['Authorization', 'X-API-Key', 'Content-Type', 'Accept', 'User-Agent', 'Cookie'])(
    '允許 %s',
    (name) => {
      expect(isBlockedHeader(name)).toBe(false)
    },
  )
})

describe('assertHeadersAllowed', () => {
  it('允許的 header 不丟錯', () => {
    expect(() =>
      assertHeadersAllowed({
        Authorization: 'Bearer xxx',
        'X-API-Key': 'xxx',
        'Content-Type': 'application/json',
      }),
    ).not.toThrow()
  })

  it('黑名單 header → INVALID_HEADER（requirement.md §62）', () => {
    try {
      assertHeadersAllowed({ Host: 'internal.service' })
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayError)
      expect((err as RelayError).code).toBe('INVALID_HEADER')
      expect((err as RelayError).message).toContain('host')
    }
  })

  it('header 名稱含非法字元 → INVALID_HEADER', () => {
    expect(() => assertHeadersAllowed({ 'Bad Header': 'x' })).toThrow(RelayError)
    expect(() => assertHeadersAllowed({ 'X-Inject\r\nEvil': 'x' })).toThrow(RelayError)
    expect(() => assertHeadersAllowed({ '': 'x' })).toThrow(RelayError)
  })

  it('header 值含 CR/LF → INVALID_HEADER（阻擋 response splitting）', () => {
    expect(() => assertHeadersAllowed({ 'X-Test': 'a\r\nX-Evil: b' })).toThrow(RelayError)
    expect(() => assertHeadersAllowed({ 'X-Test': 'a\nb' })).toThrow(RelayError)
  })
})

describe('sanitizeHeaders', () => {
  it('key 轉小寫、value 去掉前後空白', () => {
    expect(sanitizeHeaders({ 'Content-Type': '  application/json  ' })).toEqual({
      'content-type': 'application/json',
    })
  })
})

describe('stripBlockedHeaders', () => {
  it('移除黑名單但保留其他', () => {
    expect(
      stripBlockedHeaders({
        Host: 'evil',
        'CF-Ray': 'abc',
        Authorization: 'Bearer xxx',
        'Content-Type': 'application/json',
      }),
    ).toEqual({ authorization: 'Bearer xxx', 'content-type': 'application/json' })
  })
})

describe('maskSensitiveHeaders', () => {
  it('遮蔽敏感 header 的值', () => {
    expect(
      maskSensitiveHeaders({
        Authorization: 'Bearer supersecret',
        Cookie: 'a=b',
        'X-API-Key': 'k',
        'Content-Type': 'application/json',
      }),
    ).toEqual({
      authorization: '********',
      cookie: '********',
      'x-api-key': '********',
      'content-type': 'application/json',
    })
  })
})
