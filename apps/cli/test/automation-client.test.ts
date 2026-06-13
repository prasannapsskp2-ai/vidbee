import { describe, expect, it } from 'vitest'

import { AutomationClient } from '../src/transport/automation-client'

interface FakeResponse {
  status: number
  body: unknown
}

function fakeFetch(routes: Record<string, FakeResponse | ((init: RequestInit) => FakeResponse)>): typeof fetch {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const u = String(url)
    calls.push({ url: u, init })
    const path = new URL(u).pathname
    const route = routes[path]
    const r = typeof route === 'function' ? route(init) : route
    if (!r) {
      return new Response('not found', { status: 404 })
    }
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    return new Response(body, {
      status: r.status,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
  ;(f as unknown as { calls: typeof calls }).calls = calls
  return f
}

describe('AutomationClient handshake', () => {
  it('handshakes once then reuses token', async () => {
    let handshakes = 0
    const fetchImpl = fakeFetch({
      '/automation/v1/handshake': () => {
        handshakes += 1
        return {
          status: 200,
          body: { token: 'tok', expiresAt: Date.now() + 600_000, ttlMs: 600_000, schemaVersion: '1.0.0' }
        }
      },
      '/automation/v1/stats': { status: 200, body: { running: 0 } }
    })
    const c = new AutomationClient({ baseUrl: 'http://127.0.0.1:27100', fetch: fetchImpl })
    await c.stats()
    await c.stats()
    expect(handshakes).toBe(1)
  })

  it('re-handshakes on 401', async () => {
    let handshakes = 0
    let nextStats: 401 | 200 = 401
    const fetchImpl = fakeFetch({
      '/automation/v1/handshake': () => {
        handshakes += 1
        return { status: 200, body: { token: 't', expiresAt: Date.now() + 600_000, ttlMs: 600_000 } }
      },
      '/automation/v1/stats': () => {
        if (nextStats === 401) {
          nextStats = 200
          return { status: 401, body: { error: 'unauthorized' } }
        }
        return { status: 200, body: { ok: true } }
      }
    })
    const c = new AutomationClient({ baseUrl: 'http://127.0.0.1:27100', fetch: fetchImpl })
    const result = await c.stats()
    expect(result).toEqual({ ok: true })
    expect(handshakes).toBe(2) // initial + re-handshake on 401
  })

  it('skipHandshake uses provided token', async () => {
    const fetchImpl = fakeFetch({
      '/automation/v1/stats': (init) => {
        const auth = (init.headers as Record<string, string>).Authorization
        return { status: auth === 'Bearer t' ? 200 : 401, body: { auth } }
      }
    })
    const c = new AutomationClient({
      baseUrl: 'http://127.0.0.1:27100',
      fetch: fetchImpl,
      token: 't',
      skipHandshake: true
    })
    const r = await c.stats()
    expect(r).toEqual({ auth: 'Bearer t' })
  })

  it('list maps {tasks} → {items}', async () => {
    const fetchImpl = fakeFetch({
      '/automation/v1/handshake': { status: 200, body: { token: 't', expiresAt: Date.now() + 600_000, ttlMs: 600_000 } },
      '/automation/v1/list': {
        status: 200,
        body: {
          tasks: [{ task: { id: 'a', status: 'queued' }, projection: {} }],
          nextCursor: null
        }
      }
    })
    const c = new AutomationClient({ baseUrl: 'http://127.0.0.1:27100', fetch: fetchImpl })
    const r = await c.list({})
    expect(r.items).toHaveLength(1)
    expect((r.items[0] as { id: string }).id).toBe('a')
  })

  it('add() chases get() to assemble {id, task}', async () => {
    const fetchImpl = fakeFetch({
      '/automation/v1/handshake': { status: 200, body: { token: 't', expiresAt: Date.now() + 600_000, ttlMs: 600_000 } },
      '/automation/v1/add': { status: 200, body: { id: 'id1' } },
      '/automation/v1/get': { status: 200, body: { task: { id: 'id1', status: 'queued' }, projection: {} } }
    })
    const c = new AutomationClient({ baseUrl: 'http://127.0.0.1:27100', fetch: fetchImpl })
    const r = await c.add({ input: { url: 'https://x', kind: 'video' } })
    expect(r.id).toBe('id1')
    expect((r.task as { status: string }).status).toBe('queued')
  })
})
