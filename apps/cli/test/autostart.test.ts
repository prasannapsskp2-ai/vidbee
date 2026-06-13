import { describe, expect, it } from 'vitest'

import { ensureDesktopReady } from '../src/transport/autostart'

describe('ensureDesktopReady (§5.4)', () => {
  it('returns ready when descriptor already points at live pid', async () => {
    let attempts = 0
    const r = await ensureDesktopReady(true, {
      descriptorOptions: {
        pathOverride: '/x',
        exists: () => true,
        readFile: () => {
          attempts += 1
          return JSON.stringify({
            version: 1,
            host: '127.0.0.1',
            port: 27_100,
            pid: process.pid, // live pid for this process
            pidStartedAt: 0,
            schemaVersion: '1.0.0',
            kind: 'desktop',
            tokenHash: null,
            tokenIssuedAt: null,
            tokenExpiresAt: null,
            updatedAt: 0,
            appVersion: '1.0.0'
          })
        }
      }
    })
    expect(r.kind).toBe('ready')
    expect(attempts).toBe(1) // no autostart polling needed
  })

  it('returns autostart-disabled when enabled=false and no descriptor', async () => {
    const r = await ensureDesktopReady(false, {
      descriptorOptions: { pathOverride: '/x', exists: () => false }
    })
    expect(r.kind).toBe('autostart-disabled')
  })

  it('spawns launcher and returns ready when descriptor appears', async () => {
    let calls = 0
    let descriptorPresent = false
    let spawned = 0
    const r = await ensureDesktopReady(true, {
      timeoutMs: 1_000,
      pollIntervalMs: 5,
      delay: async () => {},
      spawnLauncher: () => {
        spawned += 1
        descriptorPresent = true
      },
      descriptorOptions: {
        pathOverride: '/x',
        exists: () => descriptorPresent,
        readFile: () => {
          calls += 1
          return JSON.stringify({
            version: 1,
            host: '127.0.0.1',
            port: 27_100,
            pid: process.pid,
            pidStartedAt: 0,
            schemaVersion: '1.0.0',
            kind: 'desktop',
            tokenHash: null,
            tokenIssuedAt: null,
            tokenExpiresAt: null,
            updatedAt: 0,
            appVersion: '1.0.0'
          })
        }
      },
      platform: 'darwin'
    })
    expect(r.kind).toBe('ready')
    expect(spawned).toBe(1)
    expect(calls).toBeGreaterThanOrEqual(1)
  })

  it('returns timeout when descriptor never appears', async () => {
    let now = 0
    const r = await ensureDesktopReady(true, {
      timeoutMs: 100,
      pollIntervalMs: 10,
      clock: () => now,
      delay: async (ms) => {
        now += ms
      },
      spawnLauncher: () => {},
      descriptorOptions: { pathOverride: '/x', exists: () => false },
      platform: 'darwin'
    })
    expect(r.kind).toBe('timeout')
  })

  it('returns unsupported-platform on freebsd', async () => {
    const r = await ensureDesktopReady(true, {
      descriptorOptions: { pathOverride: '/x', exists: () => false },
      platform: 'freebsd'
    })
    expect(r.kind).toBe('unsupported-platform')
  })

  it('returns launch-failed when spawnLauncher throws', async () => {
    const r = await ensureDesktopReady(true, {
      descriptorOptions: { pathOverride: '/x', exists: () => false },
      platform: 'darwin',
      spawnLauncher: () => {
        throw new Error('ENOENT VidBee')
      }
    })
    if (r.kind !== 'launch-failed') throw new Error('expected launch-failed')
    expect(r.reason).toMatch(/VidBee/)
  })
})
