import { describe, expect, it, vi } from 'vitest'

import { MemoryPersistAdapter } from '../src/persist'
import { ProcessRegistry } from '../src/process'

describe('ProcessRegistry', () => {
  it('records spawn + close pairs in the journal', async () => {
    const persist = new MemoryPersistAdapter()
    const reg = new ProcessRegistry({ persist, kill: vi.fn(), sleep: async () => {} })
    await reg.recordSpawn({
      taskId: 't',
      attemptId: 'a',
      pid: 100,
      pidStartedAt: 50,
      kind: 'yt-dlp',
      spawnedAt: Date.now()
    })
    await reg.recordClose('t', 'a', 0, null)
    const journal = persist.journalSnapshot()
    expect(journal.map((r) => r.op)).toEqual(['spawn', 'close'])
    const open = await persist.findOpenSpawns()
    expect(open).toHaveLength(0)
  })

  it('cancel issues SIGTERM then SIGKILL after grace', async () => {
    const persist = new MemoryPersistAdapter()
    const kill = vi.fn()
    const reg = new ProcessRegistry({
      persist,
      kill,
      sleep: async () => {},
      // Simulate the process never dying so SIGKILL fires.
      killGracePeriodMs: 0
    })
    await reg.recordSpawn({
      taskId: 't',
      attemptId: 'a',
      pid: 100,
      pidStartedAt: 50,
      kind: 'yt-dlp',
      spawnedAt: Date.now()
    })
    await reg.cancel('t', 'a')
    expect(kill).toHaveBeenCalledWith(100, 'SIGTERM')
    // killed row written
    const journal = persist.journalSnapshot()
    expect(journal.map((r) => r.op)).toContain('killed')
  })

  it('reconcile finds spawn rows without a matching close and journals killed', async () => {
    const persist = new MemoryPersistAdapter()
    // Pretend the process has been killed externally by the OS — kill stub is
    // a noop but isPidAlive returns false because the pid is fake.
    const reg = new ProcessRegistry({
      persist,
      kill: vi.fn(),
      sleep: async () => {},
      killGracePeriodMs: 0
    })
    // Append an orphan spawn directly (simulating a previous app instance).
    await persist.appendJournal({
      ts: Date.now(),
      op: 'spawn',
      taskId: 't1',
      attemptId: 'a1',
      pid: 999_999, // surely dead
      pidStartedAt: 0,
      exitCode: null,
      signal: null
    })
    const reconciled = await reg.reconcile()
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]!.taskId).toBe('t1')
    const ops = persist.journalSnapshot().map((r) => r.op)
    expect(ops).toContain('killed')
  })
})
