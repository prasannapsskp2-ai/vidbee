/**
 * Download enqueue + optional wait-for-terminal-state. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §4.4, §6.1
 *
 * Behavior:
 *   - `--vidbee-detach` (default) returns immediately after `add()` with the
 *     queued task, exit 0.
 *   - `--vidbee-wait` polls `get(id)` until the task reaches a terminal
 *     state. Successful → exit 0; failed/retry-scheduled/cancelled → exit 1.
 *
 * Polling cadence: 200ms while running, 1s while paused/retry-scheduled.
 * The contract doesn't yet expose a per-task event subscription that we
 * could await directly, so we poll. Phase B+ work could swap this for the
 * SSE stream available at `/automation/v1/events`.
 */

import type { Task, AddTaskRequest } from '@vidbee/task-queue'
import { TERMINAL_STATUSES } from '@vidbee/task-queue'

import type { ContractClient } from '../subcommands'

export interface EnqueueOptions {
  client: ContractClient
  request: AddTaskRequest
  wait: boolean
  /** Total wait budget; null = unlimited (until terminal). */
  waitTimeoutMs?: number | null
  /** Test seam. */
  clock?: () => number
  delay?: (ms: number) => Promise<void>
  pollFastMs?: number
  pollSlowMs?: number
}

export type EnqueueResult =
  | { kind: 'detached'; task: Task }
  | { kind: 'wait-success'; task: Task }
  | { kind: 'wait-non-success'; task: Task; reason: 'failed' | 'cancelled' | 'retry-scheduled' | 'paused' | 'timeout' }

const defaultDelay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function enqueueDownload(opts: EnqueueOptions): Promise<EnqueueResult> {
  if (!opts.client.add) {
    throw new Error('transport does not support add()')
  }
  const created = await opts.client.add(opts.request)
  let task: Task = created.task
  if (!opts.wait) return { kind: 'detached', task }

  const clock = opts.clock ?? Date.now
  const delay = opts.delay ?? defaultDelay
  const fast = opts.pollFastMs ?? 200
  const slow = opts.pollSlowMs ?? 1_000
  const start = clock()
  const budget = opts.waitTimeoutMs ?? null

  while (true) {
    if (TERMINAL_STATUSES.has(task.status)) {
      return task.status === 'completed'
        ? { kind: 'wait-success', task }
        : { kind: 'wait-non-success', task, reason: task.status as 'failed' | 'cancelled' }
    }
    // §4.4 example: --vidbee-wait surfaces retry-scheduled as exit 1
    // immediately rather than waiting for the next attempt to fire.
    if (task.status === 'retry-scheduled' || task.status === 'paused') {
      return { kind: 'wait-non-success', task, reason: task.status }
    }
    if (budget !== null && clock() - start >= budget) {
      return { kind: 'wait-non-success', task, reason: 'timeout' }
    }
    const interval = task.status === 'queued' ? slow : fast
    await delay(interval)
    task = await opts.client.get(task.id)
  }
}
