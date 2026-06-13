import { describe, expect, it } from 'vitest'

import { TaskStore } from '../src/store'
import { makeTask } from './_fixtures'

describe('TaskStore', () => {
  it('insert/get/list', () => {
    const store = new TaskStore()
    const a = makeTask({ id: 'a', groupKey: 'g1' })
    const b = makeTask({ id: 'b', groupKey: 'g1' })
    const c = makeTask({ id: 'c', groupKey: 'g2', status: 'completed' })
    store.insert(a)
    store.insert(b)
    store.insert(c)
    expect(store.get('a')!.id).toBe('a')
    expect(store.list({ groupKey: 'g1' }).tasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(store.list({ status: 'completed' }).tasks.map((t) => t.id)).toEqual(['c'])
  })

  it('update maintains status/group indexes', () => {
    const store = new TaskStore()
    const t = makeTask({ id: 'x', status: 'queued', groupKey: 'g1' })
    store.insert(t)
    store.update({ ...t, status: 'completed', groupKey: 'g2' })
    expect(store.list({ status: 'queued' }).tasks).toHaveLength(0)
    expect(store.list({ groupKey: 'g1' }).tasks).toHaveLength(0)
    expect(store.list({ status: 'completed' }).tasks).toHaveLength(1)
    expect(store.list({ groupKey: 'g2' }).tasks).toHaveLength(1)
  })

  it('paginates with cursor', () => {
    const store = new TaskStore()
    for (let i = 0; i < 5; i++) {
      store.insert(makeTask({ id: `t${i}`, createdAt: 1000 + i }))
    }
    const page1 = store.list({ limit: 2 })
    expect(page1.tasks.map((t) => t.id)).toEqual(['t0', 't1'])
    expect(page1.nextCursor).toBe('t1')
    const page2 = store.list({ limit: 2, cursor: page1.nextCursor })
    expect(page2.tasks.map((t) => t.id)).toEqual(['t2', 't3'])
    const page3 = store.list({ limit: 2, cursor: page2.nextCursor })
    expect(page3.tasks.map((t) => t.id)).toEqual(['t4'])
    expect(page3.nextCursor).toBeNull()
  })

  it('rejects duplicate insert', () => {
    const store = new TaskStore()
    store.insert(makeTask({ id: 'x' }))
    expect(() => store.insert(makeTask({ id: 'x' }))).toThrow()
  })

  it('stats counts by status', () => {
    const store = new TaskStore()
    store.insert(makeTask({ id: 'a', status: 'queued' }))
    store.insert(makeTask({ id: 'b', status: 'completed' }))
    store.insert(makeTask({ id: 'c', status: 'completed' }))
    const s = store.stats(8)
    expect(s.byStatus.queued).toBe(1)
    expect(s.byStatus.completed).toBe(2)
    expect(s.total).toBe(3)
    expect(s.capacity).toBe(8)
  })
})
