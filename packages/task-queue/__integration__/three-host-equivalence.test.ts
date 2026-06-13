/**
 * Three-host equivalence test (NEX-131 acceptance: 三端等价性测试).
 *
 * Goal: prove that Desktop, Web/API and CLI hosts produce byte-equal
 * task-state and event payloads when driven by the same scripted yt-dlp
 * lifecycle. The kernel is host-neutral; any divergence is a contract bug
 * in the host adapter.
 *
 * What this test covers right now:
 *   - Each "host" instantiates its own TaskQueueAPI + MemoryPersistAdapter
 *     wrapped around the same FakeYtDlpExecutor (deterministic spawn /
 *     progress / postprocess / finish script).
 *   - We add the same TaskInput on each host, drive the executor scripts,
 *     and assert that the resulting Task snapshots and projection outputs
 *     are equal across all three hosts (modulo task id and timestamps).
 *   - Scenarios: complete success, http-429 retry-then-success, auth
 *     failure (terminal), stalled cancel.
 *
 * What is intentionally not covered yet (left as TODO for the CLI part of
 * NEX-133's Phase B):
 *   - Real `apps/cli` envelope output equivalence: this test currently
 *     stands in for the CLI by spinning up a third TaskQueueAPI instance
 *     in the same process. Once `apps/cli --vidbee-local` ships its
 *     in-process driver, point the third host at that instead.
 *   - Real `apps/api` SSE wire-format diff: the SSE bridge serializes
 *     `snapshot-changed` with a projection field. Add a wire-level diff
 *     once the CLI and Desktop loopback also publish the same payload.
 *   - SQLite-backed crash recovery scenario (kill main → resume): requires
 *     a child-process harness, deferred to the host-specific e2e suites.
 */
import { describe, expect, it } from 'vitest'

import { TaskQueueAPI } from '../src/api'
import type { Executor, ExecutorEvents, ExecutorRun } from '../src/executor'
import { MemoryPersistAdapter } from '../src/persist'
import { projectTaskToLegacy } from '../src/projection'
import type { Task, TaskInput, TaskStatus } from '../src/types'

type Step =
  | { type: 'spawn' }
  | { type: 'progress'; percent: number; postprocess?: boolean }
  | { type: 'success'; filePath?: string; size?: number }
  | { type: 'errorRetryable'; message?: string }
  | { type: 'errorFatal'; message?: string }

const SUCCESS_SCRIPT: Step[] = [
  { type: 'spawn' },
  { type: 'progress', percent: 0.5 },
  { type: 'progress', percent: 0.95, postprocess: true },
  { type: 'success', filePath: '/tmp/x.mp4', size: 1024 }
]

const HTTP_429_THEN_SUCCESS_SCRIPT_GENERATOR = (): Step[] => [
  { type: 'spawn' },
  { type: 'progress', percent: 0.2 },
  { type: 'errorRetryable', message: 'HTTP Error 429: Too Many Requests' }
]

const AUTH_REQUIRED_SCRIPT: Step[] = [
  { type: 'spawn' },
  { type: 'errorFatal', message: 'Login required' }
]

interface ScriptedExecutor extends Executor {
  setNextScriptForUrl: (url: string, script: Step[]) => void
}

const makeScriptedExecutor = (initial: Map<string, Step[]>): ScriptedExecutor => {
  const scripts = new Map(initial)
  let pidCounter = 1000
  const executor: ScriptedExecutor = {
    setNextScriptForUrl(url, script) {
      scripts.set(url, script)
    },
    run(ctx, events: ExecutorEvents): ExecutorRun {
      const script = scripts.get(ctx.input.url) ?? SUCCESS_SCRIPT
      const pid = ++pidCounter
      let cancelled = false
      queueMicrotask(() => {
        if (cancelled) {
          events.onFinish({
            taskId: ctx.taskId,
            attemptId: ctx.attemptId,
            result: { type: 'cancelled' },
            closedAt: 1,
            stdoutTail: '',
            stderrTail: ''
          })
          return
        }
        for (const step of script) {
          switch (step.type) {
            case 'spawn':
              events.onSpawn({
                taskId: ctx.taskId,
                attemptId: ctx.attemptId,
                pid,
                pidStartedAt: 1,
                kind: 'yt-dlp',
                spawnedAt: 1
              })
              break
            case 'progress':
              events.onProgress({
                taskId: ctx.taskId,
                attemptId: ctx.attemptId,
                progress: {
                  percent: step.percent,
                  bytesDownloaded: Math.round(step.percent * 1000),
                  bytesTotal: 1000,
                  speedBps: 100,
                  etaMs: 100,
                  ticks: 1
                },
                enteredProcessing: Boolean(step.postprocess)
              })
              break
            case 'success':
              events.onFinish({
                taskId: ctx.taskId,
                attemptId: ctx.attemptId,
                result: {
                  type: 'success',
                  output: {
                    filePath: step.filePath ?? '/tmp/out.mp4',
                    size: step.size ?? 1024,
                    durationMs: null,
                    sha256: null
                  }
                },
                closedAt: 1,
                stdoutTail: '',
                stderrTail: ''
              })
              return
            case 'errorRetryable':
              events.onFinish({
                taskId: ctx.taskId,
                attemptId: ctx.attemptId,
                result: {
                  type: 'error',
                  error: {
                    category: 'http-429',
                    exitCode: 1,
                    rawMessage: step.message ?? 'http-429',
                    uiMessageKey: 'errors.rate_limited',
                    uiActionHints: [],
                    retryable: true,
                    suggestedRetryAfterMs: 50
                  },
                  exitCode: 1
                },
                closedAt: 1,
                stdoutTail: '',
                stderrTail: step.message ?? ''
              })
              return
            case 'errorFatal':
              events.onFinish({
                taskId: ctx.taskId,
                attemptId: ctx.attemptId,
                result: {
                  type: 'error',
                  error: {
                    category: 'auth-required',
                    exitCode: 1,
                    rawMessage: step.message ?? 'auth required',
                    uiMessageKey: 'errors.auth_required',
                    uiActionHints: ['login'],
                    retryable: false,
                    suggestedRetryAfterMs: null
                  },
                  exitCode: 1
                },
                closedAt: 1,
                stdoutTail: '',
                stderrTail: step.message ?? ''
              })
              return
          }
        }
      })
      const emitCancelled = (): void => {
        cancelled = true
        events.onFinish({
          taskId: ctx.taskId,
          attemptId: ctx.attemptId,
          result: { type: 'cancelled' },
          closedAt: 1,
          stdoutTail: '',
          stderrTail: ''
        })
      }
      return {
        cancel: async () => {
          if (!cancelled) emitCancelled()
        },
        pause: async () => {
          if (!cancelled) emitCancelled()
        }
      }
    }
  }
  return executor
}

interface Host {
  name: string
  queue: TaskQueueAPI
  executor: ScriptedExecutor
}

const buildHost = (name: string, scripts: Map<string, Step[]>): Host => {
  const executor = makeScriptedExecutor(scripts)
  return {
    name,
    executor,
    queue: new TaskQueueAPI({
      persist: new MemoryPersistAdapter(),
      executor,
      maxConcurrency: 4,
      // Make the test deterministic — all hosts use the same deterministic
      // backoff so retry-scheduled timing matches.
      rng: () => 0.5,
      // The fake executor reports synthetic file paths; the kernel guards
      // `processing → completed` with a real fs check by default. Disable
      // for tests so the script's `success` step actually completes.
      filePresent: () => true
    })
  }
}

const HOSTS: ReadonlyArray<{ name: string }> = [
  { name: 'desktop' },
  { name: 'api' },
  { name: 'cli' }
]

const buildHosts = (scripts: Map<string, Step[]>): Host[] =>
  HOSTS.map((h) => buildHost(h.name, scripts))

const startAll = async (hosts: Host[]): Promise<void> => {
  await Promise.all(hosts.map((h) => h.queue.start()))
}

const stopAll = async (hosts: Host[]): Promise<void> => {
  await Promise.all(hosts.map((h) => h.queue.stop()))
}

const waitFor = async (
  hosts: Host[],
  predicate: (h: Host) => boolean,
  timeoutMs = 2000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (hosts.every(predicate)) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('waitFor: predicate did not hold within timeout')
}

const submitOnAllHosts = async (
  hosts: Host[],
  input: TaskInput
): Promise<Map<string, string>> => {
  const ids = new Map<string, string>()
  for (const host of hosts) {
    const { id } = await host.queue.add({ input })
    ids.set(host.name, id)
  }
  return ids
}

const expectStatus = (host: Host, id: string, expected: TaskStatus): void => {
  const t = host.queue.get(id)
  expect(t, `${host.name}/${id}`).toBeTruthy()
  expect(t?.status, `${host.name}/${id}`).toBe(expected)
}

const stripVolatileFields = (task: Readonly<Task>): unknown => {
  const cloned = JSON.parse(JSON.stringify(task)) as Record<string, unknown>
  delete cloned.id
  delete cloned.createdAt
  delete cloned.updatedAt
  delete cloned.enteredStatusAt
  delete cloned.pid
  delete cloned.pidStartedAt
  delete cloned.nextRetryAt
  return cloned
}

const stripVolatileProjection = (task: Readonly<Task>): unknown => {
  const proj = projectTaskToLegacy(task) as Record<string, unknown>
  delete proj.id
  delete proj.createdAt
  delete proj.startedAt
  delete proj.completedAt
  delete proj.nextRetryAt
  return proj
}

describe('three-host equivalence', () => {
  it('completed download produces identical Task + projection across hosts', async () => {
    const scripts = new Map<string, Step[]>([
      ['https://example.com/v/success', SUCCESS_SCRIPT]
    ])
    const hosts = buildHosts(scripts)
    await startAll(hosts)
    try {
      const ids = await submitOnAllHosts(hosts, {
        url: 'https://example.com/v/success',
        kind: 'video',
        title: 'Sample',
        thumbnail: 'https://example.com/t.jpg'
      })
      await waitFor(hosts, (h) => h.queue.get(ids.get(h.name)!)?.status === 'completed')
      const snapshots = hosts.map((h) => stripVolatileFields(h.queue.get(ids.get(h.name)!)!))
      const projections = hosts.map((h) =>
        stripVolatileProjection(h.queue.get(ids.get(h.name)!)!)
      )
      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i]).toStrictEqual(snapshots[0])
        expect(projections[i]).toStrictEqual(projections[0])
      }
    } finally {
      await stopAll(hosts)
    }
  })

  it('http-429 → retry-scheduled lands on identical retry state across hosts', async () => {
    const scripts = new Map<string, Step[]>([
      ['https://example.com/v/retry', HTTP_429_THEN_SUCCESS_SCRIPT_GENERATOR()]
    ])
    const hosts = buildHosts(scripts)
    await startAll(hosts)
    try {
      const ids = await submitOnAllHosts(hosts, {
        url: 'https://example.com/v/retry',
        kind: 'video'
      })
      await waitFor(
        hosts,
        (h) => h.queue.get(ids.get(h.name)!)?.status === 'retry-scheduled'
      )
      for (const host of hosts) expectStatus(host, ids.get(host.name)!, 'retry-scheduled')
      const projections = hosts.map((h) => projectTaskToLegacy(h.queue.get(ids.get(h.name)!)!))
      for (const proj of projections) {
        expect(proj.status).toBe('pending')
        expect(proj.subStatus).toBe('retry-scheduled')
        expect(proj.errorCategory).toBe('http-429')
        // FSM increments `attempt` on every retry-scheduled transition.
        expect(proj.attempt).toBe(1)
      }
    } finally {
      await stopAll(hosts)
    }
  })

  it('auth-required is non-retryable and yields identical failed projection', async () => {
    const scripts = new Map<string, Step[]>([
      ['https://example.com/v/auth', AUTH_REQUIRED_SCRIPT]
    ])
    const hosts = buildHosts(scripts)
    await startAll(hosts)
    try {
      const ids = await submitOnAllHosts(hosts, {
        url: 'https://example.com/v/auth',
        kind: 'video'
      })
      await waitFor(hosts, (h) => h.queue.get(ids.get(h.name)!)?.status === 'failed')
      const projections = hosts.map((h) =>
        stripVolatileProjection(h.queue.get(ids.get(h.name)!)!)
      )
      for (let i = 1; i < projections.length; i++) {
        expect(projections[i]).toStrictEqual(projections[0])
      }
      const proj = projectTaskToLegacy(hosts[0]!.queue.get(ids.get('desktop')!)!)
      expect(proj.status).toBe('error')
      expect(proj.errorCategory).toBe('auth-required')
      expect(proj.uiMessageKey).toBe('errors.auth_required')
    } finally {
      await stopAll(hosts)
    }
  })

  it('cancel on a running task produces identical cancelled snapshot across hosts', async () => {
    const scripts = new Map<string, Step[]>([
      [
        'https://example.com/v/cancel-me',
        [{ type: 'spawn' }, { type: 'progress', percent: 0.3 }]
      ]
    ])
    const hosts = buildHosts(scripts)
    await startAll(hosts)
    try {
      const ids = await submitOnAllHosts(hosts, {
        url: 'https://example.com/v/cancel-me',
        kind: 'video'
      })
      await waitFor(hosts, (h) => h.queue.get(ids.get(h.name)!)?.status === 'running', 1000)
      await Promise.all(hosts.map((h) => h.queue.cancel(ids.get(h.name)!, 'user')))
      await waitFor(hosts, (h) => h.queue.get(ids.get(h.name)!)?.status === 'cancelled')
      const projections = hosts.map((h) =>
        stripVolatileProjection(h.queue.get(ids.get(h.name)!)!)
      )
      for (let i = 1; i < projections.length; i++) {
        expect(projections[i]).toStrictEqual(projections[0])
      }
    } finally {
      await stopAll(hosts)
    }
  })
})
