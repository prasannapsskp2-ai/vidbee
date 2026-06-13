import { describe, expect, it } from 'vitest'

import { Scheduler } from '../src/scheduler'
import type { Task } from '../src/types'
import { makeTask } from './_fixtures'

interface Harness {
  scheduler: Scheduler
  store: Map<string, Task>
  /** taskIds dispatched, in order. */
  dispatched: string[]
  /** taskIds we issue completions for, simulating finish. */
  complete: (id: string) => Promise<void>
}

function makeHarness(opts: {
  maxConcurrency?: number
  defaultMaxPerGroup?: number | null
  failingDispatch?: Set<string>
}): Harness {
  const store = new Map<string, Task>()
  const dispatched: string[] = []
  const scheduler = new Scheduler({
    maxConcurrency: opts.maxConcurrency ?? 2,
    defaultMaxPerGroup: opts.defaultMaxPerGroup ?? null,
    getTask: (id) => store.get(id),
    dispatch: (id) => {
      if (opts.failingDispatch?.has(id)) return false
      dispatched.push(id)
      return true
    },
    demote: (_id) => {}
  })
  return {
    scheduler,
    store,
    dispatched,
    complete: async (id: string) => {
      await scheduler.releaseSlot(id)
    }
  }
}

describe('Scheduler', () => {
  it('respects priority then FIFO', async () => {
    const h = makeHarness({ maxConcurrency: 1 })
    for (let i = 0; i < 4; i++) {
      const t = makeTask({
        id: `t${i}`,
        priority: (i === 2 ? 0 : 10) as Task['priority']
      })
      h.store.set(t.id, t)
    }
    // t0 enqueues into an empty heap with the slot free → dispatches immediately.
    // t1/t2/t3 wait until t0 finishes; among the queued, t2 (priority 0) wins.
    await h.scheduler.enqueue('t0', 10)
    await h.scheduler.enqueue('t1', 10)
    await h.scheduler.enqueue('t2', 0)
    await h.scheduler.enqueue('t3', 10)

    // Drain — h.complete awaits releaseSlot which now awaits tryDispatch,
    // so dispatched[i] is filled in by the time we read it.
    await h.complete(h.dispatched[0]!)
    await h.complete(h.dispatched[1]!)
    await h.complete(h.dispatched[2]!)
    await h.complete(h.dispatched[3]!)

    expect(h.dispatched).toEqual(['t0', 't2', 't1', 't3'])
  })

  it('honors the global concurrency cap', async () => {
    const h = makeHarness({ maxConcurrency: 2 })
    for (let i = 0; i < 5; i++) {
      const t = makeTask({ id: `t${i}` })
      h.store.set(t.id, t)
    }
    for (let i = 0; i < 5; i++) await h.scheduler.enqueue(`t${i}`, 0)
    expect(h.dispatched).toHaveLength(2)
    expect(h.scheduler.stats().running).toBe(2)
    expect(h.scheduler.stats().queued).toBe(3)

    await h.complete(h.dispatched[0]!)
    expect(h.dispatched).toHaveLength(3)
  })

  it('honors per-group caps (subscription throttle)', async () => {
    const h = makeHarness({ maxConcurrency: 4 })
    for (let i = 0; i < 4; i++) {
      const t = makeTask({ id: `g${i}`, groupKey: 'sub:foo' })
      h.store.set(t.id, t)
    }
    await h.scheduler.setMaxPerGroup('sub:foo', 1)
    for (let i = 0; i < 4; i++) await h.scheduler.enqueue(`g${i}`, 0)
    expect(h.dispatched).toHaveLength(1)

    await h.complete(h.dispatched[0]!)
    expect(h.dispatched).toHaveLength(2)
  })

  it('1000 concurrent enqueues never over- or under-dispatch', async () => {
    const h = makeHarness({ maxConcurrency: 8 })
    const N = 1000
    for (let i = 0; i < N; i++) {
      h.store.set(`x${i}`, makeTask({ id: `x${i}` }))
    }
    // Enqueue in parallel — the AsyncMutex must serialize slot accounting.
    await Promise.all(
      Array.from({ length: N }, (_, i) => h.scheduler.enqueue(`x${i}`, 0))
    )

    // Drain by completing 8 at a time until the heap is empty.
    let drained = 0
    while (drained < N) {
      const inflight = [...h.dispatched.slice(drained, drained + 8)]
      if (inflight.length === 0) break
      for (const id of inflight) await h.complete(id)
      drained += inflight.length
    }
    expect(h.dispatched).toHaveLength(N)
    // No duplicates.
    expect(new Set(h.dispatched).size).toBe(N)
  })

  it('setMaxConcurrency lower demotes lowest-priority running tasks', async () => {
    const demoted: string[] = []
    const store = new Map<string, Task>()
    const dispatched: string[] = []
    const scheduler = new Scheduler({
      maxConcurrency: 3,
      getTask: (id) => store.get(id),
      dispatch: (id) => {
        dispatched.push(id)
        return true
      },
      demote: (id) => {
        demoted.push(id)
      }
    })
    store.set('hi', makeTask({ id: 'hi', priority: 0 }))
    store.set('mid', makeTask({ id: 'mid', priority: 10 }))
    store.set('lo', makeTask({ id: 'lo', priority: 20 }))
    await scheduler.enqueue('hi', 0)
    await scheduler.enqueue('mid', 10)
    await scheduler.enqueue('lo', 20)
    expect(scheduler.stats().running).toBe(3)

    await scheduler.setMaxConcurrency(2)
    expect(demoted).toEqual(['lo'])
  })

  it('failing dispatch releases the slot for re-use', async () => {
    const h = makeHarness({
      maxConcurrency: 1,
      failingDispatch: new Set(['boom'])
    })
    h.store.set('boom', makeTask({ id: 'boom' }))
    h.store.set('next', makeTask({ id: 'next' }))
    await h.scheduler.enqueue('boom', 0)
    await h.scheduler.enqueue('next', 0)
    expect(h.dispatched).toContain('next')
  })
})
