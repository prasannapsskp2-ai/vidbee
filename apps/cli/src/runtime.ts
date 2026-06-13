/**
 * The CLI's `main(argv)`. Exported so unit tests can drive it without
 * spawning a subprocess. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §4
 *
 * The runtime is split into the cold path (parse argv, choose transport,
 * connect) and the hot paths (subcommand dispatch, yt-dlp probe, yt-dlp
 * download enqueue). Each hot path is a separate function so tests can
 * drive them in isolation.
 */

import { ParseError, parseArgv } from './parser'
import {
  ExitCode,
  errorEnvelope,
  exitCodeForError,
  renderEnvelope,
  type Envelope,
  type ErrorEnvelope
} from './envelope'
import {
  dispatchSubcommand,
  type ContractClient,
  type SubcommandContext
} from './subcommands'
import { selectTransport, validateApiUrl } from './transport'
import { connect, type ConnectOptions, type ConnectResult } from './transport/connect'
import { buildForwardedInput } from './download/build-input'
import { enqueueDownload } from './download/enqueue'
import { runProbe, type ProbeOptions } from './download/probe'
import { redactArgs, redactText } from './parser/redact'
import {
  checkUpgrade,
  readCliVersion,
  type CliVersionInfo,
  type UpgradeCheckInput,
  type UpgradeCheckResult
} from './local-info'

export interface RunIO {
  stdout: (line: string) => void
  stderr: (line: string) => void
  /**
   * Test seam — overrides the entire transport-selection / connect step.
   * Production wiring uses `connect()` from ./transport/connect.
   */
  connect?: (opts: ConnectOptions) => Promise<ConnectResult>
  /** Test seam — overrides yt-dlp probe spawn. */
  probe?: (opts: ProbeOptions) => ReturnType<typeof runProbe>
  /** Test seam — overrides `:version` resolution. */
  readVersion?: () => CliVersionInfo
  /**
   * Test seam — overrides `:upgrade` registry / cache I/O. Receives the
   * resolved CLI version and any subcommand args (`--force`, `--no-cache`,
   * `--cache <path>`).
   */
  checkUpgrade?: (input: UpgradeCheckInput) => Promise<UpgradeCheckResult>
}

export interface RunResult {
  exitCode: number
  envelope: Envelope
}

export async function run(argv: readonly string[], io: RunIO): Promise<RunResult> {
  let parsed: ReturnType<typeof parseArgv>
  try {
    parsed = parseArgv(argv)
  } catch (err) {
    if (err instanceof ParseError) {
      const env = errorEnvelope(coerceErrorCode(err.code), err.message)
      return emit(io, env, false, ExitCode.ARG_ERROR)
    }
    throw err
  }

  const pretty = parsed.flags.pretty

  if (parsed.flags.api !== undefined) {
    const bad = validateApiUrl(parsed.flags.api)
    if (bad) return emit(io, bad, pretty, ExitCode.HOST_UNREACHABLE)
  }

  const connectImpl = io.connect ?? connect

  if (parsed.kind === 'ytdlp') {
    if (parsed.mode === 'probe') {
      return await runProbeMode(parsed, io, pretty)
    }
    return await runDownloadMode(parsed, io, pretty, connectImpl)
  }

  // Local-only subcommands run without contacting Desktop / API. They are
  // dispatched here so a missing automation descriptor doesn't make
  // `vidbee :version` fail with HOST_UNREACHABLE.
  if (parsed.subcommand === 'version' || parsed.subcommand === 'upgrade') {
    return await runLocalSubcommand(parsed.subcommand, parsed.subArgs, io, pretty)
  }

  // Subcommand path
  const conn = await connectImpl({ flags: parsed.flags })
  if (conn.kind === 'error') {
    return emit(io, conn.envelope, pretty, exitCodeForError(conn.envelope.code))
  }

  const ctx: SubcommandContext = { client: conn.client }
  try {
    const result = await dispatchSubcommand(parsed.subcommand, parsed.subArgs, ctx)
    if (result.kind === 'error') {
      return emit(io, result.envelope, pretty, exitCodeForError(result.envelope.code))
    }
    const env: Envelope = {
      ok: true,
      mode: 'subcommand',
      subcommand: parsed.subcommand,
      result: result.value
    }
    return emit(io, env, pretty, ExitCode.OK)
  } catch (err) {
    const env = errorEnvelope(
      'UNKNOWN_ERROR',
      err instanceof Error ? err.message : String(err)
    )
    return emit(io, env, pretty, ExitCode.ARG_ERROR)
  } finally {
    await safeTeardown(conn)
  }
}

type YtdlpParsed = Extract<ReturnType<typeof parseArgv>, { kind: 'ytdlp' }>

async function runLocalSubcommand(
  subcommand: 'version' | 'upgrade',
  subArgs: readonly string[],
  io: RunIO,
  pretty: boolean
): Promise<RunResult> {
  const versionInfo = (io.readVersion ?? readCliVersion)()
  if (subcommand === 'version') {
    const env: Envelope = {
      ok: true,
      mode: 'subcommand',
      subcommand: 'version',
      result: versionInfo
    }
    return emit(io, env, pretty, ExitCode.OK)
  }
  // :upgrade
  const upgradeImpl = io.checkUpgrade ?? checkUpgrade
  const opts = parseUpgradeArgs(subArgs)
  if (opts.kind === 'error') return emit(io, opts.envelope, pretty, ExitCode.ARG_ERROR)
  try {
    const result = await upgradeImpl({
      current: versionInfo.cli,
      ...(opts.force ? { force: true } : {}),
      ...(opts.cachePath !== undefined ? { cachePath: opts.cachePath } : {})
    })
    const env: Envelope = {
      ok: true,
      mode: 'subcommand',
      subcommand: 'upgrade',
      result
    }
    return emit(io, env, pretty, ExitCode.OK)
  } catch (err) {
    const env = errorEnvelope(
      'API_UNREACHABLE',
      err instanceof Error ? err.message : String(err),
      { registry: 'https://registry.npmjs.org/@vidbee/cli/latest' }
    )
    return emit(io, env, pretty, ExitCode.HOST_UNREACHABLE)
  }
}

interface UpgradeArgs {
  kind: 'ok'
  force: boolean
  cachePath?: string
}
function parseUpgradeArgs(
  subArgs: readonly string[]
): UpgradeArgs | { kind: 'error'; envelope: ErrorEnvelope } {
  const out: UpgradeArgs = { kind: 'ok', force: false }
  for (let i = 0; i < subArgs.length; i++) {
    const tok = subArgs[i]
    if (tok === undefined) continue
    if (tok === '--force') {
      out.force = true
      continue
    }
    if (tok === '--cache') {
      const next = subArgs[i + 1]
      if (next === undefined) {
        return {
          kind: 'error',
          envelope: errorEnvelope('MISSING_VALUE', '--cache requires a path')
        }
      }
      out.cachePath = next
      i += 1
      continue
    }
    if (tok.startsWith('--cache=')) {
      out.cachePath = tok.slice('--cache='.length)
      continue
    }
    return {
      kind: 'error',
      envelope: errorEnvelope('PARSE_ERROR', `unknown :upgrade flag: ${tok}`)
    }
  }
  return out
}

async function runProbeMode(
  parsed: YtdlpParsed,
  io: RunIO,
  pretty: boolean
): Promise<RunResult> {
  const probeImpl = io.probe ?? runProbe
  const result = await probeImpl({ argv: parsed.ytArgs })
  if (result.kind === 'error') {
    return emit(
      io,
      result.envelope,
      pretty,
      exitCodeForError(result.envelope.code)
    )
  }
  const { args: sanitized } = redactArgs(parsed.ytArgs)
  const env: Envelope = {
    ok: true,
    mode: 'probe',
    command: ['yt-dlp', ...sanitized].join(' '),
    ytDlp: {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: redactText(result.stderr)
    }
  }
  return emit(io, env, pretty, result.exitCode === 0 ? ExitCode.OK : ExitCode.WAIT_NON_SUCCESS)
}

async function runDownloadMode(
  parsed: YtdlpParsed,
  io: RunIO,
  pretty: boolean,
  connectImpl: NonNullable<RunIO['connect']>
): Promise<RunResult> {
  const conn = await connectImpl({ flags: parsed.flags })
  if (conn.kind === 'error') {
    return emit(io, conn.envelope, pretty, exitCodeForError(conn.envelope.code))
  }
  try {
    const built = buildForwardedInput({ argv: parsed.ytArgs, flags: parsed.flags })
    const request: Parameters<NonNullable<ContractClient['add']>>[0] = {
      input: built.input
    }
    if (parsed.flags.priority) {
      request.priority = priorityToCode(parsed.flags.priority)
    }
    if (parsed.flags.groupKey !== undefined) request.groupKey = parsed.flags.groupKey
    if (parsed.flags.maxAttempts !== undefined) request.maxAttempts = parsed.flags.maxAttempts

    const result = await enqueueDownload({
      client: conn.client,
      request,
      wait: parsed.flags.wait
    })

    if (result.kind === 'detached') {
      const env: Envelope = {
        ok: true,
        mode: 'download',
        task: {
          id: result.task.id,
          status: result.task.status,
          attempt: result.task.attempt,
          maxAttempts: result.task.maxAttempts,
          command: built.commandPreview
        }
      }
      return emit(io, env, pretty, ExitCode.OK)
    }
    if (result.kind === 'wait-success') {
      const env: Envelope = {
        ok: true,
        mode: 'download',
        task: result.task,
        ytDlp: {
          exitCode: 0,
          stdoutTail: '',
          stderrTail: ''
        }
      }
      return emit(io, env, pretty, ExitCode.OK)
    }
    // wait-non-success
    const env: Envelope = {
      ok: false,
      mode: 'download',
      task: result.task,
      ytDlp: {
        exitCode: 1,
        stdoutTail: '',
        stderrTail: redactText(
          (result.task.lastError as { stderrTail?: string } | null)?.stderrTail ?? ''
        )
      }
    }
    return emit(io, env, pretty, ExitCode.WAIT_NON_SUCCESS)
  } catch (err) {
    const env = errorEnvelope(
      'UNKNOWN_ERROR',
      err instanceof Error ? err.message : String(err)
    )
    return emit(io, env, pretty, ExitCode.ARG_ERROR)
  } finally {
    await safeTeardown(conn)
  }
}

function priorityToCode(p: 'user' | 'subscription' | 'background'): 0 | 10 | 20 {
  if (p === 'user') return 0
  if (p === 'subscription') return 10
  return 20
}

async function safeTeardown(conn: ConnectResult): Promise<void> {
  if (conn.kind !== 'connected') return
  if (!conn.teardown) return
  try {
    await conn.teardown()
  } catch {
    /* noop */
  }
}

function emit(
  io: RunIO,
  env: Envelope,
  pretty: boolean,
  exitCode: number
): RunResult {
  io.stdout(renderEnvelope(env, { pretty }))
  return { exitCode, envelope: env }
}

function coerceErrorCode(code: string): ErrorEnvelope['code'] {
  switch (code) {
    case 'UNKNOWN_VIDBEE_FLAG':
    case 'INVALID_TARGET':
    case 'INVALID_PRIORITY':
    case 'INVALID_MAX_ATTEMPTS':
    case 'INVALID_TIMEOUT':
    case 'MISSING_VALUE':
    case 'UNEXPECTED_VALUE':
    case 'STDOUT_OUTPUT_DISALLOWED':
      return code
    default:
      return 'PARSE_ERROR'
  }
}

