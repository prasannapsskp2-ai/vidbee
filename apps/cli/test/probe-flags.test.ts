import { describe, expect, it } from 'vitest'

import {
  PROBE_FLAG_REGISTRY,
  findProbeFlag,
  isProbeArgv
} from '../src/parser/probe-flags'

describe('probe-flag detection (§4.3)', () => {
  it('flags every documented exact alias', () => {
    const aliases = [
      '-j',
      '--dump-json',
      '-J',
      '--dump-single-json',
      '-F',
      '--list-formats',
      '--list-formats-as-table',
      '--list-formats-old',
      '-s',
      '--simulate',
      '--skip-download',
      '--list-subs',
      '--list-extractors',
      '--list-extractor-descriptions'
    ]
    for (const a of aliases) {
      expect(isProbeArgv([a, 'https://x'])).toBe(true)
    }
  })

  it('flags every documented --get-* alias', () => {
    const getters = [
      '--get-id',
      '--get-title',
      '--get-thumbnail',
      '--get-description',
      '--get-duration',
      '--get-filename',
      '--get-format',
      '--get-url'
    ]
    for (const g of getters) {
      expect(isProbeArgv([g, 'https://x'])).toBe(true)
    }
  })

  it('flags --print regardless of position', () => {
    expect(isProbeArgv(['--print', 'title', 'https://x'])).toBe(true)
    expect(isProbeArgv(['https://x', '--print', 'title'])).toBe(true)
    expect(isProbeArgv(['--print', 'title', '--print', 'duration'])).toBe(true)
    expect(isProbeArgv(['--print=title', 'https://x'])).toBe(true)
  })

  it('flags meta commands without URL', () => {
    expect(isProbeArgv(['--update'])).toBe(true)
    expect(isProbeArgv(['--version'])).toBe(true)
  })

  it('mixed argv with probe-class flag is still probe (§4.5)', () => {
    expect(isProbeArgv(['-j', '-f', 'bestaudio', 'https://x'])).toBe(true)
    expect(isProbeArgv(['--simulate', '-o', './out.%(ext)s'])).toBe(true)
    // -o file present but probe flag wins
    expect(isProbeArgv(['-F', '-o', 'video.mp4', 'https://x'])).toBe(true)
  })

  it('does not false-positive on download argv', () => {
    expect(isProbeArgv(['https://x'])).toBe(false)
    expect(
      isProbeArgv(['-f', 'bestvideo+bestaudio/best', '-o', '%(title)s.%(ext)s', 'https://x'])
    ).toBe(false)
    expect(isProbeArgv(['--continue', '--no-overwrites', 'https://x'])).toBe(false)
  })

  it('returns the matched flag for diagnostics', () => {
    expect(findProbeFlag(['--dump-json', 'https://x'])).toBe('--dump-json')
    expect(findProbeFlag(['https://x'])).toBe(null)
  })

  it('exposes the registry constants for cross-checking', () => {
    expect(PROBE_FLAG_REGISTRY.exact.size).toBeGreaterThan(0)
    expect(PROBE_FLAG_REGISTRY.getters.size).toBeGreaterThan(0)
    expect(PROBE_FLAG_REGISTRY.prefixed).toContain('--print')
  })
})
