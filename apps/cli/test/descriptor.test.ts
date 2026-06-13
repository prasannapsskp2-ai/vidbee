import { describe, expect, it } from 'vitest'

import { isPidAlive, readDescriptor, resolveDescriptorPath } from '../src/transport/descriptor'

describe('resolveDescriptorPath (§5.2)', () => {
  it('honors VIDBEE_AUTOMATION_DESCRIPTOR override', () => {
    const p = resolveDescriptorPath({ envOverride: '/tmp/custom.json' })
    expect(p).toBe('/tmp/custom.json')
  })

  it('falls back to per-platform paths', () => {
    expect(
      resolveDescriptorPath({
        platform: 'darwin',
        homedir: () => '/Users/u',
        envOverride: null,
        env: {}
      })
    ).toBe('/Users/u/Library/Application Support/VidBee/automation.json')

    expect(
      resolveDescriptorPath({
        platform: 'linux',
        homedir: () => '/home/u',
        envOverride: null,
        env: {}
      })
    ).toBe('/home/u/.config/VidBee/automation.json')

    expect(
      resolveDescriptorPath({
        platform: 'win32',
        homedir: () => 'C:\\Users\\u',
        envOverride: null,
        env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }
      })
    ).toContain('VidBee')
  })

  it('XDG_CONFIG_HOME overrides ~/.config on linux', () => {
    expect(
      resolveDescriptorPath({
        platform: 'linux',
        homedir: () => '/home/u',
        envOverride: null,
        env: { XDG_CONFIG_HOME: '/cfg' }
      })
    ).toBe('/cfg/VidBee/automation.json')
  })
})

describe('readDescriptor', () => {
  it('returns DESKTOP_NOT_READY when missing', () => {
    const r = readDescriptor({ pathOverride: '/missing/path', exists: () => false })
    if (r.ok) throw new Error('expected error')
    expect(r.envelope.code).toBe('DESKTOP_NOT_READY')
  })

  it('returns DESKTOP_NOT_READY when malformed', () => {
    const r = readDescriptor({
      pathOverride: '/x',
      exists: () => true,
      readFile: () => 'not json'
    })
    if (r.ok) throw new Error('expected error')
    expect(r.envelope.message).toMatch(/malformed/)
  })

  it('parses a valid descriptor', () => {
    const payload = {
      version: 1,
      schemaVersion: '1.0.0',
      kind: 'desktop',
      host: '127.0.0.1',
      port: 27_100,
      tokenHash: 'sha256:abc',
      tokenIssuedAt: 1,
      tokenExpiresAt: 2,
      pid: 12,
      pidStartedAt: 100,
      updatedAt: 100,
      appVersion: '1.0.0'
    }
    const r = readDescriptor({
      pathOverride: '/x',
      exists: () => true,
      readFile: () => JSON.stringify(payload)
    })
    if (!r.ok) throw new Error('expected ok')
    expect(r.descriptor.host).toBe('127.0.0.1')
    expect(r.descriptor.port).toBe(27_100)
    expect(r.descriptor.tokenHash).toBe('sha256:abc')
  })

  it('rejects future schema versions', () => {
    const r = readDescriptor({
      pathOverride: '/x',
      exists: () => true,
      readFile: () => JSON.stringify({ version: 99 })
    })
    if (r.ok) throw new Error('expected error')
    expect(r.envelope.message).toMatch(/version/)
  })
})

describe('isPidAlive', () => {
  it('returns true when probe succeeds', () => {
    expect(isPidAlive(123, () => undefined)).toBe(true)
  })
  it('returns false when probe throws', () => {
    expect(isPidAlive(123, () => {
      throw new Error('ESRCH')
    })).toBe(false)
  })
})
