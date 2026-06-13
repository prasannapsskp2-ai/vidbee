/**
 * Desktop one-shot data migration: legacy `download-session.json` and the
 * legacy `download_history` table → new `tasks` table (NEX-131 A段).
 *
 * Idempotent: every INSERT uses ON CONFLICT(id) DO NOTHING so re-running
 * is safe. Rolls back the migration marker on failure; leaves the legacy
 * data untouched so the app continues to read from it.
 *
 * State map (per NEX-131 issue body §A · 数据迁移):
 *   pending                  → queued
 *   downloading | processing → paused('legacy-recovery')   (no fake progress)
 *   error                    → failed
 *   cancelled                → cancelled
 *   completed                → completed
 */
import fs from 'node:fs'
import path from 'node:path'
import { TASK_QUEUE_DDL_V1 } from '@vidbee/db/task-queue'
import {
  PRIORITY_BACKGROUND,
  PRIORITY_USER,
  type Task,
  type TaskOutput,
  type TaskStatus
} from '@vidbee/task-queue'
import { app } from 'electron'
import { scopedLoggers } from '../utils/logger'
import { getDatabaseFilePath } from './database-path'

const TASK_QUEUE_DB_NAME = 'task-queue.db'
const SESSION_FILE = 'download-session.json'

const logger = scopedLoggers.engine

interface SessionItem {
  id: string
  options: {
    url: string
    type: 'video' | 'audio'
    title?: string
    thumbnail?: string
    customDownloadPath?: string
    customFilenameTemplate?: string
    format?: string
    audioFormat?: string
    audioFormatIds?: string[]
    startTime?: string
    endTime?: string
    containerFormat?: string
  }
  item: {
    id: string
    url: string
    title?: string
    thumbnail?: string
    type: 'video' | 'audio'
    status: 'pending' | 'downloading' | 'processing' | 'completed' | 'error' | 'cancelled'
    progress?: { percent?: number }
    error?: string
    speed?: string
    duration?: number
    fileSize?: number
    savedFileName?: string
    createdAt: number
    startedAt?: number
    completedAt?: number
    description?: string
    channel?: string
    uploader?: string
    viewCount?: number
    tags?: string[]
    origin?: 'manual' | 'subscription'
    subscriptionId?: string
    playlistId?: string
    playlistTitle?: string
    playlistIndex?: number
    playlistSize?: number
  }
}

interface LegacyHistoryRow {
  id: string
  url: string
  title: string
  thumbnail: string | null
  type: string
  status: string
  download_path: string | null
  saved_file_name: string | null
  file_size: number | null
  duration: number | null
  downloaded_at: number
  completed_at: number | null
  sort_key: number
  error: string | null
  yt_dlp_command: string | null
  yt_dlp_log: string | null
  description: string | null
  channel: string | null
  uploader: string | null
  view_count: number | null
  tags: string | null
  origin: string | null
  subscription_id: string | null
  selected_format: string | null
  playlist_id: string | null
  playlist_title: string | null
  playlist_index: number | null
  playlist_size: number | null
}

const SESSION_STATUS_MAP: Record<SessionItem['item']['status'], TaskStatus> = {
  pending: 'queued',
  downloading: 'paused',
  processing: 'paused',
  completed: 'completed',
  error: 'failed',
  cancelled: 'cancelled'
}

const TERMINAL_LEGACY: Record<string, TaskStatus | undefined> = {
  completed: 'completed',
  error: 'failed',
  cancelled: 'cancelled'
}

const readSessionFile = (filePath: string): SessionItem[] => {
  if (!fs.existsSync(filePath)) {
    return []
  }
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      version?: number
      items?: SessionItem[]
    }
    if (payload.version !== 1 || !Array.isArray(payload.items)) {
      return []
    }
    return payload.items.filter((it) => Boolean(it?.id && it.options && it.item))
  } catch (err) {
    logger.warn('task-queue-migrate: failed to read session file:', err)
    return []
  }
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).host || 'unknown'
  } catch {
    return 'unknown'
  }
}

const sessionItemToTask = (s: SessionItem, now: number): Task => {
  const status = SESSION_STATUS_MAP[s.item.status] ?? 'queued'
  const isPaused = status === 'paused'
  const completedAt = s.item.completedAt ?? null
  const filePath =
    s.item.savedFileName && s.options.customDownloadPath
      ? path.join(s.options.customDownloadPath, s.item.savedFileName)
      : (s.item.savedFileName ?? '')
  const output: TaskOutput | null =
    status === 'completed' && filePath
      ? {
          filePath,
          size: s.item.fileSize ?? 0,
          durationMs: s.item.duration == null ? null : s.item.duration * 1000,
          sha256: null
        }
      : null
  return {
    id: s.id,
    kind: s.item.type === 'audio' ? 'audio' : 'video',
    parentId: null,
    input: {
      url: s.options.url,
      kind: s.options.type === 'audio' ? 'audio' : 'video',
      title: s.item.title,
      thumbnail: s.item.thumbnail,
      subscriptionId: s.item.subscriptionId,
      playlistId: s.item.playlistId,
      playlistIndex: s.item.playlistIndex,
      options: {
        type: s.options.type,
        format: s.options.format,
        audioFormat: s.options.audioFormat,
        audioFormatIds: s.options.audioFormatIds,
        startTime: s.options.startTime,
        endTime: s.options.endTime,
        customDownloadPath: s.options.customDownloadPath,
        customFilenameTemplate: s.options.customFilenameTemplate,
        containerFormat: s.options.containerFormat as never,
        title: s.item.title,
        thumbnail: s.item.thumbnail,
        description: s.item.description,
        channel: s.item.channel,
        uploader: s.item.uploader,
        viewCount: s.item.viewCount,
        tags: s.item.tags,
        duration: s.item.duration,
        playlistTitle: s.item.playlistTitle,
        playlistSize: s.item.playlistSize,
        downloadPath: s.options.customDownloadPath,
        fileSize: s.item.fileSize,
        startedAt: s.item.startedAt,
        completedAt: s.item.completedAt
      }
    },
    priority: PRIORITY_USER,
    groupKey: s.item.subscriptionId ? `sub:${s.item.subscriptionId}` : safeHost(s.options.url),
    status,
    prevStatus: null,
    statusReason: isPaused ? 'legacy-recovery' : 'legacy-import',
    enteredStatusAt: completedAt ?? s.item.startedAt ?? s.item.createdAt ?? now,
    attempt: 0,
    maxAttempts: isPaused ? 5 : 0,
    nextRetryAt: null,
    progress: {
      // Don't pretend the in-flight progress is still valid; keep nulls so
      // the UI shows "paused, can resume" rather than a frozen percentage.
      percent: status === 'completed' ? 1 : null,
      bytesDownloaded: status === 'completed' ? (s.item.fileSize ?? null) : null,
      bytesTotal: status === 'completed' ? (s.item.fileSize ?? null) : null,
      speedBps: null,
      etaMs: null,
      ticks: 0
    },
    output,
    lastError:
      status === 'failed'
        ? {
            category: 'unknown',
            exitCode: null,
            rawMessage: s.item.error ?? 'legacy-import',
            uiMessageKey: 'errors.legacy_import',
            uiActionHints: [],
            retryable: false,
            suggestedRetryAfterMs: null
          }
        : null,
    pid: null,
    pidStartedAt: null,
    createdAt: s.item.createdAt ?? now,
    updatedAt: completedAt ?? s.item.startedAt ?? s.item.createdAt ?? now
  }
}

const historyRowToTask = (row: LegacyHistoryRow): Task | null => {
  const status = TERMINAL_LEGACY[row.status]
  if (!status) {
    return null
  }
  const filePath =
    row.download_path && row.saved_file_name
      ? path.join(row.download_path, row.saved_file_name)
      : (row.download_path ?? '')
  const output: TaskOutput | null =
    status === 'completed'
      ? {
          filePath,
          size: row.file_size ?? 0,
          durationMs: row.duration == null ? null : row.duration * 1000,
          sha256: null
        }
      : null
  const completedAt = row.completed_at ?? row.downloaded_at
  return {
    id: row.id,
    kind: row.type === 'audio' ? 'audio' : 'video',
    parentId: null,
    input: {
      url: row.url,
      kind: row.type === 'audio' ? 'audio' : 'video',
      title: row.title,
      thumbnail: row.thumbnail ?? undefined,
      subscriptionId: row.subscription_id ?? undefined,
      playlistId: row.playlist_id ?? undefined,
      playlistIndex: row.playlist_index ?? undefined,
      options: {
        type: row.type === 'audio' ? 'audio' : 'video',
        title: row.title,
        thumbnail: row.thumbnail ?? undefined,
        description: row.description ?? undefined,
        channel: row.channel ?? undefined,
        uploader: row.uploader ?? undefined,
        viewCount: row.view_count ?? undefined,
        tags: parseTags(row.tags),
        duration: row.duration ?? undefined,
        playlistTitle: row.playlist_title ?? undefined,
        playlistSize: row.playlist_size ?? undefined,
        downloadPath: row.download_path ?? undefined,
        fileSize: row.file_size ?? undefined,
        startedAt: row.downloaded_at,
        completedAt
      }
    },
    priority: PRIORITY_BACKGROUND,
    groupKey: row.subscription_id ? `sub:${row.subscription_id}` : safeHost(row.url),
    status,
    prevStatus: null,
    statusReason: 'legacy-import',
    enteredStatusAt: completedAt,
    attempt: 0,
    maxAttempts: 0,
    nextRetryAt: null,
    progress: {
      percent: status === 'completed' ? 1 : null,
      bytesDownloaded: row.file_size ?? null,
      bytesTotal: row.file_size ?? null,
      speedBps: null,
      etaMs: null,
      ticks: 0
    },
    output,
    lastError:
      status === 'failed'
        ? {
            category: 'unknown',
            exitCode: null,
            rawMessage: row.error ?? 'legacy-import',
            uiMessageKey: 'errors.legacy_import',
            uiActionHints: [],
            retryable: false,
            suggestedRetryAfterMs: null
          }
        : null,
    pid: null,
    pidStartedAt: null,
    createdAt: row.downloaded_at,
    updatedAt: completedAt
  }
}

const parseTags = (value: string | null): string[] | undefined => {
  if (!value) {
    return undefined
  }
  const tags = value
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return tags.length > 0 ? tags : undefined
}

const bindTask = (task: Task): unknown[] => [
  task.id,
  task.kind,
  task.parentId,
  task.status,
  task.prevStatus,
  task.statusReason,
  task.enteredStatusAt,
  task.priority,
  task.groupKey,
  task.attempt,
  task.maxAttempts,
  task.nextRetryAt,
  task.pid,
  task.pidStartedAt,
  task.createdAt,
  task.updatedAt,
  JSON.stringify(task.input),
  JSON.stringify(task.progress),
  task.output ? JSON.stringify(task.output) : null,
  task.lastError ? JSON.stringify(task.lastError) : null
]

interface MigrateResult {
  sessionImported: number
  historyImported: number
  rolledBack: boolean
}

export const runDesktopTaskQueueMigration = (): MigrateResult => {
  const result: MigrateResult = {
    sessionImported: 0,
    historyImported: 0,
    rolledBack: false
  }
  const userData = app.getPath('userData')
  const taskQueueDbPath = path.join(userData, '.vidbee', TASK_QUEUE_DB_NAME)
  const sessionFile = path.join(userData, SESSION_FILE)
  const legacyHistoryDb = getDatabaseFilePath()

  fs.mkdirSync(path.dirname(taskQueueDbPath), { recursive: true })

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const queueDb = new Database(taskQueueDbPath, { timeout: 5000 })
  queueDb.pragma('journal_mode = WAL')
  queueDb.pragma('foreign_keys = ON')
  queueDb.exec(TASK_QUEUE_DDL_V1)

  // Skip if there's already non-legacy data in tasks AND no legacy artifacts.
  const tasksCountRow = queueDb.prepare('SELECT COUNT(*) AS n FROM tasks').get() as
    | { n: number | bigint }
    | undefined
  const tasksCount = Number(tasksCountRow?.n ?? 0)
  const hasSessionFile = fs.existsSync(sessionFile)
  const hasLegacyDb = fs.existsSync(legacyHistoryDb)
  if (tasksCount > 0 && !hasSessionFile && !hasLegacyDb) {
    queueDb.close()
    return result
  }

  queueDb
    .prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('migration_in_progress','desktop-v1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run()

  const insertOrSkip = queueDb.prepare(`
    INSERT INTO tasks (
      id, kind, parent_id, status, prev_status, status_reason, entered_status_at,
      priority, group_key, attempt, max_attempts, next_retry_at, pid,
      pid_started_at, created_at, updated_at, input_json, progress_json,
      output_json, last_error_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `)

  try {
    const sessionItems = readSessionFile(sessionFile)
    const now = Date.now()
    const sessionTx = queueDb.transaction((items: SessionItem[]) => {
      let imported = 0
      for (const item of items) {
        const task = sessionItemToTask(item, now)
        const r = insertOrSkip.run(...bindTask(task))
        if (r.changes > 0) {
          imported += 1
        }
      }
      return imported
    })
    result.sessionImported = sessionTx(sessionItems) as number

    if (hasLegacyDb) {
      let legacyDb: import('better-sqlite3').Database | null = null
      try {
        legacyDb = new Database(legacyHistoryDb, { readonly: true, fileMustExist: true })
        const tableCheck = legacyDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='download_history'")
          .get() as { name?: string } | undefined
        if (tableCheck?.name) {
          const rows = legacyDb
            .prepare('SELECT * FROM download_history ORDER BY sort_key ASC')
            .all() as LegacyHistoryRow[]
          const historyTx = queueDb.transaction((source: LegacyHistoryRow[]) => {
            let imported = 0
            for (const row of source) {
              const task = historyRowToTask(row)
              if (!task) {
                continue
              }
              const r = insertOrSkip.run(...bindTask(task))
              if (r.changes > 0) {
                imported += 1
              }
            }
            return imported
          })
          result.historyImported = historyTx(rows) as number
        }
      } finally {
        legacyDb?.close()
      }
    }

    queueDb.prepare("DELETE FROM schema_meta WHERE key = 'migration_in_progress'").run()

    if (hasSessionFile) {
      try {
        const migratedPath = `${sessionFile}.migrated`
        if (!fs.existsSync(migratedPath)) {
          fs.renameSync(sessionFile, migratedPath)
        }
      } catch (err) {
        logger.warn('task-queue-migrate: could not rename session file:', err)
      }
    }

    logger.info(
      `task-queue-migrate: session imported ${result.sessionImported}, history imported ${result.historyImported}`
    )
  } catch (err) {
    result.rolledBack = true
    queueDb.prepare("DELETE FROM schema_meta WHERE key = 'migration_in_progress'").run()
    queueDb.close()
    logger.error('task-queue-migrate: failed; legacy data preserved:', err)
    return result
  }

  queueDb.close()
  return result
}
