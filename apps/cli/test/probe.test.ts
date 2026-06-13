import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'

import { runProbe, type ProbeSpawnHandle } from '../src/download/probe'

function fakeChild(spec: {
  stdoutChunks?: Buffer[]
  stderrChunks?: Buffer[]
  exitCode?: number
}): ProbeSpawnHandle {
  const stdout = Readable.from(spec.stdoutChunks ?? [])
  const stderr = Readable.from(spec.stderrChunks ?? [])
  let onClose: ((code: number | null) => void) | null = null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let onError: ((err: Error) => void) | null = null
  // when both streams end, fire close
  let pending = 2
  const tryClose = () => {
    pending -= 1
    if (pending === 0) onClose?.(spec.exitCode ?? 0)
  }
  stdout.on('end', tryClose)
  stderr.on('end', tryClose)
  return {
    stdout,
    stderr,
    on(ev, listener) {
      if (ev === 'close') onClose = listener as (code: number | null) => void
      else if (ev === 'error') onError = listener as (err: Error) => void
    },
    kill: () => {
      stdout.destroy()
      stderr.destroy()
      onClose?.(null)
    }
  }
}

describe('runProbe', () => {
  it('captures stdout/stderr and exit code on success', async () => {
    const r = await runProbe({
      argv: ['-j', 'https://x'],
      spawner: () =>
        fakeChild({
          stdoutChunks: [Buffer.from('{"a":1}\n')],
          stderrChunks: [Buffer.from('warn\n')],
          exitCode: 0
        })
    })
    if (r.kind !== 'success') throw new Error(`expected success, got ${JSON.stringify(r)}`)
    expect(r.stdout).toContain('"a":1')
    expect(r.exitCode).toBe(0)
  })

  it('returns PROBE_OUTPUT_TOO_LARGE when stdout exceeds cap', async () => {
    const r = await runProbe({
      argv: ['-j', 'https://x'],
      stdoutMaxBytes: 4,
      spawner: () =>
        fakeChild({
          stdoutChunks: [Buffer.from('xxxxxxxxxx')]
        })
    })
    if (r.kind !== 'error') throw new Error('expected error')
    expect(r.envelope.code).toBe('PROBE_OUTPUT_TOO_LARGE')
  })

  it('returns NOT_IMPLEMENTED when spawner throws', async () => {
    const r = await runProbe({
      argv: ['-j', 'https://x'],
      spawner: () => {
        throw new Error('ENOENT')
      }
    })
    if (r.kind !== 'error') throw new Error('expected error')
    expect(r.envelope.message).toMatch(/ENOENT|spawn/i)
  })

  it('truncates stderr to tail bytes', async () => {
    const big = Buffer.from('x'.repeat(200))
    const r = await runProbe({
      argv: ['-j', 'https://x'],
      stderrTailBytes: 50,
      spawner: () =>
        fakeChild({
          stdoutChunks: [Buffer.from('ok')],
          stderrChunks: [big]
        })
    })
    if (r.kind !== 'success') throw new Error('expected success')
    expect(r.stderr.length).toBeLessThanOrEqual(50)
  })
})
