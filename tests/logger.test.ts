import { describe, it, expect } from 'vitest'
import { newRequestId } from '../src/core/requestId.js'
import { createLogger, formatLogLine } from '../src/core/logger.js'

describe('newRequestId', () => {
  it('以 req_ 開頭且長度足夠', () => {
    const id = newRequestId()
    expect(id.startsWith('req_')).toBe(true)
    expect(id.length).toBeGreaterThanOrEqual(20)
  })

  it('只含 URL-safe 字元', () => {
    expect(newRequestId()).toMatch(/^req_[0-9a-z]+$/)
  })

  it('連續產生不重複', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()))
    expect(ids.size).toBe(500)
  })
})

describe('formatLogLine', () => {
  it('輸出固定欄位的 JSON', () => {
    const line = formatLogLine(
      {
        requestId: 'req_abc',
        method: 'POST',
        host: 'flow.handbro.pro',
        path: '/webhook/article',
        status: 200,
        durationMs: 431,
        result: 'success',
        headerNames: ['content-type', 'authorization'],
      },
      '2026-08-21T23:00:00.000Z',
    )
    expect(JSON.parse(line)).toEqual({
      timestamp: '2026-08-21T23:00:00.000Z',
      requestId: 'req_abc',
      method: 'POST',
      host: 'flow.handbro.pro',
      path: '/webhook/article',
      status: 200,
      durationMs: 431,
      result: 'success',
      headerNames: ['content-type', 'authorization'],
    })
  })

  it('略過 undefined 欄位', () => {
    const parsed = JSON.parse(
      formatLogLine(
        { requestId: 'req_abc', method: 'GET', host: 'a.tw', path: '/', result: 'error', errorCode: 'SSRF_BLOCKED' },
        '2026-08-21T23:00:00.000Z',
      ),
    )
    expect(parsed).not.toHaveProperty('status')
    expect(parsed.errorCode).toBe('SSRF_BLOCKED')
  })

  it('只序列化白名單欄位，額外塞進來的敏感資料不會外流', () => {
    const dirty = {
      requestId: 'req_abc',
      method: 'GET',
      host: 'a.tw',
      path: '/',
      result: 'success' as const,
      authorization: 'Bearer relay_supersecret',
      body: '{"password":"p"}',
    }
    const line = formatLogLine(dirty as never, '2026-08-21T23:00:00.000Z')
    expect(line).not.toContain('relay_supersecret')
    expect(line).not.toContain('password')
  })
})

describe('createLogger', () => {
  it('把格式化後的行送給 sink', () => {
    const lines: string[] = []
    const logger = createLogger(
      (line) => lines.push(line),
      () => new Date('2026-08-21T23:00:00.000Z'),
    )
    logger.log({ requestId: 'req_abc', method: 'GET', host: 'a.tw', path: '/', result: 'success' })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string).timestamp).toBe('2026-08-21T23:00:00.000Z')
  })
})
