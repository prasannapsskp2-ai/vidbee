import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  checkUpgrade,
  compareSemver,
  defaultCachePath,
  readCliVersion
} from '../src/local-info'

describe('readCliVersion', () => {
  it('returns the @vidbee/cli package.json version when found', () => {
    const info = readCliVersion()
    // The version comes from apps/cli/package.json
    expect(info.cli).toMatch(/^\d+\.\d+\.\d+/)
    expect(info.contract).toEqual(info.cli)
    expect(info.changelog).toContain('CHANGELOG')
  })

  it('falls back to a marker when no candidate matches', () => {
    const info = readCliVersion(['/path/that/definitely/does/not/exist.json'])
    expect(info.cli).toBe('0.0.0-dev')
    expect(info.contract).toBe('0.0.0-dev')
  })

  it('skips package.json files with the wrong name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vidbee-cli-version-'))
    const wrong = join(dir, 'wrong.json')
    const right = join(dir, 'right.json')
    writeFileSync(wrong, JSON.stringify({ name: 'something-else', version: '9.9.9' }))
    writeFileSync(
      right,
      JSON.stringify({ name: '@vidbee/cli', version: '1.2.3' })
    )
    const info = readCliVersion([wrong, right])
    expect(info.cli).toBe('1.2.3')
  })
})

describe('compareSemver', () => {
  it('orders by major/minor/patch', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
  })
  it('treats prerelease as smaller than release', () => {
    expect(compareSemver('0.1.0-rc.1', '0.1.0')).toBeLessThan(0)
    expect(compareSemver('0.1.0', '0.1.0-rc.1')).toBeGreaterThan(0)
  })
})

describe('checkUpgrade', () => {
  let cachePath: string
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'vidbee-cli-upgrade-'))
    cachePath = join(dir, 'cli-upgrade-check.json')
  })
  afterEach(() => {
    // tmpdir gets cleaned by the OS; nothing else to do.
  })

  it('reports out-of-date when registry returns a newer version', async () => {
    const result = await checkUpgrade({
      current: '0.1.0',
      cachePath,
      fetchLatest: async () => ({ version: '0.2.0', fetchedAt: 1000 })
    })
    expect(result.upToDate).toBe(false)
    expect(result.latest).toBe('0.2.0')
    expect(result.cached).toBe(false)
    expect(result.installCommands.npm).toContain('@vidbee/cli')
    // Cache should be written
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
    expect(cached.version).toBe('0.2.0')
  })

  it('reports up-to-date when installed >= registry', async () => {
    const result = await checkUpgrade({
      current: '0.2.0',
      cachePath,
      fetchLatest: async () => ({ version: '0.2.0', fetchedAt: 1000 })
    })
    expect(result.upToDate).toBe(true)
  })

  it('uses a fresh cache and skips fetch', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ version: '0.5.0', fetchedAt: 1_000_000 })
    )
    let fetched = false
    const result = await checkUpgrade({
      current: '0.4.0',
      cachePath,
      now: () => 1_000_000 + 24 * 60 * 60 * 1000, // 1 day later
      fetchLatest: async () => {
        fetched = true
        return { version: '0.6.0', fetchedAt: 2_000_000 }
      }
    })
    expect(fetched).toBe(false)
    expect(result.cached).toBe(true)
    expect(result.latest).toBe('0.5.0')
    expect(result.upToDate).toBe(false)
  })

  it('refreshes the cache after the TTL expires', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ version: '0.5.0', fetchedAt: 0 })
    )
    let fetched = false
    const result = await checkUpgrade({
      current: '0.4.0',
      cachePath,
      now: () => 31 * 24 * 60 * 60 * 1000, // 31 days later
      fetchLatest: async () => {
        fetched = true
        return { version: '0.6.0', fetchedAt: 99 }
      }
    })
    expect(fetched).toBe(true)
    expect(result.cached).toBe(false)
    expect(result.latest).toBe('0.6.0')
  })

  it('--force bypasses the cache', async () => {
    writeFileSync(
      cachePath,
      JSON.stringify({ version: '0.5.0', fetchedAt: Date.now() })
    )
    let fetched = false
    const result = await checkUpgrade({
      current: '0.4.0',
      cachePath,
      force: true,
      fetchLatest: async () => {
        fetched = true
        return { version: '0.7.0', fetchedAt: Date.now() }
      }
    })
    expect(fetched).toBe(true)
    expect(result.cached).toBe(false)
    expect(result.latest).toBe('0.7.0')
  })
})

describe('defaultCachePath', () => {
  it('returns a non-empty platform-specific path', () => {
    const p = defaultCachePath()
    expect(p).toContain('cli-upgrade-check.json')
    expect(p.length).toBeGreaterThan('cli-upgrade-check.json'.length)
  })
})
