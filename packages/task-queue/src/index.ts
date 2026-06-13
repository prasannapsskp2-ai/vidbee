// Public surface of @vidbee/task-queue. Adapters import from here.

export * from './types'
export * from './schemas'
export { taskQueueContract } from './contract'
export type { TaskQueueContract } from './contract'

export {
  IllegalTransitionError,
  isLegalTransition,
  LEGAL_TRANSITIONS,
  transition
} from './fsm'
export type { TransitionContext, TransitionTrigger } from './fsm'

export {
  CLASSIFIER_RULES,
  classify,
  defaultMaxAttempts,
  getRuleForCategory,
  parseRetryAfter,
  sanitizeOutput,
  takeStderrTail,
  virtualError
} from './classifier'
export type { ClassifyInput } from './classifier'

export {
  EventBus
} from './events'
export type {
  ErrorClassifiedEvent,
  OrphanKilledEvent,
  ProgressEvent,
  SnapshotChangedEvent,
  TaskQueueEvent,
  TaskQueueEventType,
  TaskQueueListener,
  TransitionEvent
} from './events'

export {
  computeBackoffMs,
  RetryScheduler,
  Scheduler
} from './scheduler'
export type {
  RetrySchedulerOptions,
  SchedulerCallbacks,
  SchedulerOptions
} from './scheduler'

export { TaskStore } from './store'

export {
  isPidAlive,
  ProcessRegistry,
  readPidStartTime,
  setReadPidStartTimeImpl,
  Watchdog
} from './process'
export type {
  ProcessHandle,
  ProcessRegistryDeps,
  ReadPidStartTimeFn,
  WatchdogConfig,
  WatchdogEntry
} from './process'

export type {
  Executor,
  ExecutorContext,
  ExecutorEvents,
  ExecutorFinishEvent,
  ExecutorProgressEvent,
  ExecutorRun,
  ExecutorSpawnEvent,
  ExecutorStdEvent
} from './executor'

export {
  MemoryPersistAdapter,
  SqlitePersistAdapter
} from './persist'
export type {
  JournalAppendInput,
  PersistAdapter,
  PersistTransitionInput,
  RecordCloseInput,
  RecordSpawnInput,
  SqlitePersistOptions
} from './persist'

export { TaskQueueAPI } from './api'
export type {
  AddTaskRequest,
  ListOptions,
  TaskQueueAPIOptions
} from './api'

export {
  legacyDownloadStatusOf,
  legacySubStatusOf,
  projectTaskToLegacy
} from './projection'
export type {
  LegacyDownloadProgress,
  LegacyDownloadStatus,
  LegacySubStatus,
  LegacyTaskProjection
} from './projection'
