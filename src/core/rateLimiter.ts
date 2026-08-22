export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** 本視窗結束的 epoch 毫秒 */
  resetAt: number
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>
}

export interface InMemoryRateLimiterOptions {
  max: number
  windowMs: number
  now?: () => number
}

interface Bucket {
  count: number
  resetAt: number
}

/**
 * 固定視窗計數器。這是 defense-in-depth，不是主防線 —
 * 多 instance 部署時各自計數，主要限流應交給 Cloudflare Rate Limiting
 * 或 Vercel Firewall（requirement.md §38）。
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #max: number
  readonly #windowMs: number
  readonly #now: () => number
  readonly #buckets = new Map<string, Bucket>()

  constructor(options: InMemoryRateLimiterOptions) {
    this.#max = options.max
    this.#windowMs = options.windowMs
    this.#now = options.now ?? (() => Date.now())
  }

  get size(): number {
    return this.#buckets.size
  }

  async consume(key: string): Promise<RateLimitResult> {
    const now = this.#now()
    this.#sweep(now)

    const existing = this.#buckets.get(key)
    const bucket: Bucket =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + this.#windowMs }

    if (bucket.count >= this.#max) {
      this.#buckets.set(key, bucket)
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt }
    }

    bucket.count += 1
    this.#buckets.set(key, bucket)
    return { allowed: true, remaining: this.#max - bucket.count, resetAt: bucket.resetAt }
  }

  /** 清掉過期 bucket，避免長駐 process 記憶體無限成長。 */
  #sweep(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key)
    }
  }
}

/** 給「限流交由平台層處理」的部署使用。 */
export const unlimitedRateLimiter: RateLimiter = {
  async consume(): Promise<RateLimitResult> {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAt: 0 }
  },
}
