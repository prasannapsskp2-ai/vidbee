import { describe, expect, it } from 'vitest'

import { redactArgs, redactText } from '../src/parser/redact'

describe('redactArgs (§8.2)', () => {
  it('replaces --password value', () => {
    const r = redactArgs(['--password', 'shh', 'https://x'])
    expect(r.args).toEqual(['--password', '<redacted>', 'https://x'])
    expect(r.summary.redacted).toBe(true)
  })

  it('replaces --password=value form', () => {
    const r = redactArgs(['--password=shh', 'https://x'])
    expect(r.args).toEqual(['--password=<redacted>', 'https://x'])
  })

  it('handles all sensitive value flags', () => {
    for (const flag of [
      '--username',
      '--password',
      '--video-password',
      '--ap-password',
      '--twofactor'
    ]) {
      const r = redactArgs([flag, 'secret', 'https://x'])
      expect(r.args[1]).toBe('<redacted>')
    }
  })

  it('redacts Authorization in --add-headers', () => {
    const r = redactArgs(['--add-headers', 'Authorization:Bearer abc'])
    expect(r.args[1]).toMatch(/Authorization: <redacted>/i)
  })

  it('keeps non-sensitive headers verbatim', () => {
    const r = redactArgs(['--add-headers', 'X-Foo:bar'])
    expect(r.args[1]).toBe('X-Foo:bar')
    expect(r.summary.redacted).toBe(false)
  })

  it('scrubs URL query token=', () => {
    const r = redactArgs(['https://x.com/v?token=abc&other=keep'])
    const url = new URL(r.args[0] as string)
    expect(url.searchParams.get('token')).toBe('<redacted>')
    expect(url.searchParams.get('other')).toBe('keep')
  })

  it('scrubs URL query access_token, signature, policy', () => {
    const r = redactArgs(['https://x.com/v?access_token=a&signature=b&policy=c'])
    const url = new URL(r.args[0] as string)
    expect(url.searchParams.get('access_token')).toBe('<redacted>')
    expect(url.searchParams.get('signature')).toBe('<redacted>')
    expect(url.searchParams.get('policy')).toBe('<redacted>')
  })

  it('leaves unrelated argv untouched', () => {
    const argv = ['-f', 'best', 'https://x.com/v', '-o', 'video.mp4']
    const r = redactArgs(argv)
    expect(r.args).toEqual(argv)
    expect(r.summary.redacted).toBe(false)
  })
})

describe('redactText (§8.2 stdout/stderr)', () => {
  it('replaces Authorization: header line', () => {
    const out = redactText('Sending Authorization: Bearer abc\nDone')
    expect(out).toContain('<redacted>')
    expect(out).not.toContain('Bearer abc')
  })

  it('scrubs URLs in free text', () => {
    const out = redactText('Got https://x.com/v?token=foo')
    // URL-encoded form is acceptable; the important thing is that the
    // original token value is gone.
    expect(out).not.toContain('token=foo')
    expect(out).toMatch(/token=(%3C|<)redacted/i)
  })
})
