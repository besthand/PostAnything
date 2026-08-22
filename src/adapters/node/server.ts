import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from '../../core/app.js'
import { loadConfig } from '../../core/config.js'
import { createLogger } from '../../core/logger.js'
import { InMemoryRateLimiter } from '../../core/rateLimiter.js'
import { createNodeDnsResolver } from './dnsResolver.js'
import { createPinnedHttpClient } from './pinnedFetch.js'

const config = loadConfig(process.env)

const app = createApp({
  config,
  resolver: createNodeDnsResolver(),
  httpClient: createPinnedHttpClient(),
  rateLimiter: new InMemoryRateLimiter({
    max: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  }),
  logger: createLogger(),
  staticMiddleware: serveStatic({ root: './public' }),
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  // 只印 port，不印任何設定值
  console.log(JSON.stringify({ event: 'listening', port: info.port }))
})
