/**
 * Probe-mode execution. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §4.3, §4.5, §8.3
 *
 * Probes do NOT enter the queue. They spawn yt-dlp directly with the raw
 * argv, capture stdout/stderr, and surface the result wrapped in the §4.4
 * envelope. The 32MB stdout cap is enforced; stderr is best-effort capped
 * so a runaway log can't blow our memory budget either.
 *
 * The CLI bundles a yt-dlp binary path discovery — Desktop's
 * `node_modules/yt-dlp-wrap-plus` ships one, but for the standalone
 * `--vidbee-local` / `npx @vidbee/cli` flows we accept `YTDLP_PATH` from
 * env or fall back to `yt-dlp` on PATH.
 */

import { spawn } from 'node:child_process'

import { errorEnvelope, type ErrorEnvelope } from '../envelope'

export interface ProbeOptions {
  argv: readonly string[]
  ytDlpPath?: string
  /** Test seam — overrides spawn. */
  spawner?: ProbeSpawner
  /** Max stdout bytes; design = 32MB. */
  stdoutMaxBytes?: number
  /** stderr tail (default 64KB; same as attempts.stderr_tail). */
  stderrTailBytes?: number
}

export interface ProbeSpawnHandle {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  on(event: 'close', listener: (code: number | null) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  kill: (signal?: NodeJS.Signals) => void
}

export type ProbeSpawner = (binary: string, args: readonly string[]) => ProbeSpawnHandle

export type ProbeResult =
  | { kind: 'success'; stdout: string; stderr: string; exitCode: number; binary: string }
  | { kind: 'error'; envelope: ErrorEnvelope }

const DEFAULT_STDOUT_MAX = 32 * 1024 * 1024
const DEFAULT_STDERR_TAIL = 64 * 1024

export async function runProbe(opts: ProbeOptions): Promise<ProbeResult> {
  const binary = opts.ytDlpPath ?? resolveYtDlpBinary()
  const stdoutMax = opts.stdoutMaxBytes ?? DEFAULT_STDOUT_MAX
  const stderrTail = opts.stderrTailBytes ?? DEFAULT_STDERR_TAIL
  const spawner = opts.spawner ?? defaultSpawner

  let handle: ProbeSpawnHandle
  try {
    handle = spawner(binary, opts.argv)
  } catch (err) {
    return {
      kind: 'error',
      envelope: errorEnvelope(
        'NOT_IMPLEMENTED',
        `failed to spawn yt-dlp at ${binary}: ${err instanceof Error ? err.message : err}`
      )
    }
  }

  let stdoutBytes = 0
  let stdoutOverflow = false
  const stdoutChunks: Buffer[] = []
  const stderrTailBuf = createTailBuffer(stderrTail)

  handle.stdout.on('data', (chunk: Buffer) => {
    if (stdoutOverflow) return
    if (stdoutBytes + chunk.byteLength > stdoutMax) {
      stdoutOverflow = true
      handle.kill('SIGTERM')
      return
    }
    stdoutBytes += chunk.byteLength
    stdoutChunks.push(chunk)
  })
  handle.stderr.on('data', (chunk: Buffer) => {
    stderrTailBuf.push(chunk)
  })

  return new Promise<ProbeResult>((resolve) => {
    let settled = false
    handle.on('error', (err) => {
      if (settled) return
      settled = true
      resolve({
        kind: 'error',
        envelope: errorEnvelope(
          'NOT_IMPLEMENTED',
          `yt-dlp spawn error: ${err.message}`
        )
      })
    })
    handle.on('close', (code) => {
      if (settled) return
      settled = true
      if (stdoutOverflow) {
        resolve({
          kind: 'error',
          envelope: errorEnvelope(
            'PROBE_OUTPUT_TOO_LARGE',
            `probe stdout exceeded ${stdoutMax} bytes`
          )
        })
        return
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      resolve({
        kind: 'success',
        stdout,
        stderr: stderrTailBuf.read().toString('utf-8'),
        exitCode: code ?? -1,
        binary
      })
    })
  })
}

function resolveYtDlpBinary(): string {
  const env = process.env.YTDLP_PATH?.trim()
  return env && env.length > 0 ? env : 'yt-dlp'
}

function defaultSpawner(binary: string, args: readonly string[]): ProbeSpawnHandle {
  const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    on: (ev, l) => {
      child.on(ev as 'close' | 'error', l as never)
    },
    kill: (signal) => {
      try {
        child.kill(signal)
      } catch {
        /* noop */
      }
    }
  }
}

interface TailBuffer {
  push: (chunk: Buffer) => void
  read: () => Buffer
}

function createTailBuffer(maxBytes: number): TailBuffer {
  let buf = Buffer.alloc(0)
  return {
    push(chunk: Buffer) {
      const merged = Buffer.concat([buf, chunk])
      buf = merged.byteLength > maxBytes ? merged.subarray(merged.byteLength - maxBytes) : merged
    },
    read: () => buf
  }
}
