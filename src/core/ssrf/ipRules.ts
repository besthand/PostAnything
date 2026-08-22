/**
 * SSRF 的最後一道防線：判斷一個「已經解析出來的 IP」是否可以連線。
 * 設計原則是白名單思維 — 解析不了、或落在任何特殊用途範圍，一律拒絕。
 */

/** 嚴格解析 IPv4 點分十進位；拒絕前導零、八進位、十六進位等歧義寫法。 */
export function parseIpv4(input: string): number | null {
  const parts = input.split('.')
  if (parts.length !== 4) return null

  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    if (part.length > 1 && part.startsWith('0')) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value >>> 0
}

/** 解析 IPv6（支援 `::` 壓縮與結尾內嵌 IPv4），回傳 16 bytes。 */
export function parseIpv6(input: string): Uint8Array | null {
  if (input.length === 0 || input.includes(':::')) return null

  let text = input
  const bytes = new Uint8Array(16)

  // 處理結尾內嵌的 IPv4，例如 ::ffff:127.0.0.1
  let tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  const afterLastColon = text.slice(lastColon + 1)
  if (afterLastColon.includes('.')) {
    const v4 = parseIpv4(afterLastColon)
    if (v4 === null) return null
    tail = [(v4 >>> 24) & 0xff, (v4 >>> 16) & 0xff, (v4 >>> 8) & 0xff, v4 & 0xff]
    text = text.slice(0, lastColon + 1) + '0:0'
  }

  const doubleColonCount = text.split('::').length - 1
  if (doubleColonCount > 1) return null

  const [headText, tailText] =
    doubleColonCount === 1 ? (text.split('::') as [string, string]) : [text, null]

  const parseGroups = (s: string): number[] | null => {
    if (s === '') return []
    const groups: number[] = []
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
      groups.push(parseInt(g, 16))
    }
    return groups
  }

  const head = parseGroups(headText)
  if (head === null) return null
  const rest = tailText === null ? [] : parseGroups(tailText)
  if (rest === null) return null

  // totalGroups 固定為 8：内嵌 IPv4 的 placeholder（'0:0'）已經佔掉尾端 2 組的位置，
  // 最終再用 tail 覆寫對應 bytes，不需要在這裡重複扣除。
  const totalGroups = 8
  if (doubleColonCount === 0) {
    if (head.length !== totalGroups) return null
  } else if (head.length + rest.length >= totalGroups) {
    return null // `::` 至少要壓縮掉一組
  }

  const groups: number[] = [
    ...head,
    ...new Array<number>(totalGroups - head.length - rest.length).fill(0),
    ...rest,
  ]

  groups.forEach((g, i) => {
    bytes[i * 2] = (g >>> 8) & 0xff
    bytes[i * 2 + 1] = g & 0xff
  })
  tail.forEach((b, i) => {
    bytes[16 - tail.length + i] = b
  })

  return bytes
}

const inV4Range = (ip: number, cidr: string): boolean => {
  const [network, bitsText] = cidr.split('/') as [string, string]
  const base = parseIpv4(network)
  if (base === null) return false
  const bits = Number(bitsText)
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return ((ip & mask) >>> 0) === ((base & mask) >>> 0)
}

/** IANA special-purpose 與所有非全域可路由的 IPv4 範圍。 */
const BLOCKED_V4_CIDRS = [
  '0.0.0.0/8', // 本網路
  '10.0.0.0/8', // 私有
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local（含 cloud metadata 169.254.169.254）
  '172.16.0.0/12', // 私有
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.88.99.0/24', // 6to4 relay anycast
  '192.168.0.0/16', // 私有
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved（含 255.255.255.255 broadcast）
]

const isPublicIpv4 = (ip: number): boolean =>
  !BLOCKED_V4_CIDRS.some((cidr) => inV4Range(ip, cidr))

const isPublicIpv6 = (bytes: Uint8Array): boolean => {
  const b0 = bytes[0] as number
  const b1 = bytes[1] as number

  // IPv4-mapped ::ffff:a.b.c.d → 用 IPv4 規則判斷
  const isMapped =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff
  if (isMapped) {
    const v4 =
      (((bytes[12] as number) << 24) |
        ((bytes[13] as number) << 16) |
        ((bytes[14] as number) << 8) |
        (bytes[15] as number)) >>>
      0
    return isPublicIpv4(v4)
  }

  // 只允許全域單播 2000::/3，其餘（含 ::、::1、fc00::/7、fe80::/10、ff00::/8）全部拒絕
  if ((b0 & 0xe0) !== 0x20) return false

  // 2001:db8::/32 文件用途
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false
  // 2001:0000::/32 Teredo，內嵌 IPv4
  if (b0 === 0x20 && b1 === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return false
  // 2002::/16 6to4，內嵌 IPv4
  if (b0 === 0x20 && b1 === 0x02) return false

  return true
}

/** 傳入單一 IP 字串；只有確定是公開可路由位址才回 true。 */
export function isPublicIp(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, '')
  if (trimmed.length === 0) return false

  const v4 = parseIpv4(trimmed)
  if (v4 !== null) return isPublicIpv4(v4)

  const v6 = parseIpv6(trimmed)
  if (v6 !== null) return isPublicIpv6(v6)

  return false
}
