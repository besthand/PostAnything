import { Hono } from 'hono'
import { buildEcho } from './echo.js'
import { RelayError, toErrorBody } from './errors.js'
import { handleRelay, type RelayDeps } from './relay.js'
import { newRequestId } from './requestId.js'

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

export interface AppDeps extends RelayDeps {
  generateRequestId?: () => string
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** rate limit 的分組鍵。取不到來源 IP 時退回固定值，寧可嚴格也不要不限流。 */
export function clientKeyFrom(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return (forwarded.split(',')[0] as string).trim()
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  const generateRequestId = deps.generateRequestId ?? newRequestId

  app.use('*', async (c, next) => {
    c.set('requestId', generateRequestId())
    await next()
    c.header('content-security-policy', CSP)
    c.header('x-content-type-options', 'nosniff')
    c.header('referrer-policy', 'no-referrer')
    c.header('x-frame-options', 'DENY')
    c.header('x-request-id', c.get('requestId'))
  })

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.post('/api/relay', async (c) => {
    const requestId = c.get('requestId')

    // 先看 Content-Length，避免超大 body 被完整讀進記憶體
    const declaredLength = Number(c.req.header('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > deps.config.maxRequestBodyBytes) {
      throw new RelayError(
        'REQUEST_TOO_LARGE',
        `Request body exceeds the ${deps.config.maxRequestBodyBytes} byte limit.`,
      )
    }

    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      throw new RelayError('INVALID_JSON', 'Request body is not valid JSON.')
    }

    const result = await handleRelay(
      {
        authorization: c.req.header('authorization'),
        payload,
        clientKey: clientKeyFrom(c.req.raw),
        requestId,
      },
      deps,
    )
    return c.json(result)
  })

  app.all('/api/echo', async (c) => c.json(await buildEcho(c.req.raw)))

  app.notFound((c) =>
    c.json(
      {
        success: false,
        requestId: c.get('requestId') ?? 'req_unknown',
        error: { code: 'INVALID_URL', message: 'No such relay endpoint.' },
      },
      404,
    ),
  )

  app.onError((err, c) => {
    const requestId = c.get('requestId') ?? 'req_unknown'
    const { status, body } = toErrorBody(err, requestId)
    return c.json(body, status as 400)
  })

  return app
}
