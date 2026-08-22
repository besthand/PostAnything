import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { createPinnedHttpClient } from '../../src/adapters/node/pinnedFetch.js'
import { RelayError } from '../../src/core/errors.js'
import type { OutboundRequest } from '../../src/core/relay.js'

let server: Server
let port: number

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/slow') {
      setTimeout(() => res.end('too late'), 2000)
      return
    }
    if (url.pathname === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('x'.repeat(50_000))
      return
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1/admin' })
      res.end()
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json', 'x-echo-method': req.method ?? '' })
      res.end(
        JSON.stringify({
          method: req.method,
          path: url.pathname + url.search,
          apiKey: req.headers['x-api-key'] ?? null,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as { port: number }).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const base = (overrides: Partial<OutboundRequest> = {}): OutboundRequest => ({
  method: 'GET',
  url: `http://pinned.test:${port}/hello?a=1`,
  headers: {},
  body: undefined,
  resolvedIps: ['127.0.0.1'],
  timeoutMs: 5000,
  maxResponseBytes: 1_000_000,
  followRedirects: false,
  ...overrides,
})

describe('createPinnedHttpClient', () => {
  it('把連線釘在 resolvedIps 上，即使 hostname 無法解析也送得出去', async () => {
    const client = createPinnedHttpClient()
    const res = await client.send(base())
    expect(res.status).toBe(201)
    expect(JSON.parse(res.body)).toMatchObject({ method: 'GET', path: '/hello?a=1' })
  })

  it('送出自訂 header 與 body', async () => {
    const client = createPinnedHttpClient()
    const res = await client.send(
      base({
        method: 'POST',
        url: `http://pinned.test:${port}/w`,
        headers: { 'x-api-key': 'k123', 'content-type': 'application/json' },
        body: '{"title":"Hello"}',
      }),
    )
    expect(JSON.parse(res.body)).toMatchObject({
      method: 'POST',
      apiKey: 'k123',
      body: '{"title":"Hello"}',
    })
  })

  it('回傳 response header（key 為小寫）', async () => {
    const client = createPinnedHttpClient()
    const res = await client.send(base())
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.headers['x-echo-method']).toBe('GET')
  })

  it('不 follow redirect，直接回 302', async () => {
    const client = createPinnedHttpClient()
    const res = await client.send(base({ url: `http://pinned.test:${port}/redirect` }))
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('http://127.0.0.1/admin')
  })

  it('超過 maxResponseBytes → RESPONSE_TOO_LARGE', async () => {
    const client = createPinnedHttpClient()
    try {
      await client.send(base({ url: `http://pinned.test:${port}/big`, maxResponseBytes: 1000 }))
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayError)
      expect((err as RelayError).code).toBe('RESPONSE_TOO_LARGE')
    }
  })

  it('超過 timeoutMs → TARGET_TIMEOUT', async () => {
    const client = createPinnedHttpClient()
    try {
      await client.send(base({ url: `http://pinned.test:${port}/slow`, timeoutMs: 200 }))
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelayError)
      expect((err as RelayError).code).toBe('TARGET_TIMEOUT')
    }
  })

  it('連不上 → TARGET_CONNECTION_FAILED', async () => {
    const client = createPinnedHttpClient()
    try {
      await client.send(base({ url: 'http://pinned.test:1/nope' }))
      expect.unreachable('should throw')
    } catch (err) {
      expect((err as RelayError).code).toBe('TARGET_CONNECTION_FAILED')
    }
  })
})
