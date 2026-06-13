import { describe, expect, it } from 'vitest'

import {
  IllegalTransitionError,
  isLegalTransition,
  LEGAL_TRANSITIONS,
  transition
} from '../src/fsm'
import type { TaskOutput, TaskStatus } from '../src/types'
import { TERMINAL_STATUSES } from '../src/types'
import { makeTask } from './_fixtures'

const ALL_STATUSES: TaskStatus[] = [
  'queued',
  'running',
  'processing',
  'paused',
  'retry-scheduled',
  'completed',
  'failed',
  'cancelled'
]

describe('TaskFSM transition table (design §3.1)', () => {
  it('legality table matches the design doc one-for-one', () => {
    const expected: Record<TaskStatus, ReadonlyArray<TaskStatus>> = {
      queued: ['running', 'paused', 'cancelled'],
      running: [
        'processing',
        'completed',
        'retry-scheduled',
        'failed',
        'paused',
        'cancelled'
      ],
      processing: [
        'completed',
        'retry-scheduled',
        'failed',
        'paused',
        'cancelled'
      ],
      paused: ['queued', 'cancelled', 'failed'],
      'retry-scheduled': ['queued', 'paused', 'cancelled'],
      failed: ['queued'],
      cancelled: ['queued'],
      completed: []
    }
    for (const [from, tos] of Object.entries(expected)) {
      const set = LEGAL_TRANSITIONS[from as TaskStatus]
      expect([...set].sort()).toEqual([...tos].sort())
    }
  })

  it('every illegal From→To combo throws IllegalTransitionError', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue
        if (isLegalTransition(from, to)) continue
        const task = makeTask({ status: from })
        expect(() =>
          transition(task, to, { trigger: 'fail' })
        ).toThrowError(IllegalTransitionError)
      }
    }
  })

  it('terminal `completed` has no outgoing transitions', () => {
    const t = makeTask({ status: 'completed' })
    for (const to of ALL_STATUSES) {
      if (to === 'completed') continue
      expect(() => transition(t, to, { trigger: 'fail' })).toThrow()
    }
  })

  it('completed requires output.size > 0 (design §3.1 guard)', () => {
    const t = makeTask({ status: 'running' })
    const zero: TaskOutput = {
      filePath: '/tmp/x.mp4',
      size: 0,
      durationMs: null,
      sha256: null
    }
    expect(() =>
      transition(t, 'completed', { trigger: 'finalize-success', output: zero })
    ).toThrow(IllegalTransitionError)

    const ok: TaskOutput = { ...zero, size: 1024 }
    const next = transition(t, 'completed', {
      trigger: 'finalize-success',
      output: ok
    })
    expect(next.status).toBe('completed')
    expect(next.output).toEqual(ok)
    expect(next.pid).toBeNull()
  })

  it('queued → running on the first dispatch sets attempt to 1', () => {
    const t = makeTask({ status: 'queued', attempt: 0 })
    const next = transition(t, 'running', { trigger: 'dispatch' })
    expect(next.status).toBe('running')
    expect(next.attempt).toBe(1)
  })

  it('retry-scheduled → queued via tick increments attempt', () => {
    const t = makeTask({
      status: 'retry-scheduled',
      attempt: 2,
      nextRetryAt: 1
    })
    const next = transition(t, 'queued', { trigger: 'retry-tick' })
    expect(next.attempt).toBe(3)
    expect(next.nextRetryAt).toBeNull()
  })

  it('failed → queued via manual retry resets attempt to 0', () => {
    const t = makeTask({ status: 'failed', attempt: 3 })
    const next = transition(t, 'queued', { trigger: 'retry-manual' })
    expect(next.attempt).toBe(0)
    expect(next.lastError).toBeNull()
  })

  it('retry-scheduled → retry-scheduled requires nextRetryAt', () => {
    const t = makeTask({ status: 'running' })
    expect(() =>
      transition(t, 'retry-scheduled', {
        trigger: 'finalize-error'
      })
    ).toThrow()
    const next = transition(t, 'retry-scheduled', {
      trigger: 'finalize-error',
      nextRetryAt: 1_700_000_010_000
    })
    expect(next.status).toBe('retry-scheduled')
    expect(next.nextRetryAt).toBe(1_700_000_010_000)
  })

  it('terminal statuses block writes (assert no leak through transition)', () => {
    for (const term of TERMINAL_STATUSES) {
      const t = makeTask({ status: term })
      // Self-transition is illegal except via the explicit failed→queued/
      // cancelled→queued paths (already covered by legality table).
      for (const to of ALL_STATUSES) {
        if (isLegalTransition(term, to)) continue
        if (to === term) continue
        expect(() =>
          transition(t, to, { trigger: 'cancel' })
        ).toThrow(IllegalTransitionError)
      }
    }
  })
})
