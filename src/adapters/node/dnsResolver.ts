import { promises as dns } from 'node:dns'
import type { DnsResolver } from '../../core/relay.js'

export interface DnsBackend {
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
}

const nodeBackend: DnsBackend = {
  resolve4: (hostname) => dns.resolve4(hostname),
  resolve6: (hostname) => dns.resolve6(hostname),
}

/**
 * 同時查 A 與 AAAA。只要其中一種有結果就算成功，
 * 但兩種的結果都要交給 SSRF 檢查（requirement.md §23）。
 */
export function createNodeDnsResolver(backend: DnsBackend = nodeBackend): DnsResolver {
  return {
    async resolve(hostname) {
      const [v4, v6] = await Promise.allSettled([
        backend.resolve4(hostname),
        backend.resolve6(hostname),
      ])

      const addresses = [
        ...(v4.status === 'fulfilled' ? v4.value : []),
        ...(v6.status === 'fulfilled' ? v6.value : []),
      ]

      if (addresses.length === 0) {
        throw new Error(`No A or AAAA records for "${hostname}".`)
      }
      return addresses
    },
  }
}
