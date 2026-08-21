import { describe, it, expect } from 'vitest'
import { RelayError, statusForCode, toErrorBody } from '../src/core/errors.js'

describe('RelayError', () => {
  it('保留 code 與 message，且 instanceof Error', () => {
    const err = new RelayError('SSRF_BLOCKED', 'Target resolves to a blocked address.')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('SSRF_BLOCKED')
    expect(err.message).toBe('Target resolves to a blocked address.')
    expect(err.name).toBe('RelayError')
  })
})

describe('statusForCode', () => {
  it.each([
    ['INVALID_RELAY_TOKEN', 401],
    ['METHOD_NOT_ALLOWED', 400],
    ['HOST_NOT_ALLOWED', 403],
    ['INVALID_URL', 400],
    ['SSRF_BLOCKED', 403],
    ['INVALID_HEADER', 400],
    ['REQUEST_TOO_LARGE', 413],
    ['RESPONSE_TOO_LARGE', 502],
    ['DNS_LOOKUP_FAILED', 502],
    ['TARGET_TIMEOUT', 504],
    ['TARGET_CONNECTION_FAILED', 502],
    ['INVALID_JSON', 400],
    ['RATE_LIMITED', 429],
    ['INTERNAL_ERROR', 500],
  ] as const)('%s → %i', (code, status) => {
    expect(statusForCode(code)).toBe(status)
  })
})

describe('toErrorBody', () => {
  it('RelayError 轉成標準錯誤格式', () => {
    const out = toErrorBody(new RelayError('INVALID_URL', 'Bad URL.'), 'req_abc')
    expect(out.status).toBe(400)
    expect(out.body).toEqual({
      success: false,
      requestId: 'req_abc',
      error: { code: 'INVALID_URL', message: 'Bad URL.' },
    })
  })

  it('未知錯誤一律變成 INTERNAL_ERROR 且不外洩原始訊息', () => {
    const out = toErrorBody(new Error('token=relay_supersecret leaked'), 'req_abc')
    expect(out.status).toBe(500)
    expect(out.body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(out.body)).not.toContain('relay_supersecret')
  })
})
