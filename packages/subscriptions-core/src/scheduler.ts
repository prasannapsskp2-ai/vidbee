/**
 * Periodic feed-check loop. Host-neutral.
 *
 *   - When the host holds the leader lease the loop fires every
 *     `intervalMs` (default 3h) and calls `runOnce()`.
 *   - `triggerNow(id?)` runs immediately regardless of leader state. The
 *     caller (any host) is allowed to do this in response to user action;
 *     concurrency is gated with a 30s `refreshDedupeWindowMs` so two hosts
 *     can't both refresh the same subscription within a short window.
 *   - `runOnce()` is provided by the host. Hosts implement the per-feed
 *     work (parse → decideAutoDownloads → enqueue via task-queue) inside
 *     this callback; the scheduler only owns the timing and the leader
 *     gating.
 *
 * The scheduler does NOT implement retry. yt-dlp retry is the task-queue's
 * concern (NEX-129), and feed parse errors are reported on the subscription
 * row (`status='failed'`, `lastError`) for the next periodic run to retry.
 */
import {
  DEFAULT_FEED_CHECK_INTERVAL_MS,
  DEFAULT_REFRESH_DEDUPE_WINDOW_MS
} from './types'

export interface FeedCheckSchedulerOptions {
  /**
   * Run the periodic feed-check pass over all enabled subscriptions, or one
   * if `subscriptionId` is given. Hosts implement this; the scheduler only
   * decides when to call.
   */
  runAll: () => Promise<void>
  runOne: (subscriptionId: string) => Promise<void>
  /**
   * Returns true if this host currently holds the leader lease.
   *
   * The scheduler reads this every tick rather than caching, so a leader
   * loss between ticks is honored without needing the `LeaderElection`
   * instance to feed events into here.
   */
  isLeader: () => boolean
  /** Default 3h. */
  intervalMs?: number
  /**
   * Window during which a duplicate `triggerNow(id)` is dropped. Default 30s
   * (matches NEX-132 spec for cross-host refresh dedupe).
   */
  refreshDedupeWindowMs?: number
  /** Default `setTimeout`. */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown
  clearTimeoutImpl?: (handle: unknown) => void
  now?: () => number
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
}

export class FeedCheckScheduler {
  private readonly opts: Required<
    Omit<FeedCheckSchedulerOptions, 'runAll' | 'runOne' | 'isLeader' | 'log'>
  > & {
    runAll: FeedCheckSchedulerOptions['runAll']
    runOne: FeedCheckSchedulerOptions['runOne']
    isLeader: FeedCheckSchedulerOptions['isLeader']
    log: NonNullable<FeedCheckSchedulerOptions['log']>
  }

  private timer: unknown = null
  private running = false
  private pending = false
  private readonly recentTriggers = new Map<string, number>() // subId → ts

  constructor(options: FeedCheckSchedulerOptions) {
    this.opts = {
      runAll: options.runAll,
      runOne: options.runOne,
      isLeader: options.isLeader,
      intervalMs: options.intervalMs ?? DEFAULT_FEED_CHECK_INTERVAL_MS,
      refreshDedupeWindowMs:
        options.refreshDedupeWindowMs ?? DEFAULT_REFRESH_DEDUPE_WINDOW_MS,
      setTimeoutImpl:
        options.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms)),
      clearTimeoutImpl:
        options.clearTimeoutImpl ??
        ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
      now: options.now ?? (() => Date.now()),
      log: options.log ?? (() => undefined)
    }
  }

  /**
   * Start the periodic timer. Calling start() multiple times is harmless;
   * the next scheduled run replaces any prior timer.
   */
  start(initialDelayMs?: number): void {
    this.scheduleNext(initialDelayMs ?? 0)
  }

  stop(): void {
    if (this.timer) {
      this.opts.clearTimeoutImpl(this.timer)
      this.timer = null
    }
  }

  /**
   * Trigger an out-of-band run. If `subscriptionId` is given, only that
   * subscription is refreshed; otherwise all enabled subscriptions are. The
   * call is dropped silently when the same subscription was triggered less
   * than `refreshDedupeWindowMs` ago — this is the cross-host dedupe.
   */
  async triggerNow(subscriptionId?: string): Promise<void> {
    if (subscriptionId) {
      const now = this.opts.now()
      const last = this.recentTriggers.get(subscriptionId)
      if (last !== undefined && now - last < this.opts.refreshDedupeWindowMs) {
        this.opts.log('info', 'scheduler: dropping triggerNow within dedupe window', {
          subscriptionId,
          ageMs: now - last
        })
        return
      }
      this.recentTriggers.set(subscriptionId, now)
      this.pruneRecentTriggers(now)
      await this.opts.runOne(subscriptionId)
      return
    }
    await this.runIfIdle()
  }

  /**
   * Internal periodic tick. Only the leader runs `runAll`; non-leaders
   * just re-arm their timer so they can take over instantly when the
   * leader expires.
   */
  private async tick(): Promise<void> {
    try {
      if (this.opts.isLeader()) {
        await this.runIfIdle()
      } else {
        this.opts.log('info', 'scheduler: skipping tick (not leader)')
      }
    } finally {
      this.scheduleNext()
    }
  }

  private async runIfIdle(): Promise<void> {
    if (this.running) {
      this.pending = true
      return
    }
    this.running = true
    try {
      await this.opts.runAll()
    } catch (err) {
      this.opts.log('error', 'scheduler: runAll threw', { err })
    } finally {
      this.running = false
      if (this.pending) {
        this.pending = false
        // Re-enter without awaiting so the caller doesn't block.
        void this.runIfIdle()
      }
    }
  }

  private scheduleNext(delayMs?: number): void {
    if (this.timer) {
      this.opts.clearTimeoutImpl(this.timer)
    }
    const ms = delayMs ?? this.opts.intervalMs
    this.timer = this.opts.setTimeoutImpl(() => {
      void this.tick()
    }, ms)
  }

  private pruneRecentTriggers(now: number): void {
    const cutoff = now - this.opts.refreshDedupeWindowMs * 4
    for (const [id, ts] of this.recentTriggers) {
      if (ts < cutoff) {
        this.recentTriggers.delete(id)
      }
    }
  }
}
