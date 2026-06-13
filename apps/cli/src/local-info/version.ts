/**
 * Resolve the installed CLI version by reading the package.json that ships
 * alongside the bundle (or the source tree, in dev). We avoid hard-coding
 * the version into a generated TS file so that a `pnpm version` bump in
 * `package.json` is picked up without an extra build step.
 *
 * Reference: NEX-148 §3.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FALLBACK_VERSION = '0.0.0-dev'

export interface CliVersionInfo {
  cli: string
  contract: string
  changelog: string
}

/**
 * The CLI and the shared `taskQueueContract` ship from the same monorepo;
 * we surface the contract version as the same string until the package
 * grows a separate semver. Hosts that pin a specific contract major use
 * this string for compatibility checks.
 */
export function readCliVersion(
  candidatePaths: readonly string[] = defaultCandidatePaths()
): CliVersionInfo {
  for (const p of candidatePaths) {
    try {
      const pkg = JSON.parse(readFileSync(p, 'utf-8')) as {
        name?: string
        version?: string
      }
      if (pkg.name === '@vidbee/cli' && typeof pkg.version === 'string') {
        return {
          cli: pkg.version,
          contract: pkg.version,
          changelog:
            'https://github.com/nexmoe/vidbee/blob/main/apps/cli/CHANGELOG.md'
        }
      }
    } catch {
      // try the next candidate
    }
  }
  return {
    cli: FALLBACK_VERSION,
    contract: FALLBACK_VERSION,
    changelog:
      'https://github.com/nexmoe/vidbee/blob/main/apps/cli/CHANGELOG.md'
  }
}

function defaultCandidatePaths(): string[] {
  let here: string
  try {
    here = fileURLToPath(import.meta.url)
  } catch {
    return []
  }
  const dir = dirname(here)
  // dist/index.mjs            → ../package.json  (npm tarball + Desktop bundle)
  // src/local-info/version.ts → ../../package.json (dev / vitest)
  return [
    resolve(dir, '..', 'package.json'),
    resolve(dir, '..', '..', 'package.json'),
    resolve(dir, '..', '..', '..', 'package.json')
  ]
}
