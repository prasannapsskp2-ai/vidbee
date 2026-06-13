/**
 * Reads (and validates) the Desktop automation descriptor. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §5.2 / §5.3
 *
 * The descriptor lives at a per-platform path and is overrideable via
 * `VIDBEE_AUTOMATION_DESCRIPTOR=/path`. It carries `tokenHash` only, never
 * the plaintext token; the CLI obtains the plaintext via `handshake`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { errorEnvelope, type ErrorEnvelope } from '../envelope'

export interface DescriptorPayload {
  version: 1
  schemaVersion: string
  kind: 'desktop'
  host: string
  port: number
  tokenHash: string | null
  tokenIssuedAt: number | null
  tokenExpiresAt: number | null
  pid: number
  pidStartedAt: number
  updatedAt: number
  appVersion: string
}

export interface ResolveDescriptorOptions {
  /** Test seam — overrides VIDBEE_AUTOMATION_DESCRIPTOR resolution. */
  pathOverride?: string
  envOverride?: string | null
  platform?: NodeJS.Platform
  homedir?: () => string
  env?: NodeJS.ProcessEnv
  /** Test seam — defaults to fs.existsSync. */
  exists?: (p: string) => boolean
  /** Test seam — defaults to fs.readFileSync(utf-8). */
  readFile?: (p: string) => string
}

const DIRNAME = 'VidBee'
const DESCRIPTOR_FILE = 'automation.json'

export function resolveDescriptorPath(
  opts: ResolveDescriptorOptions = {}
): string {
  if (opts.pathOverride) return opts.pathOverride
  const env = opts.env ?? process.env
  const envOverride =
    opts.envOverride !== undefined
      ? opts.envOverride
      : env.VIDBEE_AUTOMATION_DESCRIPTOR?.trim()
  if (envOverride && envOverride.length > 0) return envOverride

  const platform = opts.platform ?? process.platform
  const home = (opts.homedir ?? homedir)()
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', DIRNAME, DESCRIPTOR_FILE)
  }
  if (platform === 'win32') {
    const appdata = env.APPDATA?.trim()
    const base = appdata && appdata.length > 0 ? appdata : join(home, 'AppData', 'Roaming')
    return join(base, DIRNAME, DESCRIPTOR_FILE)
  }
  // Linux + others
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const base = xdg && xdg.length > 0 ? xdg : join(home, '.config')
  return join(base, DIRNAME, DESCRIPTOR_FILE)
}

export type ReadDescriptorResult =
  | { ok: true; descriptor: DescriptorPayload; path: string }
  | { ok: false; envelope: ErrorEnvelope; path: string }

export function readDescriptor(
  opts: ResolveDescriptorOptions = {}
): ReadDescriptorResult {
  const path = resolveDescriptorPath(opts)
  const exists = opts.exists ?? existsSync
  const read = opts.readFile ?? ((p: string) => readFileSync(p, 'utf-8'))
  if (!exists(path)) {
    return {
      ok: false,
      path,
      envelope: errorEnvelope(
        'DESKTOP_NOT_READY',
        `automation descriptor not found at ${path}`,
        { path }
      )
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(read(path))
  } catch (err) {
    return {
      ok: false,
      path,
      envelope: errorEnvelope(
        'DESKTOP_NOT_READY',
        `automation descriptor is malformed: ${err instanceof Error ? err.message : err}`,
        { path }
      )
    }
  }
  const v = validateDescriptor(parsed)
  if (!v.ok) {
    return {
      ok: false,
      path,
      envelope: errorEnvelope('DESKTOP_NOT_READY', v.reason, { path })
    }
  }
  return { ok: true, descriptor: v.value, path }
}

function validateDescriptor(
  value: unknown
):
  | { ok: true; value: DescriptorPayload }
  | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'descriptor is not a JSON object' }
  }
  const v = value as Record<string, unknown>
  if (v.version !== 1) {
    return { ok: false, reason: `unsupported descriptor version: ${String(v.version)}` }
  }
  if (typeof v.host !== 'string' || typeof v.port !== 'number') {
    return { ok: false, reason: 'descriptor missing host/port' }
  }
  if (typeof v.pid !== 'number' || typeof v.pidStartedAt !== 'number') {
    return { ok: false, reason: 'descriptor missing pid/pidStartedAt' }
  }
  return {
    ok: true,
    value: {
      version: 1,
      schemaVersion: typeof v.schemaVersion === 'string' ? v.schemaVersion : '1.0.0',
      kind: 'desktop',
      host: v.host,
      port: v.port,
      tokenHash: typeof v.tokenHash === 'string' ? v.tokenHash : null,
      tokenIssuedAt: typeof v.tokenIssuedAt === 'number' ? v.tokenIssuedAt : null,
      tokenExpiresAt: typeof v.tokenExpiresAt === 'number' ? v.tokenExpiresAt : null,
      pid: v.pid,
      pidStartedAt: v.pidStartedAt,
      updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
      appVersion: typeof v.appVersion === 'string' ? v.appVersion : '0.0.0'
    }
  }
}

/**
 * §5.2: detect a stale descriptor by checking whether the recorded pid is
 * still alive. We use `process.kill(pid, 0)` (no signal sent — only checks
 * the OS-level existence). Errors map to "stale", which is the correct
 * conservative answer.
 */
export function isPidAlive(
  pid: number,
  killProbe: (pid: number, signal: 0) => void = (p, s) => process.kill(p, s)
): boolean {
  try {
    killProbe(pid, 0)
    return true
  } catch {
    return false
  }
}
