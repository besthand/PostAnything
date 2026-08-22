import { handle } from '@hono/node-server/vercel'
import { Hono } from 'hono'
import { createApp } from '../../core/app.js'
import { loadConfig } from '../../core/config.js'
import { createLogger } from '../../core/logger.js'
import { InMemoryRateLimiter } from '../../core/rateLimiter.js'
import { createNodeDnsResolver } from '../node/dnsResolver.js'
import { createPinnedHttpClient } from '../node/pinnedFetch.js'

/**
 * Vercel 跑 Node.js Serverless Function（非 Edge），所以直接重用 Node adapter：
 * 完整 DNS 解析 + IP pinning，SSRF 保護與 Docker 部署一致。
 * 記憶體版 rate limiter 在 serverless 只涵蓋單一 instance，
 * 真正的限流請設 Vercel Firewall（README 有說明）。
 */
export function createRelayApp(env: Record<string, string | undefined> = process.env): Hono {
  const config = loadConfig(env)

  return createApp({
    config,
    resolver: createNodeDnsResolver(),
    httpClient: createPinnedHttpClient(),
    rateLimiter: new InMemoryRateLimiter({
      max: config.rateLimitMax,
      windowMs: config.rateLimitWindowMs,
    }),
    logger: createLogger(),
  })
}

// createRelayApp() 讀 process.env（含 RELAY_TOKEN），必須延遲到第一個真正的
// request 才建立 —— 否則單純 import 這個檔案（例如測試、bundler 分析）在還
// 沒注入環境變數時就會直接丟出設定錯誤。
let lazyApp: Hono | undefined
const entry = new Hono()
entry.all('*', (c) => {
  lazyApp ??= createRelayApp()
  return lazyApp.fetch(c.req.raw)
})

export default handle(entry)
