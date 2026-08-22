// 純函式模組：沒有 DOM 依賴，方便單元測試，也讓 app.js 只負責接線。
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'x-api-key']

export function rowsToObject(rows) {
  const out = {}
  for (const row of rows) {
    const key = String(row.key ?? '').trim()
    if (key === '') continue
    out[key] = String(row.value ?? '').trim()
  }
  return out
}

export function buildPayload(input) {
  const payload = {
    method: String(input.method).trim().toUpperCase(),
    url: String(input.url).trim(),
    query: rowsToObject(input.queryRows),
    headers: rowsToObject(input.headerRows),
    bodyType: input.bodyType,
  }

  if (input.bodyType === 'json' || input.bodyType === 'raw') {
    payload.body = input.bodyText
  } else if (input.bodyType === 'form') {
    payload.body = rowsToObject(input.formRows)
  }

  return payload
}

export function formatResponseText(json) {
  if (json && json.success === true) {
    const headerLines = Object.entries(json.response.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n')

    return [
      'STATUS: SUCCESS',
      '',
      `REQUEST_ID: ${json.requestId}`,
      '',
      `HTTP_STATUS: ${json.response.status}`,
      '',
      `HTTP_STATUS_TEXT: ${json.response.statusText}`,
      '',
      'RESPONSE_HEADERS:',
      headerLines === '' ? '(none)' : headerLines,
      '',
      'RESPONSE_BODY:',
      json.response.body === '' ? '(empty)' : json.response.body,
      '',
    ].join('\n')
  }

  const error = (json && json.error) || { code: 'INTERNAL_ERROR', message: 'Unknown error.' }
  return [
    'STATUS: ERROR',
    '',
    `REQUEST_ID: ${(json && json.requestId) || '(none)'}`,
    '',
    `ERROR_CODE: ${error.code}`,
    '',
    'MESSAGE:',
    error.message,
    '',
  ].join('\n')
}

export function formatRequestPreview(payload) {
  const url = new URL(payload.url || 'https://example.invalid/')
  for (const [key, value] of Object.entries(payload.query)) url.searchParams.append(key, value)

  const headerLines = Object.entries(payload.headers).map(([name, value]) =>
    SENSITIVE_HEADERS.includes(name.toLowerCase())
      ? `${name}: ********`
      : `${name}: ${value}`,
  )

  let bodyText = '(none)'
  if (payload.bodyType === 'json' || payload.bodyType === 'raw') {
    bodyText = payload.body || '(empty)'
  } else if (payload.bodyType === 'form') {
    bodyText = new URLSearchParams(payload.body).toString() || '(empty)'
  }

  return [
    `${payload.method} ${url.toString()}`,
    '',
    headerLines.length === 0 ? '(no custom headers)' : headerLines.join('\n'),
    '',
    bodyText,
    '',
  ].join('\n')
}
