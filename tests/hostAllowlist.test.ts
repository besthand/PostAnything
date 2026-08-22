import { describe, it, expect } from 'vitest'
import { isHostAllowed, normalizeHostname } from '../src/core/ssrf/hostAllowlist.js'

describe('normalizeHostname', () => {
  it('轉小寫並移除 FQDN 結尾的點與方括號', () => {
    expect(normalizeHostname('Example.COM.')).toBe('example.com')
    expect(normalizeHostname('[2606:4700::1111]')).toBe('2606:4700::1111')
    expect(normalizeHostname('  api.test.tw  ')).toBe('api.test.tw')
  })
})

describe('isHostAllowed', () => {
  const allowlist = ['example.com', 'flow.handbro.pro']

  it('exact match 通過', () => {
    expect(isHostAllowed('example.com', allowlist, false)).toBe(true)
    expect(isHostAllowed('EXAMPLE.com', allowlist, false)).toBe(true)
    expect(isHostAllowed('example.com.', allowlist, false)).toBe(true)
  })

  it('未列出的 subdomain 預設拒絕（requirement.md §60）', () => {
    expect(isHostAllowed('api.example.com', allowlist, false)).toBe(false)
  })

  it('substring 混淆攻擊必須拒絕', () => {
    expect(isHostAllowed('example.com.attacker.com', allowlist, false)).toBe(false)
    expect(isHostAllowed('notexample.com', allowlist, false)).toBe(false)
    expect(isHostAllowed('example.community', allowlist, false)).toBe(false)
  })

  it('allowlist 為空且未開放任意 host → 全部拒絕', () => {
    expect(isHostAllowed('example.com', [], false)).toBe(false)
  })

  it('ALLOW_ANY_PUBLIC_HOST=true 時略過 allowlist（SSRF 仍由 ipRules 把關）', () => {
    expect(isHostAllowed('anything.example.net', [], true)).toBe(true)
    expect(isHostAllowed('example.com.attacker.com', allowlist, true)).toBe(true)
  })

  it('空 hostname 一律拒絕', () => {
    expect(isHostAllowed('', allowlist, false)).toBe(false)
    expect(isHostAllowed('', [], true)).toBe(false)
  })
})
