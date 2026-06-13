import { describe, expect, it } from 'vitest'

import { enqueueDownload } from '../src/download/enqueue'
import type { ContractClient } from '../src/subcommands'
import type { Task } from '@vidbee/task-queue'
import { EMPTY_PROGRESS } from '@vidbee/task-queue'

function task(id: string, status: Task['status']): Task {
  return {
    id,
    kind: 'yt-dlp-forward',
    parentId: null,
    input: { url: 'https://x', kind: 'yt-dlp-forward' },
    priority: 0,
    groupKey: 'x',
    status,
    prevStatus: null,
    statusReason: null,
    enteredStatusAt: 0,
    attempt: 0,
    maxAttempts: 5,
    nextRetryAt: null,
    progress: { ...EMPTY_PROGRESS },
    output: null,
    lastError: null,
    pid: null,
    pidStartedAt: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function client(initial: Task, transitions: Task[] = []): ContractClient {
  let i = 0
  return {
    list: async () => ({ items: [], nextCursor: null }),
    get: async () => transitions[Math.min(i++, transitions.length - 1)] ?? initial,
    stats: async () => ({}),
    removeFromHistory: async () => {},
    add: async () => ({ id: initial.id, task: initial })
  }
}

describe('enqueueDownload', () => {
  it('detached returns immediately', async () => {
    const t = task('a', 'queued')
    const r = await enqueueDownload({
      client: client(t),
      request: { input: { url: 'https://x', kind: 'yt-dlp-forward' } },
      wait: false
    })
    expect(r.kind).toBe('detached')
    if (r.kind === 'detached') expect(r.task.id).toBe('a')
  })

  it('wait resolves to wait-success on completed', async () => {
    const t0 = task('a', 'queued')
    const t1 = task('a', 'running')
    const t2 = task('a', 'completed')
    const r = await enqueueDownload({
      client: client(t0, [t1, t2]),
      request: { input: { url: 'https://x', kind: 'yt-dlp-forward' } },
      wait: true,
      delay: async () => {}
    })
    expect(r.kind).toBe('wait-success')
  })

  it('wait reports retry-scheduled as wait-non-success', async () => {
    const t0 = task('a', 'queued')
    const t1 = task('a', 'retry-scheduled')
    const r = await enqueueDownload({
      client: client(t0, [t1]),
      request: { input: { url: 'https://x', kind: 'yt-dlp-forward' } },
      wait: true,
      delay: async () => {}
    })
    if (r.kind !== 'wait-non-success') throw new Error('expected non-success')
    expect(r.reason).toBe('retry-scheduled')
  })

  it('wait surfaces failed terminal status', async () => {
    const t0 = task('a', 'queued')
    const t1 = task('a', 'failed')
    const r = await enqueueDownload({
      client: client(t0, [t1]),
      request: { input: { url: 'https://x', kind: 'yt-dlp-forward' } },
      wait: true,
      delay: async () => {}
    })
    if (r.kind !== 'wait-non-success') throw new Error('expected non-success')
    expect(r.reason).toBe('failed')
  })

  it('throws when transport lacks add()', async () => {
    const c: ContractClient = {
      list: async () => ({ items: [], nextCursor: null }),
      get: async () => task('a', 'queued'),
      stats: async () => ({}),
      removeFromHistory: async () => {}
    }
    await expect(
      enqueueDownload({
        client: c,
        request: { input: { url: 'https://x', kind: 'yt-dlp-forward' } },
        wait: false
      })
    ).rejects.toThrow(/transport.*add/)
  })
})
