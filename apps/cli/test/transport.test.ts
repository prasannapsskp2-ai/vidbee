import { describe, expect, it } from 'vitest'

import {
  isLoopbackOrPrivateHost,
  selectTransport,
  transportNotReady,
  validateApiUrl
} from '../src/transport'

describe('isLoopbackOrPrivateHost (§8.1)', () => {
  it('accepts loopback', () => {
    expect(isLoopbackOrPrivateHost('localhost')).toBe(true)
    expect(isLoopbackOrPrivateHost('127.0.0.1')).toBe(true)
    expect(isLoopbackOrPrivateHost('127.5.5.5')).toBe(true)
    expect(isLoopbackOrPrivateHost('::1')).toBe(true)
  })

  it('accepts RFC1918 private ranges', () => {
    expect(isLoopbackOrPrivateHost('10.0.0.5')).toBe(true)
    expect(isLoopbackOrPrivateHost('192.168.1.1')).toBe(true)
    expect(isLoopbackOrPrivateHost('172.16.0.1')).toBe(true)
    expect(isLoopbackOrPrivateHost('172.31.255.255')).toBe(true)
    expect(isLoopbackOrPrivateHost('169.254.1.1')).toBe(true)
  })

  it('rejects public ranges', () => {
    expect(isLoopbackOrPrivateHost('8.8.8.8')).toBe(false)
    expect(isLoopbackOrPrivateHost('172.32.0.1')).toBe(false)
    expect(isLoopbackOrPrivateHost('172.15.255.255')).toBe(false)
    expect(isLoopbackOrPrivateHost('example.com')).toBe(false)
  })

  it('treats *.local as private (mDNS)', () => {
    expect(isLoopbackOrPrivateHost('foo.local')).toBe(true)
  })
})

describe('validateApiUrl (§8.1)', () => {
  it('accepts https on any host', () => {
    expect(validateApiUrl('https://example.com')).toBe(null)
  })
  it('accepts http on loopback / private', () => {
    expect(validateApiUrl('http://127.0.0.1:3100')).toBe(null)
    expect(validateApiUrl('http://10.0.0.5:3100')).toBe(null)
  })
  it('rejects http on public host', () => {
    const env = validateApiUrl('http://example.com')
    expect(env?.code).toBe('API_UNREACHABLE')
  })
  it('rejects unparseable URLs', () => {
    expect(validateApiUrl('not a url')?.code).toBe('API_UNREACHABLE')
  })
  it('rejects unsupported schemes', () => {
    expect(validateApiUrl('ftp://example.com')?.code).toBe('API_UNREACHABLE')
  })
})

describe('selectTransport', () => {
  it('selects local when --vidbee-local is set', () => {
    expect(selectTransport({ local: true } as never).kind).toBe('local')
  })
  it('selects api when --vidbee-api is given', () => {
    expect(
      selectTransport({ local: false, api: 'https://x' } as never).kind
    ).toBe('api')
  })
  it('defaults to desktop', () => {
    expect(selectTransport({ local: false } as never).kind).toBe('desktop')
  })
  it('honors --vidbee-target overrides', () => {
    expect(selectTransport({ local: false, target: 'local' } as never).kind).toBe('local')
    expect(selectTransport({ local: false, target: 'api' } as never).kind).toBe('api')
  })
})

describe('transportNotReady (Phase B gate)', () => {
  it('says DESKTOP_NOT_READY for desktop', () => {
    const r = transportNotReady({ kind: 'desktop' })
    expect(r.envelope.code).toBe('DESKTOP_NOT_READY')
    expect(r.exitCode).toBe(3)
  })
  it('says API_UNREACHABLE for api', () => {
    const r = transportNotReady({ kind: 'api' })
    expect(r.envelope.code).toBe('API_UNREACHABLE')
    expect(r.exitCode).toBe(3)
  })
})
