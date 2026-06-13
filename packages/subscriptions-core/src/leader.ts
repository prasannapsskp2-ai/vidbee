/**
 * Feed-check leader election.
 *
 * Spec: NEX-132 issue body, "Phase A · feed-check leader 选举".
 *
 *   - Multiple hosts (today: Desktop and Web/API) share one SQLite file in
 *     co-located deployments. Both can run their own feed-check loop, but
 *     only one is allowed to do the scheduled work; otherwise we pull the
 *     same RSS feed twice.
 *   - Leadership is a soft lease in `subscriptions_meta`. A host calls
 *     `tryAcquire()` at startup; if it wins it calls `heartbeat()` every
 *     30s to refresh `leader_lock_expires_at = now + 90s`. If the lease
 *     ages past `leader_lock_expires_at` any host may steal it.
 *   - Each acquisition uses a fresh `lease_id` (random ULID). Heartbeats and
 *     releases require the same `lease_id`; otherwise CAS fails and the
 *     caller treats itself as no longer the leader.
 *   - There is a soft preference (`preferred_leader`) the operator can set;
 *     a non-preferred host will refuse to steal a fresh lease from the
 *     preferred host but will steal an *expired* one regardless.
 *
 * The election is implemented over a `MetaStore` interface so unit tests can
 * exercise the CAS path without spinning up SQLite. `createSqliteMetaStore`
 * (in ./store.ts) wraps the real `subscriptions_meta` table.
 */
import { ulid } from 'ulid'
import {
  DEFAULT_LEADER_HEARTBEAT_MS,
  DEFAULT_LEADER_LOCK_TTL_MS,
  type LeaderAcquireOptions,
  type LeaderKind,
  type LeaderState
} from './types'

export interface MetaStore {
  /**
   * Read all leader-related meta keys in a single transaction. Returning a
   * partial map (missing keys when the row doesn't exist) is fine.
   */
  readLeader(): Promise<LeaderState>
  /**
   * Compare-and-swap the leader rows. Implementations MUST run the read and
   * write inside one SQLite transaction (or equivalent). Returns true on
   * success; false if the current state no longer matches `expectedLeaseId`.
   *
   * The semantics are:
   *   - if `expectedLeaseId` is null, succeed when the stored `leaseId` is
   *     null OR the lease has expired (<= now). This is the "acquire fresh
   *     lease" path.
   *   - otherwise, succeed only if the stored `leaseId === expectedLeaseId`.
   *     This is the "renew/release my lease" path.
   */
  casLeader(args: {
    expectedLeaseId: string | null
    now: number
    next: Pick<LeaderState, 'kind' | 'pid' | 'startedAt' | 'heartbeatAt' | 'lockExpiresAt' | 'leaseId'>
  }): Promise<boolean>
  /** Read the operator-set preference; nullable. */
  readPreferred(): Promise<LeaderKind | null>
  /** Write the operator-set preference. */
  writePreferred(kind: LeaderKind | null): Promise<void>
}

export interface LeaderElectionOptions extends LeaderAcquireOptions {
  metaStore: MetaStore
  /**
   * Optional logger. Default is no-op so the package stays Electron / log
   * runtime free; hosts wire `electron-log` / `pino` etc.
   */
  log?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void
  /**
   * Called whenever the lease state visibly changes (acquired, lost, stolen,
   * heartbeat-failed). Hosts use this to start/stop their feed-check timer.
   */
  onStateChange?: (state: LeaderState, isLeader: boolean) => void
  /**
   * Schedule helpers. Default to `setInterval` / `clearInterval`. Tests
   * inject fake timers.
   */
  scheduleInterval?: (cb: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

export class LeaderElection {
  private readonly metaStore: MetaStore
  private readonly kind: LeaderKind
  private readonly pid: number
  private readonly heartbeatIntervalMs: number
  private readonly lockTtlMs: number
  private readonly now: () => number
  private readonly log: NonNullable<LeaderElectionOptions['log']>
  private readonly onStateChange?: LeaderElectionOptions['onStateChange']
  private readonly scheduleInterval: NonNullable<LeaderElectionOptions['scheduleInterval']>
  private readonly clearIntervalImpl: NonNullable<LeaderElectionOptions['clearInterval']>

  private leaseId: string | null = null
  private heartbeatHandle: unknown = null
  private lastSnapshot: LeaderState | null = null

  constructor(options: LeaderElectionOptions) {
    this.metaStore = options.metaStore
    this.kind = options.kind
    this.pid = options.pid
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_LEADER_HEARTBEAT_MS
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LEADER_LOCK_TTL_MS
    this.now = options.now ?? (() => Date.now())
    this.log = options.log ?? (() => undefined)
    if (options.onStateChange) {
      this.onStateChange = options.onStateChange
    }
    this.scheduleInterval =
      options.scheduleInterval ??
      ((cb, ms) => setInterval(cb, ms))
    this.clearIntervalImpl =
      options.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>))
  }

  isLeader(): boolean {
    return this.leaseId !== null
  }

  /**
   * Try to acquire (or steal an expired) leader lease. Returns the resulting
   * leader state. If the call wins the lease, a heartbeat timer is started.
   */
  async tryAcquire(): Promise<{ acquired: boolean; state: LeaderState }> {
    const state = await this.metaStore.readLeader()
    const now = this.now()

    if (this.canAcquireOver(state, now)) {
      const leaseId = ulid()
      const next = {
        kind: this.kind,
        pid: this.pid,
        startedAt: now,
        heartbeatAt: now,
        lockExpiresAt: now + this.lockTtlMs,
        leaseId
      }
      const ok = await this.metaStore.casLeader({
        expectedLeaseId: null,
        now,
        next
      })
      if (ok) {
        this.leaseId = leaseId
        this.startHeartbeatTimer()
        const acquired: LeaderState = { ...next, preferred: state.preferred }
        this.lastSnapshot = acquired
        this.log('info', 'leader: acquired lease', { kind: this.kind, pid: this.pid, leaseId })
        this.onStateChange?.(acquired, true)
        return { acquired: true, state: acquired }
      }
      this.log('info', 'leader: acquire CAS failed; another host is leader')
    }

    // We did not acquire — make sure any prior heartbeat timer is gone and
    // surface the fresh state to the caller / listener.
    if (this.heartbeatHandle) {
      this.clearIntervalImpl(this.heartbeatHandle)
      this.heartbeatHandle = null
    }
    this.leaseId = null
    const fresh = await this.metaStore.readLeader()
    this.lastSnapshot = fresh
    this.onStateChange?.(fresh, false)
    return { acquired: false, state: fresh }
  }

  /**
   * Refresh `leader_heartbeat_at` and extend `leader_lock_expires_at`.
   * Called automatically every `heartbeatIntervalMs` once we're leader.
   * Returns true if heartbeat succeeded, false otherwise.
   */
  async heartbeat(): Promise<boolean> {
    if (!this.leaseId) {
      return false
    }
    const now = this.now()
    const ok = await this.metaStore.casLeader({
      expectedLeaseId: this.leaseId,
      now,
      next: {
        kind: this.kind,
        pid: this.pid,
        startedAt: this.lastSnapshot?.startedAt ?? now,
        heartbeatAt: now,
        lockExpiresAt: now + this.lockTtlMs,
        leaseId: this.leaseId
      }
    })
    if (!ok) {
      this.log('warn', 'leader: heartbeat CAS failed; lease was stolen', {
        kind: this.kind,
        pid: this.pid
      })
      const stolen = await this.metaStore.readLeader()
      this.leaseId = null
      if (this.heartbeatHandle) {
        this.clearIntervalImpl(this.heartbeatHandle)
        this.heartbeatHandle = null
      }
      this.lastSnapshot = stolen
      this.onStateChange?.(stolen, false)
      return false
    }
    const refreshed: LeaderState = {
      kind: this.kind,
      pid: this.pid,
      startedAt: this.lastSnapshot?.startedAt ?? now,
      heartbeatAt: now,
      lockExpiresAt: now + this.lockTtlMs,
      leaseId: this.leaseId,
      preferred: this.lastSnapshot?.preferred ?? null
    }
    this.lastSnapshot = refreshed
    return true
  }

  /**
   * Release the lease cooperatively. Idempotent. After release the host can
   * call `tryAcquire()` again on next interval.
   */
  async release(): Promise<void> {
    if (!this.leaseId) {
      return
    }
    const now = this.now()
    const ok = await this.metaStore.casLeader({
      expectedLeaseId: this.leaseId,
      now,
      next: {
        kind: null,
        pid: null,
        startedAt: null,
        heartbeatAt: null,
        lockExpiresAt: null,
        leaseId: null
      }
    })
    if (!ok) {
      this.log('warn', 'leader: release CAS failed; lease already moved on')
    }
    this.leaseId = null
    if (this.heartbeatHandle) {
      this.clearIntervalImpl(this.heartbeatHandle)
      this.heartbeatHandle = null
    }
    const after = await this.metaStore.readLeader()
    this.lastSnapshot = after
    this.onStateChange?.(after, false)
  }

  /** Read fresh state straight through the store (no caching). */
  async observe(): Promise<LeaderState> {
    const state = await this.metaStore.readLeader()
    this.lastSnapshot = state
    return state
  }

  private startHeartbeatTimer(): void {
    if (this.heartbeatHandle) {
      this.clearIntervalImpl(this.heartbeatHandle)
    }
    this.heartbeatHandle = this.scheduleInterval(() => {
      void this.heartbeat()
    }, this.heartbeatIntervalMs)
  }

  /**
   * Return true iff this host is allowed to overwrite the current state.
   * The acquire path is conservative: only acquire when there is no leader
   * or the existing lease has aged past `lockExpiresAt`.
   *
   * `preferred_leader` is a *tie-breaker for expired leases*, not a license
   * to preempt a fresh leader. A non-preferred host whose lease is healthy
   * keeps it until heartbeat dies (max 90s), at which point the preferred
   * host wins the next acquire round.
   */
  private canAcquireOver(state: LeaderState, now: number): boolean {
    if (!state.leaseId) {
      return true
    }
    if (state.lockExpiresAt === null || state.lockExpiresAt <= now) {
      // Lease expired. If the operator set a preference and we're not it,
      // back off so the preferred host wins the steal race deterministically.
      // We still try if we *are* the preferred host, or if there's no
      // preference set.
      if (state.preferred && state.preferred !== this.kind) {
        return false
      }
      return true
    }
    return false
  }
}
