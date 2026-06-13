/**
 * Drizzle schema mirror of the task-queue tables.
 *
 * Authoritative DDL: docs/vidbee-task-queue-state-machine-design.md §9.
 * This file ships the Drizzle table objects (so apps/desktop and apps/api can
 * `db.select().from(tasksTable)`) and the raw SQL migration (so the SQLite
 * persist adapter can run it on a fresh DB).
 */
import {
  index,
  integer,
  sqliteTable,
  text
} from 'drizzle-orm/sqlite-core'

export const tasksTable = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    parentId: text('parent_id'),
    status: text('status').notNull(),
    prevStatus: text('prev_status'),
    statusReason: text('status_reason'),
    enteredStatusAt: integer('entered_status_at', { mode: 'number' }).notNull(),
    priority: integer('priority', { mode: 'number' }).notNull(),
    groupKey: text('group_key').notNull(),
    attempt: integer('attempt', { mode: 'number' }).notNull().default(0),
    maxAttempts: integer('max_attempts', { mode: 'number' }).notNull(),
    nextRetryAt: integer('next_retry_at', { mode: 'number' }),
    pid: integer('pid', { mode: 'number' }),
    pidStartedAt: integer('pid_started_at', { mode: 'number' }),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
    inputJson: text('input_json').notNull(),
    progressJson: text('progress_json'),
    outputJson: text('output_json'),
    lastErrorJson: text('last_error_json')
  },
  (t) => [
    index('idx_tasks_status_priority').on(t.status, t.priority, t.createdAt),
    index('idx_tasks_group').on(t.groupKey, t.status),
    index('idx_tasks_next_retry').on(t.nextRetryAt),
    index('idx_tasks_parent').on(t.parentId)
  ]
)

export const attemptsTable = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasksTable.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number', { mode: 'number' }).notNull(),
    startedAt: integer('started_at', { mode: 'number' }).notNull(),
    endedAt: integer('ended_at', { mode: 'number' }),
    exitCode: integer('exit_code', { mode: 'number' }),
    errorCategory: text('error_category'),
    stdoutTail: text('stdout_tail'),
    stderrTail: text('stderr_tail'),
    rawArgsHash: text('raw_args_hash').notNull()
  },
  (t) => [index('idx_attempts_task').on(t.taskId, t.attemptNumber)]
)

export const processJournalTable = sqliteTable(
  'process_journal',
  {
    seq: integer('seq', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    ts: integer('ts', { mode: 'number' }).notNull(),
    op: text('op').notNull(),
    taskId: text('task_id').notNull(),
    attemptId: text('attempt_id'),
    pid: integer('pid', { mode: 'number' }).notNull(),
    pidStartedAt: integer('pid_started_at', { mode: 'number' }),
    exitCode: integer('exit_code', { mode: 'number' }),
    signal: text('signal')
  },
  (t) => [
    index('idx_journal_task').on(t.taskId),
    index('idx_journal_open').on(t.op)
  ]
)

export const schemaMetaTable = sqliteTable('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export type TaskRow = typeof tasksTable.$inferSelect
export type TaskInsert = typeof tasksTable.$inferInsert
export type AttemptRowDb = typeof attemptsTable.$inferSelect
export type AttemptInsert = typeof attemptsTable.$inferInsert
export type ProcessJournalRowDb = typeof processJournalTable.$inferSelect
export type ProcessJournalInsert = typeof processJournalTable.$inferInsert

/**
 * Raw SQL the SqlitePersistAdapter applies to a fresh DB. Keep this in lock-
 * step with the Drizzle table objects above and with the design doc §9.
 *
 * `schema_meta` carries `('version', '1')` after this migration runs; the
 * orchestrator's start() refuses to open a DB whose version it does not know.
 */
export const TASK_QUEUE_DDL_V1 = `
CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL,
  parent_id           TEXT REFERENCES tasks(id),
  status              TEXT NOT NULL,
  prev_status         TEXT,
  status_reason       TEXT,
  entered_status_at   INTEGER NOT NULL,
  priority            INTEGER NOT NULL,
  group_key           TEXT NOT NULL,
  attempt             INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL,
  next_retry_at       INTEGER,
  pid                 INTEGER,
  pid_started_at      INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  input_json          TEXT NOT NULL,
  progress_json       TEXT,
  output_json         TEXT,
  last_error_json     TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_group           ON tasks(group_key, status);
CREATE INDEX IF NOT EXISTS idx_tasks_next_retry      ON tasks(next_retry_at) WHERE status = 'retry-scheduled';
CREATE INDEX IF NOT EXISTS idx_tasks_parent          ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS attempts (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_number      INTEGER NOT NULL,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  exit_code           INTEGER,
  error_category      TEXT,
  stdout_tail         TEXT,
  stderr_tail         TEXT,
  raw_args_hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_task ON attempts(task_id, attempt_number);

CREATE TABLE IF NOT EXISTS process_journal (
  seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                  INTEGER NOT NULL,
  op                  TEXT NOT NULL,
  task_id             TEXT NOT NULL,
  attempt_id          TEXT,
  pid                 INTEGER NOT NULL,
  pid_started_at      INTEGER,
  exit_code           INTEGER,
  signal              TEXT
);
CREATE INDEX IF NOT EXISTS idx_journal_task ON process_journal(task_id);
CREATE INDEX IF NOT EXISTS idx_journal_open ON process_journal(op) WHERE op = 'spawn';

CREATE TABLE IF NOT EXISTS schema_meta (
  key                 TEXT PRIMARY KEY,
  value               TEXT NOT NULL
);
INSERT INTO schema_meta (key, value) VALUES ('task_queue_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
`
