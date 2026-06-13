import { afterEach, describe, expect, it, vi } from 'vitest'

import { computeBackoffMs, RetryScheduler } from '../src/scheduler'

describe('computeBackoffMs', () => {
  it('honors a non-null suggested value verbatim (e.g. Retry-After)', () => {
    expect(computeBackoffMs(7, 12_345)).toBe(12_345)
    expect(computeBackoffMs(0, 0)).toBe(0)
  })

  it('uses exponential + full jitter when no suggestion', () => {
    // attempt=2 → exp = 2_000 * 4 = 8_000 → range [0, 8000)
    const v = computeBackoffMs(2, null, () => 0.999_999)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(8_000)
  })

  it('caps at 60s', () => {
    const v = computeBackoffMs(20, null, () => 0.999_999)
    expect(v).toBeLessThan(60_000)
  })
})

describe('RetryScheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drains tasks at their nextRetryAt with fake timers', async () => {
    vi.useFakeTimers()
    let now = 1_000_000
    const due: string[] = []
    const sched = new RetryScheduler({
      clock: () => now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onDue: (id) => {
        due.push(id)
      }
    })
    sched.enqueue('a', 1_000_500)
    sched.enqueue('b', 1_000_300)
    sched.enqueue('c', 1_000_700)
    expect(sched.size()).toBe(3)

    now = 1_000_300
    await vi.advanceTimersByTimeAsync(0)
    await sched.tick()
    expect(due).toEqual(['b'])

    now = 1_000_500
    await sched.tick()
    expect(due).toEqual(['b', 'a'])

    now = 1_000_700
    await sched.tick()
    expect(due).toEqual(['b', 'a', 'c'])
    expect(sched.size()).toBe(0)
  })

  it('re-enqueues a task on handler error so the next tick retries', async () => {
    let now = 0
    let throws = true
    const due: string[] = []
    const sched = new RetryScheduler({
      clock: () => now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      onDue: (id) => {
        if (throws) {
          throws = false
          throw new Error('boom')
        }
        due.push(id)
      }
    })
    sched.enqueue('a', 100)
    now = 200
    await sched.tick()
    expect(sched.size()).toBe(1)
    now = 1_500
    await sched.tick()
    expect(due).toEqual(['a'])
    expect(sched.size()).toBe(0)
  })

  it('remove() drops a pending task', () => {
    const sched = new RetryScheduler({ onDue: () => {} })
    sched.enqueue('a', Date.now() + 1_000_000)
    expect(sched.remove('a')).toBe(true)
    expect(sched.remove('a')).toBe(false)
    sched.stop()
  })
})
