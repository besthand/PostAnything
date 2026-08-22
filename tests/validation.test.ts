import { describe, it, expect } from 'vitest'
import { applyQuery, buildBody, parsePayload } from '../src/core/validation.js'
import { RelayError } from '../src/core/errors.js'

const minimal = { method: 'get', url: 'https://example.com/api' }

describe('parsePayload', () => {
  it('補齊預設值並把 method 轉大寫', () => {
    expect(parsePayload(minimal)).toEqual({
      method: 'GET',
      url: 'https://example.com/api',
      query: {},
      headers: {},
      bodyType: 'none',
      body: undefined,
    })
  })

  it('保留 query / headers / body', () => {
    const p = parsePayload({
      method: 'POST',
      url: 'https://example.com/webhook',
      query: { source: 'agent' },
      headers: { 'Content-Type': 'application/json' },
      bodyType: 'json',
      body: { title: 'Hello' },
    })
    expect(p.query).toEqual({ source: 'agent' })
    expect(p.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(p.bodyType).toBe('json')
    expect(p.body).toEqual({ title: 'Hello' })
  })

  it.each([
    ['缺少 method', { url: 'https://example.com' }],
    ['缺少 url', { method: 'GET' }],
    ['url 非字串', { method: 'GET', url: 123 }],
    ['bodyType 不合法', { ...minimal, bodyType: 'xml' }],
    ['query 值非字串', { ...minimal, query: { a: 1 } }],
    ['headers 值非字串', { ...minimal, headers: { a: null } }],
    ['整包不是物件', 'nope'],
  ])('%s → INVALID_JSON', (_label, input) => {
    try {
      parsePayload(input)
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayError)
      expect((err as RelayError).code).toBe('INVALID_JSON')
    }
  })
})

describe('buildBody', () => {
  it('bodyType=none → 無 body', () => {
    expect(buildBody(parsePayload(minimal))).toEqual({
      body: undefined,
      defaultContentType: undefined,
    })
  })

  it('bodyType=json 物件 → 序列化並帶 application/json', () => {
    const built = buildBody(
      parsePayload({ ...minimal, method: 'POST', bodyType: 'json', body: { a: 1 } }),
    )
    expect(built.body).toBe('{"a":1}')
    expect(built.defaultContentType).toBe('application/json')
  })

  it('bodyType=json 字串 → 驗證是合法 JSON 後原樣送出', () => {
    const built = buildBody(
      parsePayload({ ...minimal, method: 'POST', bodyType: 'json', body: '{"a": 1}' }),
    )
    expect(built.body).toBe('{"a": 1}')
    expect(built.defaultContentType).toBe('application/json')
  })

  it('bodyType=json 但字串不是合法 JSON → INVALID_JSON', () => {
    try {
      buildBody(parsePayload({ ...minimal, method: 'POST', bodyType: 'json', body: '{a:1}' }))
      expect.unreachable('should throw')
    } catch (err) {
      expect((err as RelayError).code).toBe('INVALID_JSON')
    }
  })

  it('bodyType=raw → 原樣送出、不指定 Content-Type', () => {
    const built = buildBody(
      parsePayload({ ...minimal, method: 'POST', bodyType: 'raw', body: '<x>1</x>' }),
    )
    expect(built.body).toBe('<x>1</x>')
    expect(built.defaultContentType).toBeUndefined()
  })

  it('bodyType=form → urlencoded 並帶對應 Content-Type', () => {
    const built = buildBody(
      parsePayload({
        ...minimal,
        method: 'POST',
        bodyType: 'form',
        body: { title: 'Hello World', 'a b': 'c&d' },
      }),
    )
    expect(built.body).toBe('title=Hello+World&a+b=c%26d')
    expect(built.defaultContentType).toBe('application/x-www-form-urlencoded')
  })

  it('bodyType=form 但 body 不是字串對照表 → INVALID_JSON', () => {
    expect(() =>
      buildBody(parsePayload({ ...minimal, method: 'POST', bodyType: 'form', body: 'x=1' })),
    ).toThrow(RelayError)
  })
})

describe('applyQuery', () => {
  it('附加參數並保留原有 query', () => {
    const url = applyQuery(new URL('https://example.com/api?keep=1'), {
      source: 'agent',
      type: 'article',
    })
    expect(url.toString()).toBe('https://example.com/api?keep=1&source=agent&type=article')
  })

  it('自動做 URL encoding', () => {
    const url = applyQuery(new URL('https://example.com/api'), { q: 'a b&c' })
    expect(url.toString()).toBe('https://example.com/api?q=a+b%26c')
  })
})
