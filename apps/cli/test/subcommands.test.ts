import { describe, expect, it } from 'vitest'

import { dispatchSubcommand, parseListArgs, type ContractClient } from '../src/subcommands'

const stub: ContractClient = {
  list: async () => ({ items: [], nextCursor: null }),
  get: async () => {
    throw new Error('not used')
  },
  stats: async () => ({ ok: true }),
  removeFromHistory: async () => {}
}

describe('parseListArgs', () => {
  it('parses --status / --limit / --cursor', () => {
    expect(
      parseListArgs(['--status', 'queued', '--limit', '20', '--cursor', 'abc'])
    ).toEqual({ status: 'queued', limit: 20, cursor: 'abc' })
  })
  it('accepts --flag=value form', () => {
    expect(parseListArgs(['--limit=50'])).toEqual({ limit: 50 })
  })
  it('rejects unknown statuses', () => {
    expect(() => parseListArgs(['--status', 'lol'])).toThrow()
  })
  it('rejects non-positive limit', () => {
    expect(() => parseListArgs(['--limit', '0'])).toThrow()
  })
  it('rejects unknown flags', () => {
    expect(() => parseListArgs(['--mystery'])).toThrow()
  })
})

describe('dispatchSubcommand', () => {
  it(':status -> stats', async () => {
    const r = await dispatchSubcommand('status', [], { client: stub })
    expect(r.kind).toBe('value')
    if (r.kind === 'value') expect(r.value).toEqual({ ok: true })
  })

  it('unknown subcommand surfaces PARSE_ERROR', async () => {
    const r = await dispatchSubcommand('teleport', [], { client: stub })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.envelope.code).toBe('PARSE_ERROR')
  })

  it(':rss surfaces NOT_IMPLEMENTED (NEX-132 owns it)', async () => {
    const r = await dispatchSubcommand('rss', ['list'], { client: stub })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.envelope.code).toBe('NOT_IMPLEMENTED')
  })
})
