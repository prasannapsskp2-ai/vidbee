/**
 * Resolve a user-entered URL into a normalized {sourceUrl, feedUrl, platform}.
 *
 * Ported and consolidated from `apps/desktop/src/main/lib/subscription-feed-resolver.ts`.
 * Tests guard regression on the YouTube channel/user/handle and Bilibili shapes
 * that previously fired Sentry issues VIDBEE-39A / VIDBEE-39B.
 */
import type { ResolvedFeed } from './types'

const ensureUrlHasProtocol = (value: string): string => {
  if (!value) {
    return value
  }
  if (!/^https?:\/\//i.test(value)) {
    return `https://${value}`
  }
  return value
}

const createYouTubeFeedUrl = (key: 'channel_id' | 'user', value: string): string => {
  const feedUrl = new URL('https://www.youtube.com/feeds/videos.xml')
  feedUrl.searchParams.set(key, value)
  return feedUrl.toString()
}

export const resolveFeedFromInput = (rawUrl: string): ResolvedFeed => {
  const normalized = ensureUrlHasProtocol(rawUrl.trim())

  const youTubeChannelMatch = normalized.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/i)
  if (youTubeChannelMatch?.[1]) {
    return {
      sourceUrl: normalized,
      feedUrl: createYouTubeFeedUrl('channel_id', youTubeChannelMatch[1]),
      platform: 'youtube'
    }
  }

  if (/youtube\.com\/feeds\/videos\.xml/i.test(normalized)) {
    return {
      sourceUrl: normalized,
      feedUrl: normalized,
      platform: 'youtube'
    }
  }

  const youTubeUserMatch = normalized.match(/youtube\.com\/(?:user|c)\/([^/?]+)/i)
  if (youTubeUserMatch?.[1]) {
    return {
      sourceUrl: normalized,
      feedUrl: createYouTubeFeedUrl('user', youTubeUserMatch[1]),
      platform: 'youtube'
    }
  }

  const youTubeHandleMatch = normalized.match(/youtube\.com\/(@[^/?]+)/i)
  if (youTubeHandleMatch?.[1]) {
    const handle = youTubeHandleMatch[1].replace('@', '')
    return {
      sourceUrl: normalized,
      feedUrl: createYouTubeFeedUrl('user', handle),
      platform: 'youtube'
    }
  }

  const biliSpaceMatch = normalized.match(/bilibili\.com\/(?:space|user)\/(\d+)/i)
  if (biliSpaceMatch?.[1]) {
    return {
      sourceUrl: normalized,
      feedUrl: `https://rsshub.app/bilibili/user/video/${biliSpaceMatch[1]}`,
      platform: 'bilibili'
    }
  }

  if (/rsshub\.app\/bilibili/i.test(normalized)) {
    return {
      sourceUrl: normalized,
      feedUrl: normalized,
      platform: 'bilibili'
    }
  }

  return {
    sourceUrl: normalized,
    feedUrl: normalized,
    platform: 'custom'
  }
}

/**
 * Build a stable hash key for duplicate-feed detection. Two feeds compare
 * equal iff their host+path+query collapse to the same string after a few
 * normalization passes (case, trailing slash, missing protocol).
 */
export const buildFeedKey = (feedUrl: string): string => {
  const trimmed = feedUrl.trim()
  if (!trimmed) {
    return ''
  }
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(normalized)
    let pathname = url.pathname || '/'
    pathname = pathname.replace(/\/+$/, '')
    if (!pathname) {
      pathname = '/'
    }
    return `${url.host.toLowerCase()}${pathname}${url.search}`
  } catch {
    return trimmed.toLowerCase()
  }
}
