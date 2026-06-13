/**
 * RetryScheduler — owns the heap of `retry-scheduled` tasks ordered by
 * `nextRetryAt`. A single setTimeout is armed for the head of the heap;
 * when it fires, `tick()` releases all due tasks back to `queued` (via the
 * supplied callback into the orchestrator).
 *
 * Reference: docs/vidbee-task-queue-state-machine-design.md §3.1, §7.2.
 */
import { MinHeap } from '../util/min-heap'

/**
 * full-jitter backoff per §7.2 (`base * 2 ** attempt`, capped, then a uniform
 * sample in [0, exp)). When `suggestedMs` is non-null (e.g. http-429
 * Retry-After), we honor it verbatim and skip jitter.
 */
export function computeBackoffMs(
  attempt: number,
  suggestedMs: number | null,
  rng: () => number = Math.random
): number {
  if (suggestedMs != null && suggestedMs >= 0) return suggestedMs
  const base = 2_000
  const cap = 60_000
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt))
  return Math.floor(rng() * exp)
}

interface HeapItem {
  taskId: string
  nextRetryAt: number
  /** monotonic seq breaks tie when two tasks share the same nextRetryAt. */
  seq: number
}

export type Clock = () => number

export interface RetrySchedulerOptions {
  clock?: Clock
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /**
   * Called by `tick()` for each due task. The orchestrator is expected to
   * lock the FSM, transition `retry-scheduled -> queued`, and re-enqueue.
   * If it throws, we keep the task in the heap and the next tick retries.
   */
  onDue: (taskId: string, at: number) => void | Promise<void>
}

export class RetryScheduler {
  private readonly heap = new MinHeap<HeapItem>((a, b) =>
    a.nextRetryAt !== b.nextRetryAt
      ? a.nextRetryAt - b.nextRetryAt
      : a.seq - b.seq
  )
  private timer: unknown = null
  private seqCounter = 0
  private readonly clock: Clock
  private readonly setTimer: NonNullable<RetrySchedulerOptions['setTimer']>
  private readonly clearTimer: NonNullable<RetrySchedulerOptions['clearTimer']>
  private readonly onDue: RetrySchedulerOptions['onDue']

  constructor(opts: RetrySchedulerOptions) {
    this.clock = opts.clock ?? Date.now
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as never))
    this.onDue = opts.onDue
  }

  size(): number {
    return this.heap.size()
  }

  /**
   * Add (or re-add — `enqueue` first removes any existing entry for the same
   * id, since a task can only be retry-scheduled once at a time).
   */
  enqueue(taskId: string, nextRetryAt: number): void {
    this.heap.remove((it) => it.taskId === taskId)
    this.heap.push({ taskId, nextRetryAt, seq: ++this.seqCounter })
    this.rearm()
  }

  remove(taskId: string): boolean {
    const removed = this.heap.remove((it) => it.taskId === taskId)
    this.rearm()
    return removed != null
  }

  /**
   * Drain all items whose nextRetryAt <= now. Public for tests; in production
   * the timer fires this. Bumping a per-item handler error is logged and the
   * handler is retried on the next tick.
   */
  async tick(): Promise<void> {
    const now = this.clock()
    while (true) {
      const top = this.heap.peek()
      if (!top || top.nextRetryAt > now) break
      const item = this.heap.pop()!
      try {
        await this.onDue(item.taskId, now)
      } catch (err) {
        // Re-enqueue so we try again shortly. We bump the time slightly to
        // avoid a hot loop if the orchestrator is in a bad state.
        // eslint-disable-next-line no-console
        console.error('[task-queue] retry tick handler threw', err)
        this.heap.push({
          taskId: item.taskId,
          nextRetryAt: now + 1_000,
          seq: ++this.seqCounter
        })
      }
    }
    this.rearm()
  }

  /** Cancel any pending timer; tests use this between cases. */
  stop(): void {
    if (this.timer != null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }

  private rearm(): void {
    if (this.timer != null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    const top = this.heap.peek()
    if (!top) return
    const wait = Math.max(0, top.nextRetryAt - this.clock())
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.tick()
    }, wait)
  }
}
