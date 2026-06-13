/**
 * Cross-platform helper for reading a process's start time. The combination
 * `(pid, pidStartedAt)` is the only safe way to detect pid reuse during
 * crash recovery.
 *
 * Platform notes (per design doc §8):
 *   - linux: read `/proc/<pid>/stat` field 22 (starttime, in clock ticks).
 *   - macOS: spawn `ps -o lstart= -p <pid>`; convert to epoch ms.
 *   - windows: GetProcessTimes via N-API. Not implemented in pure-JS; hosts
 *     are expected to inject a platform-specific function via
 *     `setReadPidStartTimeImpl`. The kernel ships a permissive default that
 *     returns null on Windows so recovery falls back to "treat as orphan".
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export type ReadPidStartTimeFn = (pid: number) => number | null

let impl: ReadPidStartTimeFn = defaultImpl

export function setReadPidStartTimeImpl(fn: ReadPidStartTimeFn): void {
  impl = fn
}

export function readPidStartTime(pid: number): number | null {
  try {
    return impl(pid)
  } catch {
    return null
  }
}

function defaultImpl(pid: number): number | null {
  if (process.platform === 'linux') return readLinuxStart(pid)
  if (process.platform === 'darwin') return readDarwinStart(pid)
  // win32 default: null. Recovery will treat the pid as a real orphan.
  return null
}

function readLinuxStart(pid: number): number | null {
  const path = `/proc/${pid}/stat`
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8')
  // field 22 (starttime) — careful around the comm field which may contain
  // spaces and is wrapped in parens.
  const lastParen = raw.lastIndexOf(')')
  if (lastParen < 0) return null
  const fields = raw.slice(lastParen + 2).split(' ')
  const starttimeTicks = Number.parseInt(fields[19] ?? '', 10)
  if (!Number.isFinite(starttimeTicks)) return null

  // Compute btime + (starttime / hz) → epoch seconds.
  const stat = readFileSync('/proc/stat', 'utf8')
  const btimeMatch = stat.match(/^btime\s+(\d+)/m)
  if (!btimeMatch) return null
  const btime = Number.parseInt(btimeMatch[1] ?? '', 10)
  const hz = readClockTickRate() ?? 100
  return (btime + starttimeTicks / hz) * 1000
}

function readDarwinStart(pid: number): number | null {
  // `ps` is universally available. lstart prints in `Sat Jan  4 09:18:34 2025`
  // form which Date.parse handles natively.
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim()
    if (!out) return null
    const t = Date.parse(out)
    return Number.isNaN(t) ? null : t
  } catch {
    return null
  }
}

let cachedHz: number | null | undefined
function readClockTickRate(): number | null {
  if (cachedHz !== undefined) return cachedHz
  try {
    const out = execFileSync('getconf', ['CLK_TCK'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim()
    const n = Number.parseInt(out, 10)
    cachedHz = Number.isFinite(n) ? n : null
  } catch {
    cachedHz = null
  }
  return cachedHz
}

/**
 * `existsSync` of `/proc/<pid>` doubles as a cheap aliveness check on linux.
 * On other platforms we fall back to `process.kill(pid, 0)` which throws
 * ESRCH if the process no longer exists.
 */
export function isPidAlive(pid: number): boolean {
  if (process.platform === 'linux') return existsSync(`/proc/${pid}`)
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'EPERM' // EPERM means the process exists but we can't signal it.
  }
}

// Silence unused-import on hosts that don't need statSync.
// (kept here for future use when we capture mtime of /proc/<pid> as a tiebreaker)
void statSync
