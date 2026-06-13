/**
 * Three-host equivalence: CLI `--vidbee-local` slot.
 *
 * The kernel-level test in `packages/task-queue/__integration__/three-host-equivalence.test.ts`
 * stands in for the CLI by spinning up a third TaskQueueAPI in-process.
 * This file proves that `createLocalClient` (the production code path the
 * CLI uses for `--vidbee-local`) wraps that same kernel without changing
 * the resulting Task / projection state.
 *
 * Together they fulfil the design doc's three-host-equivalence acceptance
 * for the CLI side (§10).
 */
import { describe, expect, it } from 'vitest'

import { TaskQueueAPI } from '@vidbee/task-queue'
import type {
  Executor,
  ExecutorEvents,
  ExecutorRun,
  Task
} from '@vidbee/task-queue'
import { MemoryPersistAdapter, projectTaskToLegacy } from '@vidbee/task-queue'

import { createLocalClient } from '../src/transport/local-client'

interface ScriptedExecutor extends Executor {}

const SUCCESS_SCRIPT = (filePath: string) => (events: ExecutorEvents, ctx: { taskId: string; attemptId: string }) => {
  events.onSpawn({
    taskId: ctx.taskId,
    attemptId: ctx.attemptId,
    pid: 4242,
    pidStartedAt: 1000,
    kind: 'yt-dlp',
    spawnedAt: 1
  })
  events.onProgress({
    taskId: ctx.taskId,
    attemptId: ctx.attemptId,
    progress: {
      percent: 0.5,
      bytesDownloaded: 50,
      bytesTotal: 100,
      speedBps: 100,
      etaMs: 1000,
      ticks: 1
    },
    enteredProcessing: false
  })
  events.onProgress({
    taskId: ctx.taskId,
    attemptId: ctx.attemptId,
    progress: {
      percent: 0.95,
      bytesDownloaded: 95,
      bytesTotal: 100,
      speedBps: 100,
      etaMs: 100,
      ticks: 2
    },
    enteredProcessing: true
  })
  events.onFinish({
    taskId: ctx.taskId,
    attemptId: ctx.attemptId,
    result: {
      type: 'success',
      output: { filePath, size: 1024, durationMs: null, sha256: null }
    },
    closedAt: 2,
    stdoutTail: '',
    stderrTail: ''
  })
}

const makeScripted = (filePath: string): ScriptedExecutor => ({
  run(ctx, events) {
    queueMicrotask(() => SUCCESS_SCRIPT(filePath)(events, ctx))
    return { cancel: async () => {}, pause: async () => {} } as ExecutorRun
  }
})

const stripVolatile = (task: Readonly<Task>): unknown => {
  const c = JSON.parse(JSON.stringify(task)) as Record<string, unknown>
  delete c.id
  delete c.createdAt
  delete c.updatedAt
  delete c.enteredStatusAt
  delete c.pid
  delete c.pidStartedAt
  delete c.nextRetryAt
  return c
}

const stripVolatileProjection = (task: Readonly<Task>): unknown => {
  const p = projectTaskToLegacy(task) as unknown as Record<string, unknown>
  delete p.id
  delete p.createdAt
  delete p.startedAt
  delete p.completedAt
  delete p.nextRetryAt
  return p
}

const wait = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('wait: predicate did not hold within timeout')
}

describe('createLocalClient — three-host equivalence (CLI slot)', () => {
  it('produces the same Task/projection as a bare TaskQueueAPI', async () => {
    const filePath = '/tmp/sample.mp4'

    // Reference host: a TaskQueueAPI configured exactly like the kernel's
    // own three-host test does it.
    const refExec = makeScripted(filePath)
    const ref = new TaskQueueAPI({
      persist: new MemoryPersistAdapter(),
      executor: refExec,
      maxConcurrency: 4,
      rng: () => 0.5,
      filePresent: () => true
    })
    await ref.start()

    // CLI host: production createLocalClient with the same fake executor.
    const cli = await createLocalClient({
      persist: 'memory',
      executor: makeScripted(filePath),
      filePresent: () => true,
      rng: () => 0.5,
      maxConcurrency: 4
    })

    try {
      const input = { url: 'https://example.com/v', kind: 'video' as const, title: 'sample' }
      const refAdd = await ref.add({ input })
      const cliAdd = await cli.add!({ input })

      await wait(() => ref.get(refAdd.id)?.status === 'completed')
      await wait(() => cli.api.get(cliAdd.id)?.status === 'completed')

      const refTask = ref.get(refAdd.id)!
      const cliTask = cli.api.get(cliAdd.id)!

      expect(stripVolatile(cliTask)).toStrictEqual(stripVolatile(refTask))
      expect(stripVolatileProjection(cliTask)).toStrictEqual(stripVolatileProjection(refTask))
    } finally {
      await ref.stop()
      await cli.shutdown()
    }
  })
})
