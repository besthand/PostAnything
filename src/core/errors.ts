export type RelayErrorCode =
  | 'INVALID_RELAY_TOKEN'
  | 'METHOD_NOT_ALLOWED'
  | 'HOST_NOT_ALLOWED'
  | 'INVALID_URL'
  | 'SSRF_BLOCKED'
  | 'INVALID_HEADER'
  | 'REQUEST_TOO_LARGE'
  | 'RESPONSE_TOO_LARGE'
  | 'DNS_LOOKUP_FAILED'
  | 'TARGET_TIMEOUT'
  | 'TARGET_CONNECTION_FAILED'
  | 'INVALID_JSON'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

const STATUS: Record<RelayErrorCode, number> = {
  INVALID_RELAY_TOKEN: 401,
  METHOD_NOT_ALLOWED: 400,
  HOST_NOT_ALLOWED: 403,
  INVALID_URL: 400,
  SSRF_BLOCKED: 403,
  INVALID_HEADER: 400,
  REQUEST_TOO_LARGE: 413,
  RESPONSE_TOO_LARGE: 502,
  DNS_LOOKUP_FAILED: 502,
  TARGET_TIMEOUT: 504,
  TARGET_CONNECTION_FAILED: 502,
  INVALID_JSON: 400,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

export class RelayError extends Error {
  readonly code: RelayErrorCode

  constructor(code: RelayErrorCode, message: string) {
    super(message)
    this.name = 'RelayError'
    this.code = code
  }
}

export function statusForCode(code: RelayErrorCode): number {
  return STATUS[code]
}

export interface RelayErrorBody {
  success: false
  requestId: string
  error: { code: RelayErrorCode; message: string }
}

/**
 * 把任意 throw 出來的東西轉成對外的錯誤 Response。
 * 非 RelayError 一律折成 INTERNAL_ERROR，原始訊息不外洩
 * （可能含 token、內部路徑、目標 IP）。
 */
export function toErrorBody(
  err: unknown,
  requestId: string,
): { status: number; body: RelayErrorBody } {
  const relayError =
    err instanceof RelayError
      ? err
      : new RelayError('INTERNAL_ERROR', 'Relay encountered an internal error.')

  return {
    status: statusForCode(relayError.code),
    body: {
      success: false,
      requestId,
      error: { code: relayError.code, message: relayError.message },
    },
  }
}
