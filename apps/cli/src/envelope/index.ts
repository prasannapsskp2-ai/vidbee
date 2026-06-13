/**
 * JSON envelope shapes the CLI prints. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §4.4
 *
 * Every CLI invocation produces exactly one JSON document on stdout.
 * Exit code is determined by ExitCode below; envelope and exit code
 * MUST be consistent.
 */

import type { Task } from '@vidbee/task-queue'

export const ExitCode = {
  /** probe success | detached download enqueue success | wait-mode success */
  OK: 0,
  /** wait-mode terminated non-success (failed | retry-scheduled) */
  WAIT_NON_SUCCESS: 1,
  /** argv parse error (incl. unknown --vidbee-*) */
  ARG_ERROR: 2,
  /** desktop / api unreachable: descriptor missing, conn refused, handshake failed */
  HOST_UNREACHABLE: 3,
  /** auth failure */
  AUTH_FAILED: 4,
  /** internal contract error (schema mismatch, version mismatch) */
  CONTRACT_ERROR: 5
} as const

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode]

export interface ProbeSuccessEnvelope {
  ok: true
  mode: 'probe'
  command: string
  ytDlp: { exitCode: number; stdout: string; stderr: string }
}

export interface DownloadDetachedEnvelope {
  ok: true
  mode: 'download'
  task: Pick<Task, 'id' | 'status' | 'attempt' | 'maxAttempts'> & {
    command: string
  }
}

export interface DownloadWaitSuccessEnvelope {
  ok: true
  mode: 'download'
  task: Task
  ytDlp: { exitCode: number; stdoutTail: string; stderrTail: string }
}

export interface DownloadWaitFailureEnvelope {
  ok: false
  mode: 'download'
  task: Task
  ytDlp: { exitCode: number; stdoutTail: string; stderrTail: string }
}

export type ErrorCode =
  | 'PARSE_ERROR'
  | 'UNKNOWN_VIDBEE_FLAG'
  | 'INVALID_TARGET'
  | 'INVALID_PRIORITY'
  | 'INVALID_MAX_ATTEMPTS'
  | 'INVALID_TIMEOUT'
  | 'MISSING_VALUE'
  | 'UNEXPECTED_VALUE'
  | 'STDOUT_OUTPUT_DISALLOWED'
  | 'PROBE_OUTPUT_TOO_LARGE'
  | 'DESKTOP_NOT_READY'
  | 'API_UNREACHABLE'
  | 'HANDSHAKE_FAILED'
  | 'TOKEN_EXPIRED'
  | 'AUTH_FAILED'
  | 'CONTRACT_VERSION_MISMATCH'
  | 'CONTRACT_SCHEMA_MISMATCH'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN_ERROR'

export interface ErrorEnvelope {
  ok: false
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}

export type Envelope =
  | ProbeSuccessEnvelope
  | DownloadDetachedEnvelope
  | DownloadWaitSuccessEnvelope
  | DownloadWaitFailureEnvelope
  | ErrorEnvelope
  | { ok: true; mode: 'subcommand'; subcommand: string; result: unknown }

export interface RenderOptions {
  pretty?: boolean
}

export function renderEnvelope(env: Envelope, opts: RenderOptions = {}): string {
  return opts.pretty ? JSON.stringify(env, null, 2) : JSON.stringify(env)
}

/**
 * Map an ErrorCode to its corresponding exit code per §4.4. Anything not
 * in the explicit map falls through to `ARG_ERROR` (2) so a bug here can
 * never silently produce exit 0.
 */
export function exitCodeForError(code: ErrorCode): ExitCode {
  switch (code) {
    case 'DESKTOP_NOT_READY':
    case 'API_UNREACHABLE':
    case 'HANDSHAKE_FAILED':
      return ExitCode.HOST_UNREACHABLE
    case 'AUTH_FAILED':
    case 'TOKEN_EXPIRED':
      return ExitCode.AUTH_FAILED
    case 'CONTRACT_VERSION_MISMATCH':
    case 'CONTRACT_SCHEMA_MISMATCH':
      return ExitCode.CONTRACT_ERROR
    case 'PROBE_OUTPUT_TOO_LARGE':
      return ExitCode.WAIT_NON_SUCCESS
    case 'NOT_IMPLEMENTED':
      return ExitCode.CONTRACT_ERROR
    default:
      return ExitCode.ARG_ERROR
  }
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): ErrorEnvelope {
  return details === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, details }
}
