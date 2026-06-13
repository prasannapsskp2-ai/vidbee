/**
 * Transport selection for the CLI. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §3, §5, §8
 *
 * Three transports exist:
 *   - desktop loopback (default) — descriptor + handshake; Phase B
 *   - remote api (--vidbee-api)  — HTTPS unless host is loopback / private
 *   - local (--vidbee-local)     — in-process TaskQueueAPI for CI / headless
 *
 * Phase A delivers `local` only; the other two surface a clear
 * `DESKTOP_NOT_READY` / `API_UNREACHABLE` error pointing at NEX-131.
 */

import type { Flags } from '../parser'
import type { ContractClient } from '../subcommands'
import { ExitCode, errorEnvelope, type ErrorEnvelope } from '../envelope'

export interface TransportSelection {
  kind: 'local' | 'desktop' | 'api'
  /** Filled by the caller when actually connected. */
  client?: ContractClient
}

export function selectTransport(flags: Flags): TransportSelection {
  if (flags.local || flags.target === 'local') return { kind: 'local' }
  if (flags.api !== undefined || flags.target === 'api') return { kind: 'api' }
  return { kind: 'desktop' }
}

/**
 * §8.1: plaintext HTTP only allowed when host is loopback or private.
 * Returns null when ok, an ErrorEnvelope when the URL fails the policy.
 */
export function validateApiUrl(url: string): ErrorEnvelope | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return errorEnvelope('API_UNREACHABLE', `invalid --vidbee-api URL: ${url}`)
  }
  if (parsed.protocol === 'https:') return null
  if (parsed.protocol !== 'http:') {
    return errorEnvelope(
      'API_UNREACHABLE',
      `unsupported scheme for --vidbee-api: ${parsed.protocol}`
    )
  }
  if (isLoopbackOrPrivateHost(parsed.hostname)) return null
  return errorEnvelope(
    'API_UNREACHABLE',
    `plaintext HTTP --vidbee-api is only allowed for loopback / private hosts; got ${parsed.hostname}`,
    { url }
  )
}

export function isLoopbackOrPrivateHost(host: string): boolean {
  const lower = host.toLowerCase()
  if (lower === 'localhost') return true
  if (lower === '::1' || lower === '[::1]') return true
  // ipv4 octet form
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 127) return true
    if (a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    return false
  }
  // *.local (mDNS) is treated as private
  if (lower.endsWith('.local')) return true
  return false
}

/**
 * Build the right error envelope when a Phase-B-only transport is asked
 * for. The CLI shouldn't crash — it should print a coherent JSON envelope
 * and exit 3.
 */
export function transportNotReady(
  selection: TransportSelection
): { envelope: ErrorEnvelope; exitCode: typeof ExitCode.HOST_UNREACHABLE } {
  if (selection.kind === 'desktop') {
    return {
      envelope: errorEnvelope(
        'DESKTOP_NOT_READY',
        'desktop loopback transport is not yet wired; tracked in NEX-131 A1.'
      ),
      exitCode: ExitCode.HOST_UNREACHABLE
    }
  }
  return {
    envelope: errorEnvelope(
      'API_UNREACHABLE',
      'remote --vidbee-api transport is not yet wired; tracked in NEX-131 A2.'
    ),
    exitCode: ExitCode.HOST_UNREACHABLE
  }
}
