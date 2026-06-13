/**
 * Memory implementation of PersistAdapter — used by tests and for the
 * `--vidbee-local` CLI mode where there is no SQLite file.
 *
 * Behaves like SQLite for the purposes of our state-machine tests:
 * findOpenSpawns walks the journal looking for spawn rows without a
 * close/killed peer.
 */
import type {
  AttemptRow,
  ProcessJournalRow,
  Task,
  TaskProgress
} from '../types'
import type {
  JournalAppendInput,
  PersistAdapter,
  PersistTransitionInput,
  RecordCloseInput,
  RecordSpawnInput
} from './adapter'

export class MemoryPersistAdapter implements PersistAdapter {
  private readonly tasks = new Map<string, Task>()
  private readonly progress = new Map<string, TaskProgress>()
  private readonly attempts = new Map<string, AttemptRow>()
  private readonly journal: ProcessJournalRow[] = []
  private journalSeq = 0

  async insertTask(task: Task): Promise<void> {
    this.tasks.set(task.id, structuredClone(task))
    this.progress.set(task.id, structuredClone(task.progress))
  }

  async upsertTask(input: PersistTransitionInput): Promise<void> {
    this.tasks.set(input.task.id, structuredClone(input.task))
    this.progress.set(input.task.id, structuredClone(input.progress))
  }

  async upsertProgress(taskId: string, progress: TaskProgress): Promise<void> {
    this.progress.set(taskId, structuredClone(progress))
    const t = this.tasks.get(taskId)
    if (t) t.progress = structuredClone(progress)
  }

  async deleteTask(taskId: string): Promise<void> {
    this.tasks.delete(taskId)
    this.progress.delete(taskId)
  }

  async insertAttempt(input: RecordSpawnInput): Promise<void> {
    const t = this.tasks.get(input.taskId)
    const attemptNumber = t?.attempt ?? 1
    this.attempts.set(input.attemptId, {
      id: input.attemptId,
      taskId: input.taskId,
      attemptNumber,
      startedAt: input.startedAt,
      endedAt: null,
      exitCode: null,
      errorCategory: null,
      stdoutTail: null,
      stderrTail: null,
      rawArgsHash: input.rawArgsHash
    })
  }

  async closeAttempt(input: RecordCloseInput): Promise<void> {
    const existing = this.attempts.get(input.attemptId)
    if (!existing) return
    this.attempts.set(input.attemptId, {
      ...existing,
      endedAt: input.endedAt,
      exitCode: input.exitCode,
      errorCategory: input.errorCategory,
      stdoutTail: input.stdoutTail,
      stderrTail: input.stderrTail
    })
  }

  async appendJournal(input: JournalAppendInput): Promise<void> {
    this.journal.push({
      seq: ++this.journalSeq,
      ts: input.ts,
      op: input.op,
      taskId: input.taskId,
      attemptId: input.attemptId,
      pid: input.pid,
      pidStartedAt: input.pidStartedAt,
      exitCode: input.exitCode,
      signal: input.signal
    })
  }

  async findOpenSpawns(): Promise<ProcessJournalRow[]> {
    const closed = new Set<string>()
    for (const row of this.journal) {
      if (row.op === 'close' || row.op === 'killed') {
        closed.add(this.journalKey(row))
      }
    }
    const result: ProcessJournalRow[] = []
    for (const row of this.journal) {
      if (row.op !== 'spawn') continue
      if (closed.has(this.journalKey(row))) continue
      result.push(row)
    }
    return result
  }

  async loadAllTasks(): Promise<Task[]> {
    return [...this.tasks.values()].map((t) => structuredClone(t))
  }

  async loadLatestAttempt(taskId: string): Promise<AttemptRow | null> {
    let best: AttemptRow | null = null
    for (const a of this.attempts.values()) {
      if (a.taskId !== taskId) continue
      if (!best || a.attemptNumber > best.attemptNumber) best = a
    }
    return best
  }

  /** Test helper: not part of the interface. */
  journalSnapshot(): readonly ProcessJournalRow[] {
    return this.journal
  }

  private journalKey(row: ProcessJournalRow): string {
    return `${row.taskId}:${row.attemptId ?? 'null'}:${row.pid}`
  }
}
