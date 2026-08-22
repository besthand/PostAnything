/**
 * Host allowlist 只做 exact match。
 * 絕對不要用 endsWith / includes — `example.com.attacker.com`
 * 會通過 includes('example.com')，那正是 requirement.md §19 明文禁止的錯誤。
 */
export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
}

export function isHostAllowed(
  hostname: string,
  allowedHosts: string[],
  allowAnyPublicHost: boolean,
): boolean {
  const host = normalizeHostname(hostname)
  if (host.length === 0) return false
  if (allowAnyPublicHost) return true
  return allowedHosts.some((allowed) => normalizeHostname(allowed) === host)
}
