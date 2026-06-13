/**
 * `vidbee :upgrade` — fetch the npm registry "latest" tag for
 * `@vidbee/cli`, compare with the installed version, and tell the caller
 * which package-manager command to run if newer.
 *
 * Design constraints (NEX-148 §3):
 *   - Do NOT auto-spawn `npm i -g` — sudo / global path / brew vs npm
 *     ownership differs by host; we hand the decision to the user.
 *   - Cache the registry response for ~30 days so we don't hammer npm on
 *     every CLI invocation. Cache file is platform-specific.
 *   - Output is JSON-friendly (Agent envelope).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const REGISTRY_URL = 'https://registry.npmjs.org/@vidbee/cli/latest'
const FETCH_TIMEOUT_MS = 5_000

export interface UpgradeCheckInput {
  current: string
  /** Override for tests. */
  fetchLatest?: () => Promise<{ version: string; fetchedAt: number }>
  /** Override for tests; defaults to platform XDG cache. */
  cachePath?: string
  /** Force a fresh registry fetch even if cache is fresh. */
  force?: boolean
  /** Inject `Date.now()` for tests. */
  now?: () => number
}

export interface UpgradeCheckResult {
  current: string
  latest: string
  upToDate: boolean
  cached: boolean
  cachedAt: string | null
  registryUrl: string
  installCommands: {
    npm: string
    pnpm: string
    bun: string
    brew: string
  }
}

export async function checkUpgrade(
  input: UpgradeCheckInput
): Promise<UpgradeCheckResult> {
  const now = input.now ?? Date.now
  const cachePath = input.cachePath ?? defaultCachePath()
  const fetcher = input.fetchLatest ?? defaultFetchLatest

  let cachedAt: number | null = null
  let latest: string | null = null
  if (!input.force) {
    const cached = readCache(cachePath)
    if (cached && now() - cached.fetchedAt < CACHE_TTL_MS) {
      latest = cached.version
      cachedAt = cached.fetchedAt
    }
  }

  let cachedFlag = latest !== null
  if (latest === null) {
    const fetched = await fetcher()
    latest = fetched.version
    cachedAt = fetched.fetchedAt
    cachedFlag = false
    writeCache(cachePath, { version: latest, fetchedAt: cachedAt })
  }

  const upToDate = compareSemver(input.current, latest) >= 0
  return {
    current: input.current,
    latest,
    upToDate,
    cached: cachedFlag,
    cachedAt: cachedAt === null ? null : new Date(cachedAt).toISOString(),
    registryUrl: REGISTRY_URL,
    installCommands: {
      npm: 'npm install -g @vidbee/cli',
      pnpm: 'pnpm add -g @vidbee/cli',
      bun: 'bun install -g @vidbee/cli',
      brew: 'brew upgrade vidbee/tap/vidbee'
    }
  }
}

async function defaultFetchLatest(): Promise<{
  version: string
  fetchedAt: number
}> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal
    })
    if (!res.ok) {
      throw new Error(`registry responded ${res.status}`)
    }
    const body = (await res.json()) as { version?: string }
    if (typeof body.version !== 'string') {
      throw new Error('registry response missing `version`')
    }
    return { version: body.version, fetchedAt: Date.now() }
  } finally {
    clearTimeout(timer)
  }
}

function readCache(
  path: string
): { version: string; fetchedAt: number } | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as {
      version?: string
      fetchedAt?: number
    }
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.fetchedAt === 'number'
    ) {
      return { version: parsed.version, fetchedAt: parsed.fetchedAt }
    }
  } catch {
    // ignore: cache miss
  }
  return null
}

function writeCache(
  path: string,
  payload: { version: string; fetchedAt: number }
): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(payload), 'utf-8')
  } catch {
    // best-effort; the user can still rerun :upgrade.
  }
}

export function defaultCachePath(): string {
  const home = homedir()
  if (platform() === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return join(localAppData, 'VidBee', 'cli-upgrade-check.json')
  }
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Caches', 'VidBee', 'cli-upgrade-check.json')
  }
  const xdg = process.env.XDG_CACHE_HOME ?? join(home, '.cache')
  return join(xdg, 'vidbee', 'cli-upgrade-check.json')
}

/**
 * Minimal semver-ish compare so we don't pull in a runtime dep. Treats
 * pre-release tags (`-rc.1`) as lower than the corresponding release.
 * Returns negative if a<b, positive if a>b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const [aMain = '', aPre = ''] = a.split('-', 2)
  const [bMain = '', bPre = ''] = b.split('-', 2)
  const aParts = aMain.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const bParts = bMain.split('.').map((p) => Number.parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av !== bv) return av - bv
  }
  if (aPre === bPre) return 0
  if (aPre === '') return 1 // 0.1.0 > 0.1.0-rc.1
  if (bPre === '') return -1
  return aPre < bPre ? -1 : 1
}
