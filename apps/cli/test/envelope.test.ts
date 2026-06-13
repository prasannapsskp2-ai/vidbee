import { describe, expect, it } from 'vitest'

import {
  ExitCode,
  errorEnvelope,
  exitCodeForError,
  renderEnvelope
} from '../src/envelope'

describe('exitCodeForError (§4.4 table)', () => {
  it('maps host unreachability to 3', () => {
    expect(exitCodeForError('DESKTOP_NOT_READY')).toBe(ExitCode.HOST_UNREACHABLE)
    expect(exitCodeForError('API_UNREACHABLE')).toBe(ExitCode.HOST_UNREACHABLE)
    expect(exitCodeForError('HANDSHAKE_FAILED')).toBe(ExitCode.HOST_UNREACHABLE)
  })
  it('maps auth to 4', () => {
    expect(exitCodeForError('AUTH_FAILED')).toBe(ExitCode.AUTH_FAILED)
    expect(exitCodeForError('TOKEN_EXPIRED')).toBe(ExitCode.AUTH_FAILED)
  })
  it('maps contract / not-implemented to 5', () => {
    expect(exitCodeForError('CONTRACT_VERSION_MISMATCH')).toBe(ExitCode.CONTRACT_ERROR)
    expect(exitCodeForError('CONTRACT_SCHEMA_MISMATCH')).toBe(ExitCode.CONTRACT_ERROR)
    expect(exitCodeForError('NOT_IMPLEMENTED')).toBe(ExitCode.CONTRACT_ERROR)
  })
  it('maps probe overflow to 1', () => {
    expect(exitCodeForError('PROBE_OUTPUT_TOO_LARGE')).toBe(ExitCode.WAIT_NON_SUCCESS)
  })
  it('falls back to 2 for parse-time codes', () => {
    expect(exitCodeForError('UNKNOWN_VIDBEE_FLAG')).toBe(ExitCode.ARG_ERROR)
    expect(exitCodeForError('PARSE_ERROR')).toBe(ExitCode.ARG_ERROR)
  })
})

describe('renderEnvelope', () => {
  it('emits compact JSON by default', () => {
    const env = errorEnvelope('PARSE_ERROR', 'oops')
    expect(renderEnvelope(env)).toBe('{"ok":false,"code":"PARSE_ERROR","message":"oops"}')
  })
  it('pretty-prints when asked', () => {
    const env = errorEnvelope('PARSE_ERROR', 'oops')
    expect(renderEnvelope(env, { pretty: true })).toContain('\n')
  })
})
