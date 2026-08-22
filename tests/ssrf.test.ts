import { describe, it, expect } from 'vitest'
import { isPublicIp, parseIpv4, parseIpv6 } from '../src/core/ssrf/ipRules.js'

describe('parseIpv4', () => {
  it('解析合法位址', () => {
    expect(parseIpv4('0.0.0.0')).toBe(0)
    expect(parseIpv4('255.255.255.255')).toBe(0xffffffff)
    expect(parseIpv4('192.168.1.1')).toBe(0xc0a80101)
  })
  it('拒絕非法格式（含前導零、八進位、十六進位、少於四段）', () => {
    expect(parseIpv4('127.0.0.01')).toBeNull()
    expect(parseIpv4('0177.0.0.1')).toBeNull()
    expect(parseIpv4('0x7f.0.0.1')).toBeNull()
    expect(parseIpv4('127.0.1')).toBeNull()
    expect(parseIpv4('256.0.0.1')).toBeNull()
    expect(parseIpv4('1.2.3.4.5')).toBeNull()
    expect(parseIpv4('')).toBeNull()
  })
})

describe('parseIpv6', () => {
  it('解析壓縮寫法', () => {
    const loopback = parseIpv6('::1')
    expect(loopback).not.toBeNull()
    expect(Array.from(loopback as Uint8Array).slice(0, 15).every((b) => b === 0)).toBe(true)
    expect((loopback as Uint8Array)[15]).toBe(1)
  })
  it('解析完整寫法與內嵌 IPv4', () => {
    expect(parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')).not.toBeNull()
    const mapped = parseIpv6('::ffff:127.0.0.1')
    expect(mapped).not.toBeNull()
    expect(Array.from((mapped as Uint8Array).slice(10))).toEqual([0xff, 0xff, 127, 0, 0, 1])
  })
  it('拒絕非法格式', () => {
    expect(parseIpv6('1::2::3')).toBeNull()
    expect(parseIpv6('gggg::1')).toBeNull()
    expect(parseIpv6('12345::1')).toBeNull()
    expect(parseIpv6('')).toBeNull()
  })
})

describe('isPublicIp — requirement.md §59 必須全部拒絕', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '2002:7f00:1::1',
    '64:ff9b::7f00:1',
  ])('拒絕 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false)
  })

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '172.32.0.1',
    '172.15.255.255',
    '2606:4700:4700::1111',
    '2404:6800:4008:c07::65',
  ])('允許 %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true)
  })

  it('無法解析的字串一律視為不安全', () => {
    expect(isPublicIp('localhost')).toBe(false)
    expect(isPublicIp('not-an-ip')).toBe(false)
    expect(isPublicIp('')).toBe(false)
  })
})
