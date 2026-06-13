import { describe, expect, it } from 'vitest'

import { run } from '../src/runtime'
import type { ContractClient } from '../src/subcommands'
import type { ConnectOptions, ConnectResult } from '../src/transport/connect'
import type { Task } from '@vidbee/task-queue'
import { EMPTY_PROGRESS } from '@vidbee/task-queue'

function fakeTask(id: string, status: Task['status'] = 'queued'): Task {
  return {
    id,
    kind: 'video',
    parentId: null,
    input: { url: 'https://e.com', kind: 'video' },
    priority: 0,
    groupKey: 'e.com',
    status,
    prevStatus: null,
    statusReason: null,
    enteredStatusAt: 0,
    attempt: 0,
    maxAttempts: 5,
    nextRetryAt: null,
    progress: { ...EMPTY_PROGRESS },
    output: null,
    lastError: null,
    pid: null,
    pidStartedAt: null,
    createdAt: 0,
    updatedAt: 0
  }
}

function fakeClient(seeded: Task[] = [fakeTask('t1', 'queued'), fakeTask('t2', 'completed')]): ContractClient {
  return {
    list: async () => ({ items: seeded, nextCursor: null }),
    get: async (id) => seeded.find((t) => t.id === id) ?? fakeTask(id),
    stats: async () => ({ pending: 0, running: 0, completed: 1 }),
    removeFromHistory: async () => {}
  }
}

function fakeConnect(client: ContractClient) {
  return async (_opts: ConnectOptions): Promise<ConnectResult> => ({
    kind: 'connected',
    client
  })
}

function makeIO(client = fakeClient()) {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      stdout: (l: string) => out.push(l),
      stderr: (l: string) => err.push(l),
      connect: fakeConnect(client)
    }
  }
}

describe('run() — argv error path', () => {
  it('exits 2 with error envelope on unknown --vidbee-*', async () => {
    const { io, out } = makeIO()
    const r = await run(['--vidbe-wait', 'https://x'], io)
    expect(r.exitCode).toBe(2)
    const env = JSON.parse(out[0] as string)
    expect(env.ok).toBe(false)
    expect(env.code).toBe('UNKNOWN_VIDBEE_FLAG')
  })
  it('exits 2 with STDOUT_OUTPUT_DISALLOWED on -o - in download mode', async () => {
    const { io, out } = makeIO()
    const r = await run(['-o', '-', 'https://x'], io)
    expect(r.exitCode).toBe(2)
    const env = JSON.parse(out[0] as string)
    expect(env.code).toBe('STDOUT_OUTPUT_DISALLOWED')
  })
})

describe('run() — read-only subcommands via fake transport', () => {
  it(':status returns stats from the contract', async () => {
    const { io, out } = makeIO()
    const r = await run(['--vidbee-local', ':status'], io)
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.ok).toBe(true)
    expect(env.mode).toBe('subcommand')
    expect(env.subcommand).toBe('status')
    expect(env.result).toEqual({ pending: 0, running: 0, completed: 1 })
  })

  it(':download list passes filters through to the contract', async () => {
    const { io, out } = makeIO()
    const r = await run(
      ['--vidbee-local', ':download', 'list', '--status', 'queued', '--limit', '10'],
      io
    )
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.result.items).toHaveLength(2)
  })

  it(':download status <id> returns the task', async () => {
    const { io, out } = makeIO()
    const r = await run(['--vidbee-local', ':download', 'status', 't1'], io)
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.result.id).toBe('t1')
  })

  it(':download status without id reports parse error', async () => {
    const { io, out } = makeIO()
    const r = await run(['--vidbee-local', ':download', 'status'], io)
    expect(r.exitCode).toBe(2)
    const env = JSON.parse(out[0] as string)
    expect(env.code).toBe('PARSE_ERROR')
  })

  it(':history list forwards to the contract', async () => {
    const { io, out } = makeIO()
    const r = await run(['--vidbee-local', ':history', 'list'], io)
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.ok).toBe(true)
  })

  it(':history remove <id...> calls the contract per id', async () => {
    const removed: string[] = []
    const client: ContractClient = {
      list: async () => ({ items: [], nextCursor: null }),
      get: async (id) => fakeTask(id),
      stats: async () => ({}),
      removeFromHistory: async (id) => {
        removed.push(id)
      }
    }
    const out: string[] = []
    const r = await run(['--vidbee-local', ':history', 'remove', 'a', 'b'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    expect(r.exitCode).toBe(0)
    expect(removed).toEqual(['a', 'b'])
  })

  it('unknown subcommand exits 2', async () => {
    const { io, out } = makeIO()
    const r = await run(['--vidbee-local', ':bogus'], io)
    expect(r.exitCode).toBe(2)
    const env = JSON.parse(out[0] as string)
    expect(env.code).toBe('PARSE_ERROR')
  })
})

describe('run() — :download write verbs', () => {
  it(':download cancel calls client.cancel', async () => {
    const cancelled: string[] = []
    const client: ContractClient = {
      ...fakeClient(),
      cancel: async (id) => {
        cancelled.push(id)
      }
    }
    const out: string[] = []
    const r = await run(['--vidbee-local', ':download', 'cancel', 't1'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    expect(r.exitCode).toBe(0)
    expect(cancelled).toEqual(['t1'])
    const env = JSON.parse(out[0] as string)
    expect(env.result.status).toBe('cancel-requested')
  })

  it(':download pause forwards --reason', async () => {
    const paused: { id: string; reason?: string }[] = []
    const client: ContractClient = {
      ...fakeClient(),
      pause: async (id, reason) => {
        paused.push({ id, reason })
      }
    }
    const out: string[] = []
    await run(['--vidbee-local', ':download', 'pause', 't1', '--reason', 'manual'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    expect(paused).toEqual([{ id: 't1', reason: 'manual' }])
  })

  it(':download retry calls client.retry', async () => {
    const retried: string[] = []
    const client: ContractClient = {
      ...fakeClient(),
      retry: async (id) => {
        retried.push(id)
      }
    }
    const out: string[] = []
    const r = await run(['--vidbee-local', ':download', 'retry', 't1'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    expect(r.exitCode).toBe(0)
    expect(retried).toEqual(['t1'])
  })

  it(':download cancel surfaces CONTRACT_VERSION_MISMATCH when transport lacks support', async () => {
    const out: string[] = []
    const r = await run(['--vidbee-local', ':download', 'cancel', 't1'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(fakeClient())
    })
    expect(r.exitCode).toBe(5)
    const env = JSON.parse(out[0] as string)
    expect(env.code).toBe('CONTRACT_VERSION_MISMATCH')
  })

  it(':download logs returns task + stderrTail', async () => {
    const t = fakeTask('t1', 'failed')
    ;(t as { lastError: unknown }).lastError = { stderrTail: 'boom' }
    const client: ContractClient = {
      ...fakeClient([t]),
      get: async () => t
    }
    const out: string[] = []
    await run(['--vidbee-local', ':download', 'logs', 't1'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    const env = JSON.parse(out[0] as string)
    expect(env.result.logs.stderrTail).toBe('boom')
  })
})

describe('run() — yt-dlp probe (Phase B)', () => {
  it('emits §4.4 probe envelope with sanitized command', async () => {
    const out: string[] = []
    const r = await run(['--vidbee-local', '-j', '--password', 'shh', 'https://x'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(fakeClient()),
      probe: async () => ({ kind: 'success', stdout: '{"title":"x"}', stderr: '', exitCode: 0, binary: 'yt-dlp' })
    })
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.ok).toBe(true)
    expect(env.mode).toBe('probe')
    expect(env.command).toContain('<redacted>')
    expect(env.ytDlp.exitCode).toBe(0)
  })

  it('reports PROBE_OUTPUT_TOO_LARGE when stdout exceeds 32MB', async () => {
    const out: string[] = []
    const r = await run(['-j', 'https://x'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(fakeClient()),
      probe: async () => ({
        kind: 'error',
        envelope: {
          ok: false,
          code: 'PROBE_OUTPUT_TOO_LARGE',
          message: 'too big'
        }
      })
    })
    expect(r.exitCode).toBe(1)
    const env = JSON.parse(out[0] as string)
    expect(env.code).toBe('PROBE_OUTPUT_TOO_LARGE')
  })
})

describe('run() — yt-dlp download enqueue (Phase B)', () => {
  it('detached mode returns queued task and exit 0', async () => {
    const queued = fakeTask('q1', 'queued')
    const client: ContractClient = {
      ...fakeClient(),
      add: async () => ({ id: 'q1', task: queued }),
      get: async () => queued
    }
    const out: string[] = []
    const r = await run(['--vidbee-local', 'https://x'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.mode).toBe('download')
    expect(env.task.id).toBe('q1')
    expect(env.task.status).toBe('queued')
    expect(env.task.command).toContain('yt-dlp')
  })

  it('--vidbee-wait blocks then exits 0 on completed', async () => {
    const completed = fakeTask('q1', 'completed')
    const client: ContractClient = {
      ...fakeClient(),
      add: async () => ({ id: 'q1', task: completed }),
      get: async () => completed
    }
    const out: string[] = []
    const r = await run(['--vidbee-local', '--vidbee-wait', 'https://x'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.task.status).toBe('completed')
  })

  it('--vidbee-wait exits 1 on retry-scheduled', async () => {
    const retry = fakeTask('q1', 'retry-scheduled')
    const client: ContractClient = {
      ...fakeClient(),
      add: async () => ({ id: 'q1', task: retry }),
      get: async () => retry
    }
    const out: string[] = []
    const r = await run(['--vidbee-local', '--vidbee-wait', 'https://x'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: fakeConnect(client)
    })
    expect(r.exitCode).toBe(1)
    const env = JSON.parse(out[0] as string)
    expect(env.ok).toBe(false)
  })
})

describe('run() — output formatting', () => {
  it('--vidbee-pretty produces pretty-printed JSON', async () => {
    const { io, out } = makeIO()
    await run(['--vidbee-local', '--vidbee-pretty', ':status'], io)
    expect(out[0]).toContain('\n')
  })
})

describe('run() — :version', () => {
  it('emits CLI/contract version + changelog without contacting any host', async () => {
    const out: string[] = []
    let connectCalled = false
    const r = await run([':version'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      connect: async () => {
        connectCalled = true
        return { kind: 'connected', client: fakeClient() }
      },
      readVersion: () => ({
        cli: '1.2.3',
        contract: '1.2.3',
        changelog: 'https://example.test/changelog'
      })
    })
    expect(r.exitCode).toBe(0)
    expect(connectCalled).toBe(false)
    const env = JSON.parse(out[0] as string)
    expect(env.ok).toBe(true)
    expect(env.mode).toBe('subcommand')
    expect(env.subcommand).toBe('version')
    expect(env.result.cli).toBe('1.2.3')
    expect(env.result.contract).toBe('1.2.3')
    expect(env.result.changelog).toContain('changelog')
  })
})

describe('run() — :upgrade', () => {
  it('reports up-to-date when current >= latest', async () => {
    const out: string[] = []
    const r = await run([':upgrade'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      readVersion: () => ({
        cli: '0.2.0',
        contract: '0.2.0',
        changelog: 'https://example.test/changelog'
      }),
      checkUpgrade: async (input) => ({
        current: input.current,
        latest: '0.2.0',
        upToDate: true,
        cached: false,
        cachedAt: '2026-01-01T00:00:00.000Z',
        registryUrl: 'https://registry.npmjs.org/@vidbee/cli/latest',
        installCommands: {
          npm: 'npm install -g @vidbee/cli',
          pnpm: 'pnpm add -g @vidbee/cli',
          bun: 'bun install -g @vidbee/cli',
          brew: 'brew upgrade vidbee/tap/vidbee'
        }
      })
    })
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(out[0] as string)
    expect(env.subcommand).toBe('upgrade')
    expect(env.result.upToDate).toBe(true)
  })

  it('passes --force through to the upgrade checker', async () => {
    let receivedForce = false
    await run([':upgrade', '--force'], {
      stdout: () => {},
      stderr: () => {},
      readVersion: () => ({ cli: '0.1.0', contract: '0.1.0', changelog: '' }),
      checkUpgrade: async (input) => {
        receivedForce = input.force === true
        return {
          current: input.current,
          latest: '0.2.0',
          upToDate: false,
          cached: false,
          cachedAt: null,
          registryUrl: 'https://registry.npmjs.org/@vidbee/cli/latest',
          installCommands: { npm: '', pnpm: '', bun: '', brew: '' }
        }
      }
    })
    expect(receivedForce).toBe(true)
  })

  it('passes --cache <path> through to the upgrade checker', async () => {
    let receivedCache: string | undefined
    await run([':upgrade', '--cache', '/tmp/x'], {
      stdout: () => {},
      stderr: () => {},
      readVersion: () => ({ cli: '0.1.0', contract: '0.1.0', changelog: '' }),
      checkUpgrade: async (input) => {
        receivedCache = input.cachePath
        return {
          current: input.current,
          latest: '0.1.0',
          upToDate: true,
          cached: false,
          cachedAt: null,
          registryUrl: 'https://registry.npmjs.org/@vidbee/cli/latest',
          installCommands: { npm: '', pnpm: '', bun: '', brew: '' }
        }
      }
    })
    expect(receivedCache).toBe('/tmp/x')
  })

  it('rejects unknown :upgrade flags with exit 2', async () => {
    const out: string[] = []
    const r = await run([':upgrade', '--bogus'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      readVersion: () => ({ cli: '0.1.0', contract: '0.1.0', changelog: '' })
    })
    expect(r.exitCode).toBe(2)
    const env = JSON.parse(out[0] as string)
    expect(env.code).toBe('PARSE_ERROR')
  })

  it('reports HOST_UNREACHABLE when the registry fetch fails', async () => {
    const out: string[] = []
    const r = await run([':upgrade'], {
      stdout: (l) => out.push(l),
      stderr: () => {},
      readVersion: () => ({ cli: '0.1.0', contract: '0.1.0', changelog: '' }),
      checkUpgrade: async () => {
        throw new Error('econnrefused')
      }
    })
    expect(r.exitCode).toBe(3)
    const env = JSON.parse(out[0] as string)
    expect(env.code).toBe('API_UNREACHABLE')
  })
})
