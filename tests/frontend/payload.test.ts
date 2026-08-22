import { describe, it, expect } from 'vitest'
import {
  buildPayload,
  formatRequestPreview,
  formatResponseText,
  rowsToObject,
} from '../../public/payload.js'

describe('rowsToObject', () => {
  it('轉成物件並略過空 key', () => {
    expect(
      rowsToObject([
        { key: 'source', value: 'agent' },
        { key: '', value: 'ignored' },
        { key: '  type  ', value: ' article ' },
      ]),
    ).toEqual({ source: 'agent', type: 'article' })
  })
})

describe('buildPayload', () => {
  it('bodyType=none 時不帶 body', () => {
    expect(
      buildPayload({
        method: 'GET',
        url: 'https://example.com/api',
        queryRows: [],
        headerRows: [],
        bodyType: 'none',
        bodyText: '',
        formRows: [],
      }),
    ).toEqual({
      method: 'GET',
      url: 'https://example.com/api',
      query: {},
      headers: {},
      bodyType: 'none',
    })
  })

  it('bodyType=json 時 body 送出原始字串（由後端驗證）', () => {
    const payload = buildPayload({
      method: 'POST',
      url: 'https://example.com/w',
      queryRows: [{ key: 'source', value: 'agent' }],
      headerRows: [{ key: 'Content-Type', value: 'application/json' }],
      bodyType: 'json',
      bodyText: '{"title":"Hello"}',
      formRows: [],
    })
    expect(payload).toEqual({
      method: 'POST',
      url: 'https://example.com/w',
      query: { source: 'agent' },
      headers: { 'Content-Type': 'application/json' },
      bodyType: 'json',
      body: '{"title":"Hello"}',
    })
  })

  it('bodyType=form 時 body 用 key/value 列', () => {
    const payload = buildPayload({
      method: 'POST',
      url: 'https://example.com/w',
      queryRows: [],
      headerRows: [],
      bodyType: 'form',
      bodyText: 'ignored',
      formRows: [{ key: 'title', value: 'Hello' }],
    })
    expect(payload.body).toEqual({ title: 'Hello' })
  })

  it('method 轉大寫、url 去空白', () => {
    const payload = buildPayload({
      method: 'post',
      url: '  https://example.com/w  ',
      queryRows: [],
      headerRows: [],
      bodyType: 'none',
      bodyText: '',
      formRows: [],
    })
    expect(payload.method).toBe('POST')
    expect(payload.url).toBe('https://example.com/w')
  })
})

describe('formatResponseText', () => {
  it('成功時輸出 Agent 可判讀的欄位', () => {
    const text = formatResponseText({
      success: true,
      requestId: 'req_abc',
      request: { method: 'POST', url: 'https://example.com/w' },
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: '{"id":123}',
      },
    })
    expect(text).toContain('STATUS: SUCCESS')
    expect(text).toContain('REQUEST_ID: req_abc')
    expect(text).toContain('HTTP_STATUS: 200')
    expect(text).toContain('HTTP_STATUS_TEXT: OK')
    expect(text).toContain('content-type: application/json')
    expect(text).toContain('RESPONSE_BODY:')
    expect(text).toContain('{"id":123}')
  })

  it('Target 回 404 仍是 STATUS: SUCCESS（requirement.md §30）', () => {
    const text = formatResponseText({
      success: true,
      requestId: 'req_abc',
      request: { method: 'GET', url: 'https://example.com/missing' },
      response: { status: 404, statusText: 'Not Found', headers: {}, body: '' },
    })
    expect(text).toContain('STATUS: SUCCESS')
    expect(text).toContain('HTTP_STATUS: 404')
  })

  it('Relay 失敗時輸出 ERROR_CODE 與 MESSAGE', () => {
    const text = formatResponseText({
      success: false,
      requestId: 'req_abc',
      error: { code: 'TARGET_TIMEOUT', message: 'The target server did not respond within 30000 ms.' },
    })
    expect(text).toContain('STATUS: ERROR')
    expect(text).toContain('ERROR_CODE: TARGET_TIMEOUT')
    expect(text).toContain('MESSAGE:')
    expect(text).toContain('did not respond within 30000 ms')
    expect(text).not.toContain('HTTP_STATUS:')
  })
})

describe('formatRequestPreview', () => {
  it('遮蔽敏感 header 的值', () => {
    const text = formatRequestPreview({
      method: 'POST',
      url: 'https://example.com/w',
      query: { source: 'agent' },
      headers: { Authorization: 'Bearer target_secret', 'Content-Type': 'application/json' },
      bodyType: 'json',
      body: '{"title":"Hello"}',
    })
    expect(text).toContain('POST https://example.com/w?source=agent')
    expect(text).toContain('Authorization: ********')
    expect(text).toContain('Content-Type: application/json')
    expect(text).not.toContain('target_secret')
    expect(text).toContain('{"title":"Hello"}')
  })
})
