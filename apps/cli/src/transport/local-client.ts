/**
 * `--vidbee-local` in-process transport. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §3, §4.1, §10
 *
 * Instantiates a TaskQueueAPI with a YtDlpExecutor in the calling process
 * — no Desktop, no API server. Used for CI / Docker / `npx @vidbee/cli`
 * and for the three-host equivalence test (`packages/task-queue/__integration__/three-host-equivalence.test.ts`).
 *
 * The persistence layer can be swapped between Memory and Sqlite via
 * options. The default uses an in-memory adapter so the CLI exits
 * cleanly without leftover SQLite files; pass `persist: 'sqlite'` to opt
 * into crash-recovery.
 *
 * Imports of `@vidbee/task-queue` and `@vidbee/downloader-core` are kept
 * as dynamic imports so the parser/probe path can run without those
 * runtime dependencies resolved (e.g. an `npx @vidbee/cli` install that
 * skipped optional yt-dlp deps).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

import type {
  AddTaskRequest,
  Executor,
  Task,
  TaskQueueAPI,
  TaskStatus
} from '@vidbee/task-queue'

import type { ContractClient, ListInput } from '../subcommands'

const require = createRequire(import.meta.url)

export interface LocalClientOptions {
  /** Default download directory. Defaults to `~/Downloads/VidBee`. */
  defaultDownloadDir?: string
  /** Persistence: in-memory (default) or sqlite (for crash-recovery tests). */
  persist?: 'memory' | 'sqlite'
  /** Sqlite path; default is a per-process temp file under `os.tmpdir()`. */
  sqlitePath?: string
  /** yt-dlp binary path (forwarded to YtDlpExecutor). */
  ytDlpPath?: string
  /** ffmpeg directory. */
  ffmpegLocation?: string
  /** Concurrency knob. */
  maxConcurrency?: number
  /**
   * Test seam — supply a pre-built Executor (e.g. a scripted fake from the
   * three-host equivalence harness). When set, the YtDlpExecutor is not
   * instantiated and `ytDlpPath` / `ffmpegLocation` are ignored.
   */
  executor?: Executor
  /** Test seam — disable kernel `processing → completed` fs guard. */
  filePresent?: (path: string) => boolean
  /** Test seam — deterministic backoff jitter for tests. */
  rng?: () => number
}

export interface LocalClientHandle extends ContractClient {
  api: TaskQueueAPI
  /** Tear down (stop API, close persist, remove temp files). */
  shutdown: () => Promise<void>
}

/**
 * Create the in-process client. Returns an object usable as both a
 * ContractClient and a teardown handle.
 */
export async function createLocalClient(
  opts: LocalClientOptions = {}
): Promise<LocalClientHandle> {
  const taskQueue = await import('@vidbee/task-queue')
  const downloaderCore = await import('@vidbee/downloader-core')
  const tqDb = await import('@vidbee/db/task-queue')

  const defaultDir =
    opts.defaultDownloadDir ?? join(homedir(), 'Downloads', 'VidBee')

  let tempDir: string | null = null
  let sqliteDb: { close: () => void } | null = null
  let persistAdapter: InstanceType<typeof taskQueue.MemoryPersistAdapter> | InstanceType<typeof taskQueue.SqlitePersistAdapter>
  if ((opts.persist ?? 'memory') === 'sqlite') {
    tempDir = mkdtempSync(join(tmpdir(), 'vidbee-cli-'))
    const dbPath = opts.sqlitePath ?? join(tempDir, 'task-queue.db')
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath, { timeout: 5000 }) as unknown as {
      exec: (sql: string) => void
      prepare: (sql: string) => unknown
      pragma: (sql: string, opts?: { simple?: boolean }) => unknown
      transaction: (fn: (...args: unknown[]) => unknown) => unknown
      close: () => void
    }
    db.exec(tqDb.TASK_QUEUE_DDL_V1)
    sqliteDb = db
    persistAdapter = new taskQueue.SqlitePersistAdapter({
      db: db as unknown as ConstructorParameters<typeof taskQueue.SqlitePersistAdapter>[0]['db']
    })
  } else {
    persistAdapter = new taskQueue.MemoryPersistAdapter()
  }

  const executor =
    opts.executor ??
    new downloaderCore.YtDlpExecutor({
      resolveYtDlpPath: () => opts.ytDlpPath ?? process.env.YTDLP_PATH ?? 'yt-dlp',
      resolveFfmpegLocation: () => opts.ffmpegLocation ?? process.env.FFMPEG_PATH,
      defaultDownloadDir: defaultDir
    })

  const api = new taskQueue.TaskQueueAPI({
    persist: persistAdapter,
    executor,
    maxConcurrency: opts.maxConcurrency ?? 4,
    ...(opts.filePresent !== undefined ? { filePresent: opts.filePresent } : {}),
    ...(opts.rng !== undefined ? { rng: opts.rng } : {})
  })
  await api.start()

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await api.stop()
    } catch {
      /* noop */
    }
    if (sqliteDb) {
      try {
        sqliteDb.close()
      } catch {
        /* noop */
      }
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* noop */
      }
    }
  }

  const list = async (input: ListInput) => {
    const opts: { status?: TaskStatus; groupKey?: string; parentId?: string; limit?: number; cursor: string | null } = {
      cursor: input.cursor ?? null
    }
    if (input.status !== undefined) opts.status = input.status
    if (input.groupKey !== undefined) opts.groupKey = input.groupKey
    if (input.parentId !== undefined) opts.parentId = input.parentId
    if (input.limit !== undefined) opts.limit = input.limit
    const page = api.list(opts)
    return { items: [...page.tasks] as Task[], nextCursor: page.nextCursor ?? null }
  }

  return {
    api,
    shutdown,
    list,
    get: async (id) => {
      const task = api.get(id)
      if (!task) throw new Error(`task ${id} not found`)
      return task
    },
    stats: async () => api.stats(),
    removeFromHistory: async (id) => {
      await api.removeFromHistory(id)
    },
    add: async (req: AddTaskRequest) => {
      const { id } = await api.add(req)
      const task = api.get(id)
      if (!task) throw new Error(`add() did not produce a task with id ${id}`)
      return { id, task }
    },
    cancel: async (id) => {
      await api.cancel(id)
    },
    pause: async (id, reason) => {
      await api.pause(id, reason)
    },
    resume: async (id) => {
      await api.resume(id)
    },
    retry: async (id) => {
      await api.retryManual(id)
    }
  }
}
