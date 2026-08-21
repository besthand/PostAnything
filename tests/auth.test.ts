import { describe, it, expect } from 'vitest'
import { assertAuthenticated, timingSafeEqualString } from '../src/core/auth.js'
import { RelayError } from '../src/core/errors.js'

const TOKEN = 'relay_' + 'z'.repeat(40)

describe('timingSafeEqualString', () => {
  it('相同字串回 true', () => {
    expect(timingSafeEqualString(TOKEN, TOKEN)).toBe(true)
  })
  it('不同字串回 false', () => {
    expect(timingSafeEqualString(TOKEN, TOKEN + 'x')).toBe(false)
    expect(timingSafeEqualString(TOKEN, '')).toBe(false)
  })
  it('多位元組字元不會誤判', () => {
    expect(timingSafeEqualString('金鑰', '金鑰')).toBe(true)
    expect(timingSafeEqualString('金鑰', '金錀')).toBe(false)
  })
})

describe('assertAuthenticated', () => {
  it('正確 token 不丟錯', () => {
    expect(() => assertAuthenticated(`Bearer ${TOKEN}`, TOKEN)).not.toThrow()
  })

  it('Bearer 關鍵字大小寫不敏感', () => {
    expect(() => assertAuthenticated(`bearer ${TOKEN}`, TOKEN)).not.toThrow()
  })

  it.each([
    ['缺少 header', undefined],
    ['空字串', ''],
    ['沒有 Bearer 前綴', TOKEN],
    ['錯誤 scheme', `Basic ${TOKEN}`],
    ['錯誤 token', 'Bearer wrong-token'],
  ])('%s → INVALID_RELAY_TOKEN', (_label, header) => {
    try {
      assertAuthenticated(header as string | undefined, TOKEN)
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayError)
      expect((err as RelayError).code).toBe('INVALID_RELAY_TOKEN')
      expect((err as RelayError).message).toBe('Relay authentication failed.')
    }
  })

  it('錯誤訊息與 stack 都不含 token', () => {
    try {
      assertAuthenticated('Bearer wrong', TOKEN)
    } catch (err) {
      const dumped = `${(err as Error).message}\n${(err as Error).stack ?? ''}`
      expect(dumped).not.toContain(TOKEN)
      expect(dumped).not.toContain('wrong')
    }
  })
})
