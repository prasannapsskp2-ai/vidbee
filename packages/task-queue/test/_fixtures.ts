import type { Task, TaskInput, TaskPriority, TaskStatus } from '../src/types'
import { EMPTY_PROGRESS } from '../src/types'

let counter = 0

export function makeTaskInput(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    url: 'https://example.com/v/abc',
    kind: 'video',
    ...overrides
  }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? `t-${++counter}`
  const now = overrides.createdAt ?? 1_700_000_000_000
  const status: TaskStatus = overrides.status ?? 'queued'
  return {
    id,
    kind: 'video',
    parentId: null,
    input: makeTaskInput(),
    priority: 0 as TaskPriority,
    groupKey: 'example.com',
    status,
    prevStatus: null,
    statusReason: null,
    enteredStatusAt: now,
    attempt: 0,
    maxAttempts: 5,
    nextRetryAt: null,
    progress: { ...EMPTY_PROGRESS },
    output: null,
    lastError: null,
    pid: null,
    pidStartedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}
