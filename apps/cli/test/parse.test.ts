import { describe, expect, it } from 'vitest'

import { ParseError, parseArgv } from '../src/parser'

describe('parseArgv — VidBee flag handling (§4.1, §4.2)', () => {
  it('consumes --vidbee-wait switch and removes it from yt-dlp argv', () => {
    const r = parseArgv(['--vidbee-wait', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.wait).toBe(true)
    expect(r.ytArgs).toEqual(['https://x'])
  })

  it('accepts --vidbee-api with separate value', () => {
    const r = parseArgv(['--vidbee-api', 'http://10.0.0.5:3100', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.api).toBe('http://10.0.0.5:3100')
    expect(r.ytArgs).toEqual(['https://x'])
  })

  it('accepts --vidbee-api=value form', () => {
    const r = parseArgv(['--vidbee-api=http://10.0.0.5:3100', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.api).toBe('http://10.0.0.5:3100')
  })

  it('rejects unknown --vidbee-* with exit 2 (§4.2 typo guard)', () => {
    expect(() => parseArgv(['--vidbe-wait', 'https://x'])).toThrow(ParseError)
    try {
      parseArgv(['--vidbe-wait', 'https://x'])
    } catch (e) {
      expect((e as ParseError).exitCode).toBe(2)
      expect((e as ParseError).code).toBe('UNKNOWN_VIDBEE_FLAG')
    }
  })

  it('rejects --vidbee-wait=anything (switch with value)', () => {
    expect(() => parseArgv(['--vidbee-wait=true', 'https://x'])).toThrow(
      ParseError
    )
  })

  it('rejects --vidbee-api with no value', () => {
    expect(() => parseArgv(['--vidbee-api'])).toThrow(ParseError)
  })

  it('validates --vidbee-target enum', () => {
    expect(() => parseArgv(['--vidbee-target', 'lol', 'https://x'])).toThrow(
      ParseError
    )
    const r = parseArgv(['--vidbee-target', 'local', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.target).toBe('local')
  })

  it('validates --vidbee-priority enum', () => {
    expect(() => parseArgv(['--vidbee-priority', 'critical', 'https://x'])).toThrow(
      ParseError
    )
    const r = parseArgv(['--vidbee-priority', 'subscription', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.priority).toBe('subscription')
  })

  it('validates --vidbee-max-attempts is non-negative integer', () => {
    expect(() => parseArgv(['--vidbee-max-attempts', '-1', 'https://x'])).toThrow(
      ParseError
    )
    expect(() => parseArgv(['--vidbee-max-attempts', '1.5', 'https://x'])).toThrow(
      ParseError
    )
    const r = parseArgv(['--vidbee-max-attempts', '0', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.maxAttempts).toBe(0)
    expect(r.flags.noRetry).toBe(true)
  })

  it('validates --vidbee-timeout is positive integer', () => {
    expect(() => parseArgv(['--vidbee-timeout', '0', 'https://x'])).toThrow(ParseError)
    const r = parseArgv(['--vidbee-timeout', '5000', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.timeoutMs).toBe(5000)
  })

  it('--vidbee-no-retry is equivalent to --vidbee-max-attempts 0 (§6.3)', () => {
    const r = parseArgv(['--vidbee-no-retry', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.flags.noRetry).toBe(true)
    expect(r.flags.maxAttempts).toBe(0)
  })
})

describe('parseArgv — yt-dlp passthrough (§4.1)', () => {
  it('preserves order of yt-dlp argv', () => {
    const argv = [
      '-f',
      'bestvideo+bestaudio/best',
      '-o',
      '%(title)s.%(ext)s',
      'https://x'
    ]
    const r = parseArgv(argv)
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.ytArgs).toEqual(argv)
  })

  it('preserves order across interleaved --vidbee-* flags', () => {
    const r = parseArgv([
      '-f',
      'best',
      '--vidbee-wait',
      '-o',
      './out',
      'https://x',
      '--vidbee-priority',
      'background'
    ])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.ytArgs).toEqual(['-f', 'best', '-o', './out', 'https://x'])
    expect(r.flags.wait).toBe(true)
    expect(r.flags.priority).toBe('background')
  })

  it('passes through after --', () => {
    const r = parseArgv(['--', '--vidbee-wait', '--anything-goes'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.ytArgs).toEqual(['--', '--vidbee-wait', '--anything-goes'])
  })

  it('treats unknown yt-dlp flag as passthrough (§4.5)', () => {
    const r = parseArgv(['--future-yt-dlp-flag', 'value', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.ytArgs).toEqual(['--future-yt-dlp-flag', 'value', 'https://x'])
  })
})

describe('parseArgv — mode detection (§4.3, §4.5)', () => {
  it('detects probe mode from any probe-class flag', () => {
    const r = parseArgv(['-j', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.mode).toBe('probe')
    expect(r.probeFlag).toBe('-j')
  })

  it('defaults to download mode when no probe flag is present', () => {
    const r = parseArgv(['https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.mode).toBe('download')
    expect(r.probeFlag).toBe(null)
  })

  it('rejects -o - in download mode (§4.5)', () => {
    expect(() => parseArgv(['-o', '-', 'https://x'])).toThrow(ParseError)
    expect(() => parseArgv(['--output', '-', 'https://x'])).toThrow(ParseError)
    expect(() => parseArgv(['-o-', 'https://x'])).toThrow(ParseError)
  })

  it('allows -o - in probe mode (§4.5)', () => {
    const r = parseArgv(['-j', '-o', '-', 'https://x'])
    if (r.kind !== 'ytdlp') throw new Error('expected ytdlp')
    expect(r.mode).toBe('probe')
    expect(r.ytArgs).toEqual(['-j', '-o', '-', 'https://x'])
  })
})

describe('parseArgv — subcommands (§4.1)', () => {
  it('routes :status as subcommand', () => {
    const r = parseArgv([':status'])
    if (r.kind !== 'subcommand') throw new Error('expected subcommand')
    expect(r.subcommand).toBe('status')
    expect(r.subArgs).toEqual([])
  })

  it('captures all tokens after :subcommand as its args', () => {
    const r = parseArgv([':download', 'list', '--status', 'queued'])
    if (r.kind !== 'subcommand') throw new Error('expected subcommand')
    expect(r.subcommand).toBe('download')
    expect(r.subArgs).toEqual(['list', '--status', 'queued'])
  })

  it('still consumes --vidbee-* before subcommand', () => {
    const r = parseArgv(['--vidbee-pretty', ':download', 'list'])
    if (r.kind !== 'subcommand') throw new Error('expected subcommand')
    expect(r.flags.pretty).toBe(true)
    expect(r.subcommand).toBe('download')
    expect(r.subArgs).toEqual(['list'])
  })

  it('a bare ":" (length 1) is treated as yt-dlp argv passthrough', () => {
    const r = parseArgv([':', 'https://x'])
    expect(r.kind).toBe('ytdlp')
  })
})

describe('parseArgv — fuzz / property tests (§4.1)', () => {
  it('preserves yt-dlp argv order across 1000 random argvs', () => {
    const rng = mulberry32(0xdead_beef)
    const ytTokens = [
      'https://example.com/v',
      '-f',
      'best',
      '-o',
      '%(title)s.%(ext)s',
      '--continue',
      '--no-overwrites',
      '--newline',
      '--cookies-from-browser',
      'firefox',
      '-N',
      '4',
      '--retries',
      '10'
    ]
    // Only single-token vidbee flags (switches and `--flag=value`) so a
    // value flag can never be split from its value by another insertion.
    const vidbeeTokens: string[][] = [
      ['--vidbee-wait'],
      ['--vidbee-detach'],
      ['--vidbee-priority=subscription'],
      ['--vidbee-priority=background'],
      ['--vidbee-max-attempts=3'],
      ['--vidbee-no-retry'],
      ['--vidbee-pretty'],
      ['--vidbee-group-key=host:example.com']
    ]
    for (let i = 0; i < 1000; i++) {
      const yt: string[] = []
      const argv: string[] = []
      const ytLen = Math.floor(rng() * ytTokens.length)
      for (let j = 0; j < ytLen; j++) {
        const idx = Math.floor(rng() * ytTokens.length)
        const tok = ytTokens[idx] as string
        yt.push(tok)
        argv.push(tok)
      }
      // Sprinkle 0..3 vidbee flag groups at random positions.
      const vidbeeCount = Math.floor(rng() * 4)
      for (let j = 0; j < vidbeeCount; j++) {
        const groupIdx = Math.floor(rng() * vidbeeTokens.length)
        const group = vidbeeTokens[groupIdx] as string[]
        const insertPos = Math.floor(rng() * (argv.length + 1))
        argv.splice(insertPos, 0, ...group)
      }
      // -o - is only legal in probe; if argv contains "-o" "-" pair, ensure
      // the test doesn't trip the §4.5 guard incorrectly.
      if (containsStdoutOutput(argv) && !containsProbe(argv)) continue
      const r = parseArgv(argv)
      if (r.kind !== 'ytdlp') {
        throw new Error(
          `unexpected subcommand result for argv: ${JSON.stringify(argv)}`
        )
      }
      expect(r.ytArgs).toEqual(yt)
    }
  })
})

function containsStdoutOutput(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' || argv[i] === '--output') {
      if (argv[i + 1] === '-') return true
    }
  }
  return false
}

function containsProbe(argv: readonly string[]): boolean {
  return argv.some(
    (t) =>
      t === '-j' ||
      t === '-J' ||
      t === '-F' ||
      t === '-s' ||
      t.startsWith('--dump-') ||
      t.startsWith('--list-') ||
      t.startsWith('--get-') ||
      t === '--simulate' ||
      t === '--skip-download' ||
      t === '--print' ||
      t.startsWith('--print=') ||
      t === '--update' ||
      t === '--version'
  )
}

// Deterministic PRNG so failures are reproducible.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d_2b_79_f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}
