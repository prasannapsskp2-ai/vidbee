import { describe, expect, it } from 'vitest'

import { connect } from '../src/transport/connect'

describe('connect (transport selection)', () => {
  const baseFlags = {
    local: false,
    json: true,
    pretty: false,
    wait: false,
    detach: false,
    noRetry: false,
    noAutostart: false
  }

  it('returns local client when --vidbee-local', async () => {
    const fakeClient = {
      list: async () => ({ items: [], nextCursor: null }),
      get: async () => {
        throw new Error('not used')
      },
      stats: async () => ({}),
      removeFromHistory: async () => {},
      shutdown: async () => {}
    }
    const r = await connect({
      flags: { ...baseFlags, local: true },
      createLocalClientImpl: async () => fakeClient as never
    })
    if (r.kind !== 'connected') throw new Error('expected connected')
    expect(r.client.stats).toBeDefined()
    expect(r.teardown).toBeDefined()
  })

  it('reports DESKTOP_NOT_READY when descriptor missing and autostart disabled', async () => {
    const r = await connect({
      flags: { ...baseFlags, noAutostart: true },
      readDescriptorImpl: () => ({ ok: false, path: '/x', envelope: { ok: false, code: 'DESKTOP_NOT_READY', message: 'missing' } }),
      ensureDesktopReadyImpl: async () => ({ kind: 'autostart-disabled' })
    })
    if (r.kind !== 'error') throw new Error('expected error')
    expect(r.envelope.code).toBe('DESKTOP_NOT_READY')
  })

  it('uses descriptor + automation client when ready', async () => {
    const r = await connect({
      flags: { ...baseFlags },
      readDescriptorImpl: () => ({
        ok: true,
        path: '/x',
        descriptor: {
          version: 1,
          schemaVersion: '1.0.0',
          kind: 'desktop',
          host: '127.0.0.1',
          port: 27_100,
          tokenHash: null,
          tokenIssuedAt: null,
          tokenExpiresAt: null,
          pid: process.pid,
          pidStartedAt: 0,
          updatedAt: 0,
          appVersion: '1.0.0'
        }
      }),
      buildAutomationClient: (baseUrl) => {
        return {
          list: async () => ({ items: [], nextCursor: null }),
          get: async () => {
            throw new Error('not used')
          },
          stats: async () => ({ baseUrl }),
          removeFromHistory: async () => {}
        }
      }
    })
    if (r.kind !== 'connected') throw new Error('expected connected')
    expect(await r.client.stats()).toEqual({ baseUrl: 'http://127.0.0.1:27100' })
  })

  it('reports API_UNREACHABLE when --vidbee-target api with no url', async () => {
    const r = await connect({ flags: { ...baseFlags, target: 'api' } })
    if (r.kind !== 'error') throw new Error('expected error')
    expect(r.envelope.code).toBe('API_UNREACHABLE')
  })
})
