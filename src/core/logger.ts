export interface RelayLogFields {
  requestId: string
  method: string
  host: string
  path: string
  result: 'success' | 'error'
  status?: number
  durationMs?: number
  errorCode?: string
  /** 只記 header 名稱，永遠不記值（requirement.md §37） */
  headerNames?: string[]
}

/**
 * 只序列化白名單欄位。這是刻意的設計：就算呼叫端不小心多塞了
 * 一個含 token 的欄位進來，也不會被寫進 log。
 */
export function formatLogLine(fields: RelayLogFields, timestamp: string): string {
  const out: Record<string, unknown> = { timestamp }
  const keys: (keyof RelayLogFields)[] = [
    'requestId',
    'method',
    'host',
    'path',
    'status',
    'durationMs',
    'result',
    'errorCode',
    'headerNames',
  ]
  for (const key of keys) {
    const value = fields[key]
    if (value !== undefined) out[key] = value
  }
  return JSON.stringify(out)
}

export interface Logger {
  log(fields: RelayLogFields): void
}

export function createLogger(
  sink: (line: string) => void = (line) => console.log(line),
  now: () => Date = () => new Date(),
): Logger {
  return {
    log(fields) {
      sink(formatLogLine(fields, now().toISOString()))
    },
  }
}
