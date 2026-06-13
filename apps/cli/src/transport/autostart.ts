/**
 * Auto-launch VidBee Desktop in background mode when the descriptor is
 * missing or stale. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §5.4
 *
 * The Desktop side adds `--background` / `--from-cli` flags (NEX-131
 * commit 7de4e20) which keep the app tray-only, no main window. We spawn
 * the platform-appropriate launcher and then poll for the descriptor to
 * appear.
 */

import { spawn } from 'node:child_process'

import { isPidAlive, readDescriptor, type ResolveDescriptorOptions } from './descriptor'

export interface AutostartOptions {
  /** Total wall-clock budget; defaults to 10s per design. */
  timeoutMs?: number
  /** Polling interval. */
  pollIntervalMs?: number
  /** Test seam — overrides spawn. */
  spawnLauncher?: (cmd: string, args: readonly string[]) => void
  /** Test seam — overrides Date.now. */
  clock?: () => number
  /** Test seam — overrides setTimeout-based wait. */
  delay?: (ms: number) => Promise<void>
  /** Test seam for descriptor lookup. */
  descriptorOptions?: ResolveDescriptorOptions
  platform?: NodeJS.Platform
}

export type AutostartResult =
  | { kind: 'ready' }
  | { kind: 'autostart-disabled' }
  | { kind: 'unsupported-platform'; platform: NodeJS.Platform }
  | { kind: 'timeout'; waitedMs: number }
  | { kind: 'launch-failed'; reason: string }

const defaultDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Returns immediately when the descriptor already points at a live PID;
 * otherwise spawns Desktop in background mode and polls until the
 * descriptor reappears or the timeout expires.
 */
export async function ensureDesktopReady(
  enabled: boolean,
  opts: AutostartOptions = {}
): Promise<AutostartResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const poll = opts.pollIntervalMs ?? 200
  const clock = opts.clock ?? Date.now
  const delay = opts.delay ?? defaultDelay
  const platform = opts.platform ?? process.platform

  // First check: if we already have a fresh descriptor pointing at a live
  // pid, no autostart needed.
  if (descriptorIsReady(opts.descriptorOptions)) return { kind: 'ready' }

  if (!enabled) return { kind: 'autostart-disabled' }

  const launchSpec = launcherForPlatform(platform)
  if (!launchSpec) return { kind: 'unsupported-platform', platform }

  try {
    if (opts.spawnLauncher) {
      opts.spawnLauncher(launchSpec.cmd, launchSpec.args)
    } else {
      const child = spawn(launchSpec.cmd, [...launchSpec.args], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      })
      child.unref()
    }
  } catch (err) {
    return {
      kind: 'launch-failed',
      reason: err instanceof Error ? err.message : String(err)
    }
  }

  const start = clock()
  while (clock() - start < timeoutMs) {
    if (descriptorIsReady(opts.descriptorOptions)) return { kind: 'ready' }
    await delay(poll)
  }
  return { kind: 'timeout', waitedMs: clock() - start }
}

function descriptorIsReady(descriptorOpts: ResolveDescriptorOptions | undefined): boolean {
  const r = readDescriptor(descriptorOpts ?? {})
  if (!r.ok) return false
  return isPidAlive(r.descriptor.pid)
}

/**
 * Per-platform launcher. The Desktop end accepts `--background` /
 * `--from-cli`; both forms are forwarded for forward-compat.
 *
 * Some flow notes:
 *   - macOS: `open -ga VidBee --args --background --from-cli`
 *   - Linux: relies on `vidbee-desktop` desktop entry on PATH; the AppImage
 *     install instructions create a symlink to the AppImage, which we then
 *     invoke directly with `--background`.
 *   - Windows: `start "" VidBee --background` via cmd /c so it goes
 *     through the shell start verb (handles the .lnk in Start Menu).
 *
 * For Phase B we ship the macOS path as the well-tested reference; Linux
 * and Windows commands are best-effort and can be tightened by user QA on
 * those platforms.
 */
function launcherForPlatform(
  platform: NodeJS.Platform
): { cmd: string; args: readonly string[] } | null {
  if (platform === 'darwin') {
    return { cmd: 'open', args: ['-ga', 'VidBee', '--args', '--background', '--from-cli'] }
  }
  if (platform === 'win32') {
    return {
      cmd: 'cmd',
      args: ['/c', 'start', '""', 'VidBee', '--background', '--from-cli']
    }
  }
  if (platform === 'linux') {
    return { cmd: 'vidbee-desktop', args: ['--background', '--from-cli'] }
  }
  return null
}
