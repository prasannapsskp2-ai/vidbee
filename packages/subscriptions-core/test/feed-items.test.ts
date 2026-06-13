import { describe, expect, it } from 'vitest'
import { dedupeFeedItems, normalizeFeedItems, resolveThumbnail } from '../src/feed-items'
import type { ParsedFeedItem } from '../src/types'

describe('normalizeFeedItems', () => {
  it('drops items missing id, title or link', () => {
    const items: ParsedFeedItem[] = [
      { title: 't', link: 'l' }, // no id derivable: id would fall back to link
      { title: 't' }, // missing link
      { link: 'l' } // missing title
    ]
    const out = normalizeFeedItems(items)
    expect(out.map((item) => item.title)).toEqual(['t'])
  })

  it('sorts by publishedAt descending', () => {
    const items: ParsedFeedItem[] = [
      { title: 'old', link: 'a', isoDate: '2020-01-01T00:00:00Z' },
      { title: 'new', link: 'b', isoDate: '2026-04-01T00:00:00Z' },
      { title: 'mid', link: 'c', isoDate: '2024-01-01T00:00:00Z' }
    ]
    const out = normalizeFeedItems(items)
    expect(out.map((item) => item.title)).toEqual(['new', 'mid', 'old'])
  })

  it('falls back to now() when both isoDate and pubDate are missing', () => {
    const fixedNow = 1_700_000_000_000
    const items: ParsedFeedItem[] = [{ title: 't', link: 'l' }]
    const out = normalizeFeedItems(items, { now: () => fixedNow })
    expect(out[0]?.publishedAt).toBe(fixedNow)
  })

  it('prefers youtubeId over guid/link as id', () => {
    const items: ParsedFeedItem[] = [
      { title: 't', link: 'https://www.youtube.com/watch?v=abc', youtubeId: 'abc' }
    ]
    expect(normalizeFeedItems(items)[0]?.id).toBe('abc')
  })
})

describe('resolveThumbnail', () => {
  it('reads media:thumbnail array', () => {
    const item: ParsedFeedItem = {
      mediaThumbnail: [{ url: 'https://example.com/t.jpg' }]
    }
    expect(resolveThumbnail(item)).toBe('https://example.com/t.jpg')
  })

  it('falls back to image enclosures', () => {
    const item: ParsedFeedItem = {
      enclosure: { url: 'https://x/img.png', type: 'image/png' }
    }
    expect(resolveThumbnail(item)).toBe('https://x/img.png')
  })

  it('extracts <img src> from description HTML', () => {
    const item: ParsedFeedItem = {
      description: '<p><img src="https://x/from-html.jpg" alt="x" /></p>'
    }
    expect(resolveThumbnail(item)).toBe('https://x/from-html.jpg')
  })
})

describe('dedupeFeedItems', () => {
  it('keeps the first occurrence of each id', () => {
    const out = dedupeFeedItems([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 3 }
    ])
    expect(out).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 }
    ])
  })
})
