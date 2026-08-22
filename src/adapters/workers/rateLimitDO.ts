import type { RateLimiter, RateLimitResult } from '../../core/rateLimiter.js'

interface DurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
  }
}

interface Bucket {
  count: number
  resetAt: number
}

/**
 * Durable Object 計數器：Workers 是多 isolate 的，
 * 記憶體版計數器在這裡毫無意義，必須把狀態放進單一 DO instance。
 */
export class RateLimitCounter {
  readonly #state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.#state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const max = Number(url.searchParams.get('max') ?? '30')
    const windowMs = Number(url.searchParams.get('windowMs') ?? '60000')
    const now = Date.now()

    const stored = await this.#state.storage.get<Bucket>('bucket')
    const bucket: Bucket =
      stored && stored.resetAt > now ? stored : { count: 0, resetAt: now + windowMs }

    if (bucket.count >= max) {
      await this.#state.storage.put('bucket', bucket)
      return Response.json({ allowed: false, remaining: 0, resetAt: bucket.resetAt })
    }

    bucket.count += 1
    await this.#state.storage.put('bucket', bucket)
    return Response.json({ allowed: true, remaining: max - bucket.count, resetAt: bucket.resetAt })
  }
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(request: Request): Promise<Response> }
}

export function createDurableObjectRateLimiter(
  namespace: DurableObjectNamespaceLike,
  max: number,
  windowMs: number,
): RateLimiter {
  return {
    async consume(key: string): Promise<RateLimitResult> {
      const stub = namespace.get(namespace.idFromName(key))
      const response = await stub.fetch(
        new Request(`https://rate-limiter.internal/?max=${max}&windowMs=${windowMs}`),
      )
      return (await response.json()) as RateLimitResult
    },
  }
}
