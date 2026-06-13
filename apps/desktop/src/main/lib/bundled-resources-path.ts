import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Resolve the packaged resources directory that actually contains the requested assets.
 *
 * GitHub issues #334, #348, #349, #352, and #353 all showed packaged Windows
 * logs resolving binaries under `resources/resources/...`, while other builds
 * placed the same assets directly under `process.resourcesPath`.
 *
 * @param requiredRelativePaths Relative asset paths that must exist under the chosen directory.
 * @returns The most likely resources directory for the current runtime.
 */
export const resolveBundledResourcesPath = (requiredRelativePaths: string[]): string => {
  if (process.env.NODE_ENV === 'development') {
    return path.join(process.cwd(), 'resources')
  }

  const candidates = [
    process.resourcesPath,
    path.join(process.resourcesPath, 'app.asar.unpacked', 'resources'),
    path.join(process.resourcesPath, 'resources')
  ]

  for (const candidate of candidates) {
    if (
      requiredRelativePaths.every((relativePath) => existsSync(path.join(candidate, relativePath)))
    ) {
      return candidate
    }
  }

  return process.resourcesPath
}
