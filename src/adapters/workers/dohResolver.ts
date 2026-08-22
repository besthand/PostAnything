import type { DnsResolver } from '../../core/relay.js'

interface DohAnswer {
  type: number
  data: string
}

interface DohResponse {
  Status: number
  Answer?: DohAnswer[]
}

const RECORD_TYPE = { A: 1, AAAA: 28 } as const

const queryOne = async (
  endpoint: string,
  hostname: string,
  type: 'A' | 'AAAA',
  fetchImpl: typeof fetch,
): Promise<string[]> => {
  const url = new URL(endpoint)
  url.searchParams.set('name', hostname)
  url.searchParams.set('type', type)

  const response = await fetchImpl(url.toString(), {
    headers: { accept: 'application/dns-json' },
  })
  if (!response.ok) {
    throw new Error(`DoH query failed with status ${response.status}.`)
  }

  const json = (await response.json()) as DohResponse
  return (json.Answer ?? [])
    .filter((answer) => answer.type === RECORD_TYPE[type])
    .map((answer) => answer.data)
}

/**
 * Workers runtime 沒有 dns 模組，改用 Cloudflare 的 DoH JSON API。
 * 注意：這只能「驗證」位址，無法把後續的 fetch 釘在驗過的 IP 上，
 * 因此保護強度低於 Node adapter 的 IP pinning（README 有記載）。
 */
export function createDohResolver(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): DnsResolver {
  return {
    async resolve(hostname) {
      const [v4, v6] = await Promise.allSettled([
        queryOne(endpoint, hostname, 'A', fetchImpl),
        queryOne(endpoint, hostname, 'AAAA', fetchImpl),
      ])

      const addresses = [
        ...(v4.status === 'fulfilled' ? v4.value : []),
        ...(v6.status === 'fulfilled' ? v6.value : []),
      ]

      if (addresses.length === 0) {
        if (v4.status === 'rejected' && v6.status === 'rejected') {
          throw new Error(`DoH lookup failed for "${hostname}".`)
        }
        throw new Error(`No A or AAAA records for "${hostname}".`)
      }
      return addresses
    },
  }
}
