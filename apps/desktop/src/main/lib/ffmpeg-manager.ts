import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scopedLoggers } from '../utils/logger'
import { resolveBundledResourcesPath } from './bundled-resources-path'

/**
 * Manage ffmpeg and ffprobe discovery for packaged and development builds.
 */
class FfmpegManager {
  private ffmpegPath: string | null = null
  private initializePromise: Promise<string> | null = null

  /**
   * Resolves and caches the ffmpeg binary path for the current runtime.
   */
  async initialize(): Promise<void> {
    this.ffmpegPath = await this.findFfmpegBinary()
    this.initializePromise = null
    scopedLoggers.engine.info('ffmpeg initialized at:', this.ffmpegPath)
  }

  /**
   * Returns the cached ffmpeg binary path after successful initialization.
   */
  getPath(): string {
    if (!this.ffmpegPath) {
      throw new Error('ffmpeg not initialized. Call initialize() first.')
    }
    return this.ffmpegPath
  }

  /**
   * Ensures ffmpeg is initialized and preserves the original lookup failure.
   */
  async ensureInitialized(): Promise<string> {
    if (this.ffmpegPath) {
      return this.ffmpegPath
    }

    if (!this.initializePromise) {
      this.initializePromise = this.findFfmpegBinary()
        .then((resolvedPath) => {
          this.ffmpegPath = resolvedPath
          scopedLoggers.engine.info('ffmpeg initialized at:', resolvedPath)
          return resolvedPath
        })
        .finally(() => {
          this.initializePromise = null
        })
    }

    return this.initializePromise
  }

  /**
   * Resolves the resources directory for packaged and development builds.
   */
  private getResourcesPath(): string {
    return resolveBundledResourcesPath(['ffmpeg'])
  }

  /**
   * Finds a usable ffmpeg binary and validates that ffprobe is colocated.
   */
  private async findFfmpegBinary(): Promise<string> {
    const platform = os.platform()
    const ffmpegFileName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const ffprobeFileName = platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

    const resolveBundledFfmpeg = (dirPath: string, label: string): string | null => {
      const ffmpegPath = path.join(dirPath, ffmpegFileName)
      const ffprobePath = path.join(dirPath, ffprobeFileName)
      if (!(fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath))) {
        return null
      }
      if (platform !== 'win32') {
        try {
          fs.chmodSync(ffmpegPath, 0o755)
          fs.chmodSync(ffprobePath, 0o755)
        } catch (error) {
          scopedLoggers.engine.warn(`Failed to set executable permission on ${label}:`, error)
        }
      }
      scopedLoggers.engine.info(`Using ${label}:`, ffmpegPath)
      return ffmpegPath
    }

    const envPath = process.env.FFMPEG_PATH
    if (envPath) {
      if (!fs.existsSync(envPath)) {
        throw new Error(
          'FFMPEG_PATH does not exist. Provide a directory containing ffmpeg and ffprobe.'
        )
      }

      // Sentry issue VIDBEE-1IS showed some users point FFMPEG_PATH at the
      // binary itself instead of its parent directory. Accept both forms.
      const resolvedEnvDir = this.resolveEnvFfmpegDirectory(envPath, ffmpegFileName)
      const resolved = resolveBundledFfmpeg(resolvedEnvDir, 'ffmpeg from FFMPEG_PATH')
      if (resolved) {
        return resolved
      }
      throw new Error('FFMPEG_PATH must contain both ffmpeg and ffprobe.')
    }

    const resourcesPath = this.getResourcesPath()
    const bundledDir = path.join(resourcesPath, 'ffmpeg')
    const bundledResolved = resolveBundledFfmpeg(bundledDir, 'bundled ffmpeg')
    if (bundledResolved) {
      return bundledResolved
    }

    if (platform === 'darwin') {
      const commonDirs = ['/opt/homebrew/bin', '/usr/local/bin']
      for (const candidate of commonDirs) {
        const resolved = resolveBundledFfmpeg(candidate, 'system ffmpeg')
        if (resolved) {
          return resolved
        }
      }
    }

    if (platform === 'linux' || platform === 'freebsd') {
      try {
        const systemPath = execSync('which ffmpeg').toString().trim()
        if (systemPath && fs.existsSync(systemPath)) {
          const resolved = resolveBundledFfmpeg(path.dirname(systemPath), 'system ffmpeg')
          if (resolved) {
            return resolved
          }
        }
      } catch (_error) {
        // Ignore error and continue
      }
    }

    if (platform === 'win32') {
      try {
        const output = execSync('where ffmpeg').toString().split(/\r?\n/)[0]
        if (output && fs.existsSync(output)) {
          const resolved = resolveBundledFfmpeg(path.dirname(output), 'system ffmpeg')
          if (resolved) {
            return resolved
          }
        }
      } catch (_error) {
        // Ignore error and continue
      }
    }

    throw new Error(
      'ffmpeg/ffprobe not found. Bundle them under resources/ffmpeg/ in the build output or set FFMPEG_PATH to a directory containing both.'
    )
  }

  /**
   * Normalize FFMPEG_PATH to the directory that should contain both binaries.
   */
  private resolveEnvFfmpegDirectory(envPath: string, ffmpegFileName: string): string {
    const stats = fs.statSync(envPath)
    if (stats.isDirectory()) {
      return envPath
    }

    if (path.basename(envPath) === ffmpegFileName) {
      return path.dirname(envPath)
    }

    throw new Error(
      'FFMPEG_PATH must be a directory containing ffmpeg and ffprobe or the ffmpeg binary path.'
    )
  }
}

export const ffmpegManager = new FfmpegManager()
