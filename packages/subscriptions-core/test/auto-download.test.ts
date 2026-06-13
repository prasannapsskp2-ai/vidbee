import { describe, expect, it } from 'vitest'
import { decideAutoDownloads } from '../src/auto-download'
import type { ParsedFeed, SubscriptionRule } from '../src/types'

const baseSubscription = (overrides: Partial<SubscriptionRule> = {}): SubscriptionRule => ({
  id: 'sub-1',
  title: 'Test Sub',
  sourceUrl: 'https://example.com',
  feedUrl: 'https://example.com/feed.xml',
  platform: 'youtube',
  keywords: [],
  tags: [],
  onlyDownloadLatest: false,
  enabled: true,
  status: 'idle',
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const feed = (items: ParsedFeed['items']): ParsedFeed => ({ title: 'F', items })

describe('decideAutoDownloads', () => {
  it('returns the most recent item only when onlyDownloadLatest=true on first sync', () => {
    const decision = decideAutoDownloads({
      subscription: baseSubscription({ onlyDownloadLatest: true }),
      knownItems: [],
      feed: feed([
        { title: 'old', link: 'a', isoDate: '2024-01-01T00:00:00Z' },
        { title: 'new', link: 'b', isoDate: '2026-01-01T00:00:00Z' }
      ])
    })
    expect(decision.items.map((item) => item.title)).toEqual(['new'])
    expect(decision.feedItemsToPersist).toHaveLength(2)
    expect(decision.latestVideoTitle).toBe('new')
  })

  it('returns all items past the cutoff when onlyDownloadLatest=false', () => {
    const decision = decideAutoDownloads({
      subscription: baseSubscription({
        latestVideoPublishedAt: Date.parse('2025-06-01T00:00:00Z')
      }),
      knownItems: [],
      feed: feed([
        { title: 'old', link: 'a', isoDate: '2025-01-01T00:00:00Z' },
        { title: 'new', link: 'b', isoDate: '2026-01-01T00:00:00Z' },
        { title: 'mid', link: 'c', isoDate: '2025-08-01T00:00:00Z' }
      ])
    })
    expect(decision.items.map((item) => item.title).sort()).toEqual(['mid', 'new'])
  })

  it('drops items already known to the subscription (by id)', () => {
    const decision = decideAutoDownloads({
      subscription: baseSubscription({
        latestVideoPublishedAt: Date.parse('2024-01-01T00:00:00Z')
      }),
      knownItems: [
        {
          id: 'a',
          url: 'https://x/a',
          title: 'old',
          publishedAt: Date.parse('2025-01-01T00:00:00Z'),
          addedToQueue: true
        }
      ],
      feed: feed([
        { title: 'old', link: 'a', guid: 'a', isoDate: '2025-01-01T00:00:00Z' },
        { title: 'new', link: 'b', guid: 'b', isoDate: '2026-01-01T00:00:00Z' }
      ])
    })
    expect(decision.items.map((item) => item.id)).toEqual(['b'])
  })

  it('drops items matching an isHistoryDup callback', () => {
    const decision = decideAutoDownloads({
      subscription: baseSubscription({
        latestVideoPublishedAt: Date.parse('2024-01-01T00:00:00Z')
      }),
      knownItems: [],
      feed: feed([
        { title: 'old', link: 'https://hist/a', guid: 'a', isoDate: '2025-01-01T00:00:00Z' },
        { title: 'new', link: 'https://new/b', guid: 'b', isoDate: '2026-01-01T00:00:00Z' }
      ]),
      isHistoryDup: (url) => url === 'https://hist/a'
    })
    expect(decision.items.map((item) => item.url)).toEqual(['https://new/b'])
  })

  it('keyword filter is OR across the keyword list and case-insensitive', () => {
    const decision = decideAutoDownloads({
      subscription: baseSubscription({
        keywords: ['Tutorial', 'review'],
        latestVideoPublishedAt: Date.parse('2024-01-01T00:00:00Z')
      }),
      knownItems: [],
      feed: feed([
        { title: 'Random Vlog', link: 'a', guid: 'a', isoDate: '2026-01-01T00:00:00Z' },
        { title: 'Big TUTORIAL on cats', link: 'b', guid: 'b', isoDate: '2026-02-01T00:00:00Z' },
        { title: 'product Review', link: 'c', guid: 'c', isoDate: '2026-03-01T00:00:00Z' }
      ])
    })
    expect(decision.items.map((item) => item.id).sort()).toEqual(['b', 'c'])
  })
})
