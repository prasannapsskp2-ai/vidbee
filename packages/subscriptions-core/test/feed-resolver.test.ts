import { describe, expect, it } from 'vitest'
import { buildFeedKey, resolveFeedFromInput } from '../src/feed-resolver'

describe('resolveFeedFromInput', () => {
  it('resolves a YouTube channel URL to the feeds endpoint', () => {
    const out = resolveFeedFromInput('https://www.youtube.com/channel/UCXuqSBlHAE6Xw-yeJA0Tunw')
    expect(out.platform).toBe('youtube')
    expect(out.feedUrl).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw'
    )
  })

  it('passes through an already-resolved YouTube feed URL', () => {
    const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdef123'
    const out = resolveFeedFromInput(url)
    expect(out.feedUrl).toBe(url)
    expect(out.platform).toBe('youtube')
  })

  it('escapes user input via URL.searchParams (Sentry VIDBEE-39A regression)', () => {
    const out = resolveFeedFromInput('https://www.youtube.com/user/some user with space')
    expect(out.feedUrl).toContain('user=some+user+with+space')
    expect(out.platform).toBe('youtube')
  })

  it('handles a YouTube @handle URL', () => {
    const out = resolveFeedFromInput('https://www.youtube.com/@MrBeast')
    expect(out.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?user=MrBeast')
    expect(out.platform).toBe('youtube')
  })

  it('routes a Bilibili space URL through rsshub', () => {
    const out = resolveFeedFromInput('https://space.bilibili.com/space/123456')
    expect(out.feedUrl).toBe('https://rsshub.app/bilibili/user/video/123456')
    expect(out.platform).toBe('bilibili')
  })

  it('passes through an rsshub Bilibili URL', () => {
    const url = 'https://rsshub.app/bilibili/user/video/9999'
    const out = resolveFeedFromInput(url)
    expect(out.feedUrl).toBe(url)
    expect(out.platform).toBe('bilibili')
  })

  it('falls through to "custom" with normalized protocol', () => {
    const out = resolveFeedFromInput('feeds.example.com/user/abc')
    expect(out.platform).toBe('custom')
    expect(out.feedUrl).toBe('https://feeds.example.com/user/abc')
  })
})

describe('buildFeedKey', () => {
  it('lowercases host and strips trailing slash', () => {
    expect(buildFeedKey('https://Example.COM/Foo/')).toBe('example.com/Foo')
  })

  it('preserves query string in the key', () => {
    expect(buildFeedKey('https://x/y?z=1')).toBe('x/y?z=1')
  })

  it('compares as duplicate when only the protocol differs', () => {
    const a = buildFeedKey('https://x.com/a')
    const b = buildFeedKey('http://x.com/a/')
    expect(a).toBe(b)
  })

  it('returns empty string for empty input', () => {
    expect(buildFeedKey('')).toBe('')
    expect(buildFeedKey('   ')).toBe('')
  })
})
