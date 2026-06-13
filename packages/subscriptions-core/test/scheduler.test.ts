import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedCheckScheduler } from '../src/scheduler'

const buildScheduler = (overrides: {
  isLeader?: () => boolean
  runAll?: () => Promise<void>
  runOne?: (id: string) => Promise<void>
} = {}) => {
  const calls: { all: number; one: string[] } = { all: 0, one: [] }
  const sched = new FeedCheckScheduler({
    intervalMs: 1_000,
    refreshDedupeWindowMs: 30_000,
    runAll:
      overrides.runAll ??
      (async () => {
        calls.all += 1
      }),
    runOne:
      overrides.runOne ??
      (async (id) => {
        calls.one.push(id)
      }),
    isLeader: overrides.isLeader ?? (() => true)
  })
  return { sched, calls }
}

describe('FeedCheckScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires runAll on each tick when leader', async () => {
    const { sched, calls } = buildScheduler()
    sched.start()
    expect(calls.all).toBe(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.all).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls.all).toBe(2)
    sched.stop()
  })

  it('does not fire runAll when not leader, but re-arms the timer', async () => {
    let leader = false
    const { sched, calls } = buildScheduler({ isLeader: () => leader })
    sched.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.all).toBe(0)

    leader = true
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls.all).toBe(1)
    sched.stop()
  })

  it('triggerNow(id) runs immediately and dedupes within the window', async () => {
    const { sched, calls } = buildScheduler({ isLeader: () => false })
    await sched.triggerNow('sub-1')
    await sched.triggerNow('sub-1')
    expect(calls.one).toEqual(['sub-1'])

    // After the dedupe window we re-trigger.
    vi.setSystemTime(Date.now() + 31_000)
    await sched.triggerNow('sub-1')
    expect(calls.one).toEqual(['sub-1', 'sub-1'])
  })

  it('queues a second runAll if a runAll is already in flight', async () => {
    let resolve!: () => void
    const inflight = new Promise<void>((res) => {
      resolve = res
    })
    let runs = 0
    const { sched } = buildScheduler({
      runAll: async () => {
        runs += 1
        if (runs === 1) {
          await inflight
        }
      }
    })

    void sched.triggerNow()
    void sched.triggerNow()
    expect(runs).toBe(1)

    resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(runs).toBe(2)
  })

  it('exceptions inside runAll do not stop the periodic timer', async () => {
    let count = 0
    const { sched } = buildScheduler({
      runAll: async () => {
        count += 1
        throw new Error('boom')
      }
    })
    sched.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(count).toBeGreaterThanOrEqual(2)
    sched.stop()
  })
})
