import { describe, expect, it } from 'vitest'

import {
  legacyDownloadStatusOf,
  legacySubStatusOf,
  projectTaskToLegacy
} from '../src/projection'
import type { ClassifiedError, Task, TaskStatus } from '../src/types'

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  kind: 'video',
  parentId: null,
  input: {
    url: 'https://example.com/v',
    kind: 'video',
    title: 'Example',
    thumbnail: 'https://example.com/t.jpg'
  },
  priority: 0,
  groupKey: 'example.com',
  status: 'queued',
  prevStatus: null,
  statusReason: null,
  enteredStatusAt: 1000,
  attempt: 0,
  maxAttempts: 5,
  nextRetryAt: null,
  progress: {
    percent: null,
    bytesDownloaded: null,
    bytesTotal: null,
    speedBps: null,
    etaMs: null,
    ticks: 0
  },
  output: null,
  lastError: null,
  pid: null,
  pidStartedAt: null,
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
})

const sampleError: ClassifiedError = {
  category: 'http-429',
  exitCode: 1,
  rawMessage: 'too many requests',
  uiMessageKey: 'errors.rate_limited',
  uiActionHints: ['retry-later'],
  retryable: true,
  suggestedRetryAfterMs: 30_000
}

describe('legacyDownloadStatusOf', () => {
  it('maps every internal status to a legacy status', () => {
    const cases: Array<[TaskStatus, ReturnType<typeof legacyDownloadStatusOf>]> = [
      ['queued', 'pending'],
      ['running', 'downloading'],
      ['processing', 'processing'],
      ['paused', 'pending'],
      ['retry-scheduled', 'pending'],
      ['completed', 'completed'],
      ['failed', 'error'],
      ['cancelled', 'cancelled']
    ]
    for (const [internal, legacy] of cases) {
      expect(legacyDownloadStatusOf(internal)).toBe(legacy)
    }
  })

  it('legacySubStatusOf only fires for the collapsed buckets', () => {
    expect(legacySubStatusOf('queued')).toBe('queued')
    expect(legacySubStatusOf('paused')).toBe('paused')
    expect(legacySubStatusOf('retry-scheduled')).toBe('retry-scheduled')
    expect(legacySubStatusOf('running')).toBeUndefined()
    expect(legacySubStatusOf('processing')).toBeUndefined()
    expect(legacySubStatusOf('completed')).toBeUndefined()
    expect(legacySubStatusOf('failed')).toBeUndefined()
    expect(legacySubStatusOf('cancelled')).toBeUndefined()
  })
})

describe('projectTaskToLegacy', () => {
  it('projects queued task as pending without progress', () => {
    const proj = projectTaskToLegacy(baseTask())
    expect(proj.status).toBe('pending')
    expect(proj.subStatus).toBe('queued')
    expect(proj.internalStatus).toBe('queued')
    expect(proj.progress).toBeUndefined()
  })

  it('projects running task with progress and speed', () => {
    const proj = projectTaskToLegacy(
      baseTask({
        status: 'running',
        progress: {
          percent: 0.42,
          bytesDownloaded: 1024 * 1024,
          bytesTotal: 4 * 1024 * 1024,
          speedBps: 512 * 1024,
          etaMs: 12_345,
          ticks: 5
        }
      })
    )
    expect(proj.status).toBe('downloading')
    expect(proj.subStatus).toBeUndefined()
    expect(proj.progress?.percent).toBeCloseTo(42, 5)
    expect(proj.progress?.currentSpeed).toBe('512.00KB/s')
    expect(proj.speed).toBe('512.00KB/s')
  })

  it('projects paused task with subStatus and statusReason', () => {
    const proj = projectTaskToLegacy(
      baseTask({
        status: 'paused',
        statusReason: 'crash-recovery',
        progress: {
          percent: 0.5,
          bytesDownloaded: 100,
          bytesTotal: 200,
          speedBps: null,
          etaMs: null,
          ticks: 1
        }
      })
    )
    expect(proj.status).toBe('pending')
    expect(proj.subStatus).toBe('paused')
    expect(proj.statusReason).toBe('crash-recovery')
    expect(proj.progress?.percent).toBeCloseTo(50, 5)
  })

  it('projects retry-scheduled task with attempt + nextRetryAt + errorCategory', () => {
    const proj = projectTaskToLegacy(
      baseTask({
        status: 'retry-scheduled',
        statusReason: 'http-429',
        attempt: 2,
        maxAttempts: 5,
        nextRetryAt: 9_999_999,
        lastError: sampleError
      })
    )
    expect(proj.status).toBe('pending')
    expect(proj.subStatus).toBe('retry-scheduled')
    expect(proj.attempt).toBe(2)
    expect(proj.maxAttempts).toBe(5)
    expect(proj.nextRetryAt).toBe(9_999_999)
    expect(proj.errorCategory).toBe('http-429')
    expect(proj.uiMessageKey).toBe('errors.rate_limited')
    // Don't surface raw message until status is `error`.
    expect(proj.error).toBeUndefined()
  })

  it('projects completed task with output filename and downloadPath', () => {
    const proj = projectTaskToLegacy(
      baseTask({
        status: 'completed',
        output: {
          filePath: '/Users/me/Downloads/VidBee/clip.mp4',
          size: 1234,
          durationMs: 60_000,
          sha256: null
        }
      })
    )
    expect(proj.status).toBe('completed')
    expect(proj.fileSize).toBe(1234)
    expect(proj.savedFileName).toBe('clip.mp4')
    expect(proj.downloadPath).toBe('/Users/me/Downloads/VidBee')
    expect(proj.duration).toBe(60)
  })

  it('projects failed task and surfaces error/category/uiMessageKey', () => {
    const proj = projectTaskToLegacy(
      baseTask({
        status: 'failed',
        statusReason: 'auth-required',
        lastError: { ...sampleError, category: 'auth-required', rawMessage: 'login needed' }
      })
    )
    expect(proj.status).toBe('error')
    expect(proj.errorCategory).toBe('auth-required')
    expect(proj.uiMessageKey).toBe('errors.rate_limited')
    expect(proj.error).toBe('login needed')
  })

  it('projects cancelled task as cancelled', () => {
    const proj = projectTaskToLegacy(baseTask({ status: 'cancelled' }))
    expect(proj.status).toBe('cancelled')
    expect(proj.subStatus).toBeUndefined()
  })

  it('hoists host metadata from input.options', () => {
    const proj = projectTaskToLegacy(
      baseTask({
        input: {
          url: 'https://example.com/v',
          kind: 'video',
          options: {
            description: 'd',
            channel: 'c',
            uploader: 'u',
            viewCount: 100,
            tags: ['a', 'b'],
            duration: 99,
            playlistTitle: 'PL',
            playlistSize: 7,
            startedAt: 555,
            completedAt: 999,
            downloadPath: '/tmp'
          }
        }
      })
    )
    expect(proj.description).toBe('d')
    expect(proj.channel).toBe('c')
    expect(proj.uploader).toBe('u')
    expect(proj.viewCount).toBe(100)
    expect(proj.tags).toEqual(['a', 'b'])
    expect(proj.duration).toBe(99)
    expect(proj.playlistTitle).toBe('PL')
    expect(proj.playlistSize).toBe(7)
    expect(proj.startedAt).toBe(555)
    expect(proj.completedAt).toBe(999)
    expect(proj.downloadPath).toBe('/tmp')
  })

  it('audio TaskKind becomes audio type', () => {
    const proj = projectTaskToLegacy(baseTask({ kind: 'audio', input: { url: 'x', kind: 'audio' } }))
    expect(proj.type).toBe('audio')
  })
})
