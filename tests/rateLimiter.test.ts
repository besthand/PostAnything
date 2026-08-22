import { describe, it, expect } from 'vitest'
import { InMemoryRateLimiter, unlimitedRateLimiter } from '../src/core/rateLimiter.js'

const makeClock = (start = 1_000_000) => {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('InMemoryRateLimiter', () => {
  it('在額度內放行並回報剩餘次數', async () => {
    const clock = makeClock()
    const limiter = new InMemoryRateLimiter({ max: 3, windowMs: 60_000, now: clock.now })

    expect(await limiter.consume('ip-1')).toMatchObject({ allowed: true, remaining: 2 })
    expect(await limiter.consume('ip-1')).toMatchObject({ allowed: true, remaining: 1 })
    expect(await limiter.consume('ip-1')).toMatchObject({ allowed: true, remaining: 0 })
  })

  it('超過額度後拒絕', async () => {
    const clock = makeClock()
    const limiter = new InMemoryRateLimiter({ max: 2, windowMs: 60_000, now: clock.now })
    await limiter.consume('ip-1')
    await limiter.consume('ip-1')
    expect(await limiter.consume('ip-1')).toMatchObject({ allowed: false, remaining: 0 })
  })

  it('不同 key 各自計數', async () => {
    const clock = makeClock()
    const limiter = new InMemoryRateLimiter({ max: 1, windowMs: 60_000, now: clock.now })
    expect((await limiter.consume('ip-1')).allowed).toBe(true)
    expect((await limiter.consume('ip-2')).allowed).toBe(true)
    expect((await limiter.consume('ip-1')).allowed).toBe(false)
  })

  it('視窗過期後重置', async () => {
    const clock = makeClock()
    const limiter = new InMemoryRateLimiter({ max: 1, windowMs: 60_000, now: clock.now })
    await limiter.consume('ip-1')
    expect((await limiter.consume('ip-1')).allowed).toBe(false)
    clock.advance(60_001)
    expect((await limiter.consume('ip-1')).allowed).toBe(true)
  })

  it('回報的 resetAt 是本視窗結束時間', async () => {
    const clock = makeClock(1_000_000)
    const limiter = new InMemoryRateLimiter({ max: 5, windowMs: 60_000, now: clock.now })
    expect((await limiter.consume('ip-1')).resetAt).toBe(1_060_000)
  })

  it('過期的 key 會被清掉，不會無限成長', async () => {
    const clock = makeClock()
    const limiter = new InMemoryRateLimiter({ max: 5, windowMs: 1_000, now: clock.now })
    for (let i = 0; i < 100; i += 1) await limiter.consume(`ip-${i}`)
    clock.advance(2_000)
    await limiter.consume('ip-final')
    expect(limiter.size).toBe(1)
  })
})

describe('unlimitedRateLimiter', () => {
  it('永遠放行', async () => {
    expect((await unlimitedRateLimiter.consume('anything')).allowed).toBe(true)
  })
})
