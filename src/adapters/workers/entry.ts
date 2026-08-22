import { createApp } from '../../core/app.js'
import { loadConfig } from '../../core/config.js'
import { createLogger } from '../../core/logger.js'
import { createDohResolver } from './dohResolver.js'
import { createDurableObjectRateLimiter } from './rateLimitDO.js'
import { createWorkersHttpClient } from './workersFetch.js'

export { RateLimitCounter } from './rateLimitDO.js'

interface Env {
  [key: string]: unknown
  RATE_LIMITER?: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Promise<Response> }
  }
}

const toStringEnv = (env: Env): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = loadConfig(toStringEnv(env))

    const rateLimiter = env.RATE_LIMITER
      ? createDurableObjectRateLimiter(env.RATE_LIMITER, config.rateLimitMax, config.rateLimitWindowMs)
      : { consume: async () => ({ allowed: true, remaining: 0, resetAt: 0 }) }

    const app = createApp({
      config,
      resolver: createDohResolver(config.dohEndpoint),
      httpClient: createWorkersHttpClient(),
      rateLimiter,
      logger: createLogger(),
    })

    return app.fetch(request)
  },
}
