import { describe, expect, it } from 'vitest'

import { buildForwardedInput } from '../src/download/build-input'
import type { Flags } from '../src/parser'

const baseFlags: Flags = {
  local: false,
  json: true,
  pretty: false,
  wait: false,
  detach: false,
  noRetry: false,
  noAutostart: false
}

describe('buildForwardedInput (§6.2)', () => {
  it('preserves rawArgs and emits sanitizedArgs in options', () => {
    const r = buildForwardedInput({
      argv: ['--password', 'shh', '-f', 'best', 'https://x'],
      flags: baseFlags
    })
    expect(r.input.kind).toBe('yt-dlp-forward')
    expect(r.input.rawArgs).toEqual(['--password', 'shh', '-f', 'best', 'https://x'])
    const opts = r.input.options as { sanitizedArgs: string[] }
    expect(opts.sanitizedArgs[1]).toBe('<redacted>')
    expect(r.redacted).toBe(true)
  })

  it('extracts URL from argv (last bare URL positional)', () => {
    const r = buildForwardedInput({
      argv: ['-f', 'best', 'https://a.com', 'https://b.com'],
      flags: baseFlags
    })
    expect(r.input.url).toBe('https://b.com')
  })

  it('does not pick up URL-shaped value of a value-consuming flag', () => {
    const r = buildForwardedInput({
      argv: ['--cookies', '/tmp/c.txt', 'https://x'],
      flags: baseFlags
    })
    expect(r.input.url).toBe('https://x')
  })

  it('parses output hints from -o / --paths / -o -', () => {
    const r1 = buildForwardedInput({
      argv: ['-j', '-o', '-', 'https://x'],
      flags: baseFlags
    })
    expect((r1.input.options as { outputHints: { stdoutMode: boolean } }).outputHints.stdoutMode).toBe(
      true
    )

    const r2 = buildForwardedInput({
      argv: ['-o', 'video.mp4', 'https://x'],
      flags: baseFlags
    })
    expect(
      (r2.input.options as { outputHints: { outputTemplate: string } }).outputHints.outputTemplate
    ).toBe('video.mp4')

    const r3 = buildForwardedInput({
      argv: ['-P', '/tmp', 'https://x'],
      flags: baseFlags
    })
    expect((r3.input.options as { outputHints: { paths: string[] } }).outputHints.paths).toEqual([
      '/tmp'
    ])
  })

  it('packs vidbee.* metadata when flags are set', () => {
    const r = buildForwardedInput({
      argv: ['https://x'],
      flags: { ...baseFlags, wait: true, priority: 'subscription', maxAttempts: 2 }
    })
    expect((r.input.options as { vidbee: { wait: boolean; priority: string; maxAttempts: number } }).vidbee).toEqual({
      wait: true,
      priority: 'subscription',
      maxAttempts: 2
    })
  })

  it('quotes whitespace tokens in command preview', () => {
    const r = buildForwardedInput({
      argv: ['-o', 'has space.mp4', 'https://x'],
      flags: baseFlags
    })
    expect(r.commandPreview).toContain("'has space.mp4'")
  })
})
