import { beforeEach, describe, expect, it } from 'vitest'
import { LeaderElection } from '../src/leader'
import { InMemoryMetaStore } from '../src/store'
import type { LeaderKind } from '../src/types'

const buildClock = (start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } => {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    }
  }
}

const buildElection = (
  kind: LeaderKind,
  store: InMemoryMetaStore,
  clock: ReturnType<typeof buildClock>,
  pid = 1234
): LeaderElection => {
  return new LeaderElection({
    metaStore: store,
    kind,
    pid,
    now: clock.now,
    heartbeatIntervalMs: 30_000,
    lockTtlMs: 90_000,
    // No-op timers — tests drive heartbeats explicitly so the assertions
    // are deterministic.
    scheduleInterval: () => null,
    clearInterval: () => undefined
  })
}

describe('LeaderElection', () => {
  let store: InMemoryMetaStore
  let clock: ReturnType<typeof buildClock>

  beforeEach(() => {
    store = new InMemoryMetaStore()
    clock = buildClock()
  })

  it('first acquirer wins; second sees the same lease', async () => {
    const desktop = buildElection('desktop', store, clock, 100)
    const api = buildElection('api', store, clock, 200)

    const a = await desktop.tryAcquire()
    expect(a.acquired).toBe(true)
    expect(desktop.isLeader()).toBe(true)

    const b = await api.tryAcquire()
    expect(b.acquired).toBe(false)
    expect(api.isLeader()).toBe(false)
    expect(b.state.kind).toBe('desktop')
    expect(b.state.pid).toBe(100)
  })

  it('non-leader cannot steal a fresh lease', async () => {
    const desktop = buildElection('desktop', store, clock)
    await desktop.tryAcquire()

    clock.advance(10_000) // still well within lockTtlMs (90s)
    const api = buildElection('api', store, clock)
    const r = await api.tryAcquire()
    expect(r.acquired).toBe(false)
  })

  it('expired lease can be stolen by the other host', async () => {
    const desktop = buildElection('desktop', store, clock, 100)
    await desktop.tryAcquire()

    clock.advance(91_000) // expire (lockTtlMs = 90_000ms)
    const api = buildElection('api', store, clock, 200)
    const r = await api.tryAcquire()
    expect(r.acquired).toBe(true)
    expect(api.isLeader()).toBe(true)
    expect(r.state.kind).toBe('api')
    expect(r.state.pid).toBe(200)
  })

  it('heartbeat refreshes the lock; subsequent CAS fails after a steal', async () => {
    const desktop = buildElection('desktop', store, clock, 100)
    await desktop.tryAcquire()
    const initialExpiry = (await store.readLeader()).lockExpiresAt
    expect(initialExpiry).not.toBeNull()

    clock.advance(30_000)
    const ok = await desktop.heartbeat()
    expect(ok).toBe(true)
    const refreshed = await store.readLeader()
    expect(refreshed.lockExpiresAt).toBeGreaterThan(initialExpiry as number)
    expect(refreshed.heartbeatAt).toBe(clock.now())

    // Simulate desktop dying: clock jumps past lock expiry, api steals.
    clock.advance(91_000)
    const api = buildElection('api', store, clock, 200)
    const r = await api.tryAcquire()
    expect(r.acquired).toBe(true)

    // Desktop wakes up and tries to heartbeat with a stale leaseId — must fail.
    const desktopAlive = await desktop.heartbeat()
    expect(desktopAlive).toBe(false)
    expect(desktop.isLeader()).toBe(false)
  })

  it('release frees the lease and notifies onStateChange', async () => {
    const events: Array<{ isLeader: boolean }> = []
    const desktop = new LeaderElection({
      metaStore: store,
      kind: 'desktop',
      pid: 1,
      now: clock.now,
      scheduleInterval: () => null,
      clearInterval: () => undefined,
      onStateChange: (_state, isLeader) => events.push({ isLeader })
    })

    await desktop.tryAcquire()
    await desktop.release()

    expect(desktop.isLeader()).toBe(false)
    expect(events.map((entry) => entry.isLeader)).toEqual([true, false])
    const after = await store.readLeader()
    expect(after.leaseId).toBeNull()
  })

  it('preferred host wins the takeover race after the lease expires', async () => {
    await store.writePreferred('desktop')
    const api = buildElection('api', store, clock, 200)
    await api.tryAcquire()
    expect(api.isLeader()).toBe(true)

    clock.advance(91_000) // expire the api lease

    // Non-preferred host (api) backs off when it sees the preference set,
    // so the preferred host (desktop) gets the slot deterministically.
    const apiRetake = await api.tryAcquire()
    expect(apiRetake.acquired).toBe(false)

    const desktop = buildElection('desktop', store, clock, 100)
    const desktopAcquire = await desktop.tryAcquire()
    expect(desktopAcquire.acquired).toBe(true)
    expect(desktopAcquire.state.kind).toBe('desktop')
  })

  it('does not preempt a fresh leader even when we are preferred', async () => {
    await store.writePreferred('desktop')
    const api = buildElection('api', store, clock, 200)
    await api.tryAcquire()
    // Lease is healthy. Desktop is the preferred host but the spec is
    // conservative: it must wait for the api lease to expire before stealing.
    const desktop = buildElection('desktop', store, clock, 100)
    const r = await desktop.tryAcquire()
    expect(r.acquired).toBe(false)
  })

  it('property: 100 concurrent acquires produce exactly one winner', async () => {
    const elections = Array.from({ length: 100 }, (_, i) =>
      buildElection(i % 2 === 0 ? 'desktop' : 'api', store, clock, i + 1)
    )
    const results = await Promise.all(elections.map((e) => e.tryAcquire()))
    const winners = results.filter((r) => r.acquired)
    expect(winners).toHaveLength(1)
  })
})
