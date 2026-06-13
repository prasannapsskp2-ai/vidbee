/**
 * Resolves a `ContractClient` according to CLI flags. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §3, §4.2, §5
 *
 * Three transports:
 *   - local:   `--vidbee-local` → in-process TaskQueueAPI (createLocalClient)
 *   - api:     `--vidbee-api <url>` → AutomationClient against that base
 *   - desktop: default → read descriptor → autostart if needed → handshake
 *
 * Each path can fail gracefully and returns an `ErrorEnvelope` instead of
 * throwing, so the runtime can map to the right exit code.
 */

import { errorEnvelope, type ErrorEnvelope } from '../envelope'
import type { Flags } from '../parser'
import type { ContractClient } from '../subcommands'
import { AutomationClient } from './automation-client'
import { ensureDesktopReady, type AutostartResult } from './autostart'
import { isPidAlive, readDescriptor } from './descriptor'
import { createLocalClient, type LocalClientHandle } from './local-client'

export interface ConnectOptions {
  flags: Flags
  /** Test seam — overrides AutomationClient instantiation. */
  buildAutomationClient?: (
    baseUrl: string,
    token: string | null
  ) => ContractClient
  /** Test seam — overrides descriptor read. */
  readDescriptorImpl?: typeof readDescriptor
  /** Test seam — overrides autostart. */
  ensureDesktopReadyImpl?: typeof ensureDesktopReady
  /** Test seam — overrides createLocalClient. */
  createLocalClientImpl?: typeof createLocalClient
}

export type ConnectResult =
  | { kind: 'connected'; client: ContractClient; teardown?: () => Promise<void> }
  | { kind: 'error'; envelope: ErrorEnvelope }

export async function connect(opts: ConnectOptions): Promise<ConnectResult> {
  const { flags } = opts

  if (flags.local || flags.target === 'local') {
    const factory = opts.createLocalClientImpl ?? createLocalClient
    try {
      const handle: LocalClientHandle = await factory({})
      return { kind: 'connected', client: handle, teardown: handle.shutdown }
    } catch (err) {
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'NOT_IMPLEMENTED',
          `--vidbee-local failed to start: ${err instanceof Error ? err.message : err}`
        )
      }
    }
  }

  if (flags.api !== undefined || flags.target === 'api') {
    const url = flags.api
    if (!url) {
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'API_UNREACHABLE',
          '--vidbee-target api requires --vidbee-api <url>'
        )
      }
    }
    const builder = opts.buildAutomationClient ?? defaultAutomationBuilder
    const client = builder(url, flags.token ?? null)
    return { kind: 'connected', client }
  }

  // Desktop default path
  return await connectDesktop(opts)
}

async function connectDesktop(opts: ConnectOptions): Promise<ConnectResult> {
  const { flags } = opts
  const readImpl = opts.readDescriptorImpl ?? readDescriptor
  const ensureImpl = opts.ensureDesktopReadyImpl ?? ensureDesktopReady

  let descriptor = readImpl({})
  let needsAutostart = false
  if (!descriptor.ok) {
    needsAutostart = true
  } else if (!isPidAlive(descriptor.descriptor.pid)) {
    needsAutostart = true
  }

  if (needsAutostart) {
    const result: AutostartResult = await ensureImpl(!flags.noAutostart, {
      ...(flags.timeoutMs !== undefined ? { timeoutMs: flags.timeoutMs } : {})
    })
    if (result.kind === 'autostart-disabled') {
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'DESKTOP_NOT_READY',
          'Desktop is not running and --vidbee-no-autostart was set'
        )
      }
    }
    if (result.kind === 'unsupported-platform') {
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'DESKTOP_NOT_READY',
          `autostart not supported on platform ${result.platform}; pass --vidbee-api or run Desktop manually`
        )
      }
    }
    if (result.kind === 'launch-failed') {
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'DESKTOP_NOT_READY',
          `failed to launch Desktop: ${result.reason}`
        )
      }
    }
    if (result.kind === 'timeout') {
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'DESKTOP_NOT_READY',
          `Desktop did not become ready within ${result.waitedMs}ms`
        )
      }
    }
    descriptor = readImpl({})
    if (!descriptor.ok) return { kind: 'error', envelope: descriptor.envelope }
  }

  if (!descriptor.ok) return { kind: 'error', envelope: descriptor.envelope }
  const baseUrl = `http://${descriptor.descriptor.host}:${descriptor.descriptor.port}`
  const builder = opts.buildAutomationClient ?? defaultAutomationBuilder
  const client = builder(baseUrl, flags.token ?? null)
  return { kind: 'connected', client }
}

function defaultAutomationBuilder(
  baseUrl: string,
  token: string | null
): ContractClient {
  if (token) {
    return new AutomationClient({ baseUrl, token, skipHandshake: true })
  }
  return new AutomationClient({ baseUrl })
}
