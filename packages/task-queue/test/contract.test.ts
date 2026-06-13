import { describe, expect, it } from 'vitest'

import { taskQueueContract } from '../src/contract'
import {
  AddInputSchema,
  TaskInputSchema,
  TaskSchema,
  TaskStatusSchema
} from '../src/schemas'

describe('taskQueueContract', () => {
  it('exposes the routes that adapters must implement', () => {
    const expected = [
      'add',
      'get',
      'list',
      'cancel',
      'pause',
      'resume',
      'retry',
      'setMaxConcurrency',
      'setMaxPerGroup',
      'removeFromHistory',
      'stats'
    ]
    expect(Object.keys(taskQueueContract).sort()).toEqual(expected.sort())
  })
})

describe('schemas', () => {
  it('TaskInput accepts a minimal payload', () => {
    const parsed = TaskInputSchema.parse({
      url: 'https://e.com/v',
      kind: 'video'
    })
    expect(parsed.kind).toBe('video')
  })

  it('TaskStatus enumerates exactly the 8 design statuses', () => {
    const expected = [
      'queued',
      'running',
      'processing',
      'paused',
      'retry-scheduled',
      'completed',
      'failed',
      'cancelled'
    ]
    for (const s of expected) {
      expect(() => TaskStatusSchema.parse(s)).not.toThrow()
    }
    expect(() => TaskStatusSchema.parse('downloading')).toThrow()
  })

  it('AddInput requires a kind on the inner input', () => {
    const r = AddInputSchema.safeParse({ input: { url: 'https://e.com' } })
    expect(r.success).toBe(false)
  })

  it('Task allows null parentId/output/lastError', () => {
    const t = {
      id: 'x',
      kind: 'video' as const,
      parentId: null,
      input: { url: 'https://e.com', kind: 'video' as const },
      priority: 0 as const,
      groupKey: 'e.com',
      status: 'queued' as const,
      prevStatus: null,
      statusReason: null,
      enteredStatusAt: 1,
      attempt: 0,
      maxAttempts: 5,
      nextRetryAt: null,
      progress: {
        percent: null,
        bytesDownloaded: null,
        bytesTotal: null,
        speedBps: null,
        etaMs: null,
        ticks: 0
      },
      output: null,
      lastError: null,
      pid: null,
      pidStartedAt: null,
      createdAt: 1,
      updatedAt: 1
    }
    expect(() => TaskSchema.parse(t)).not.toThrow()
  })
})
