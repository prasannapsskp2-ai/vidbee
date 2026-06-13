/**
 * Thin adapter around `rss-parser`. Exposes a `FeedFetcher` interface so
 * tests and hosts can substitute an in-memory parser, and ships a default
 * implementation that hits the network exactly once per call.
 *
 * The default implementation requires Node 18+ (uses global fetch via the
 * underlying `rss-parser` package).
 */
import Parser from 'rss-parser'
import type { ParsedFeed, ParsedFeedItem } from './types'

export interface FeedFetcher {
  fetch(feedUrl: string): Promise<ParsedFeed>
}

const customFields = {
  item: [
    ['yt:videoId', 'youtubeId'],
    ['media:thumbnail', 'mediaThumbnail'],
    ['media:content', 'mediaContent'],
    ['enclosure', 'enclosure'],
    ['content:encoded', 'contentEncoded'],
    ['description', 'description']
  ] as Array<[string, string]>
}

const toParsedFeed = (raw: Parser.Output<ParsedFeedItem>): ParsedFeed => {
  const feed: ParsedFeed = {
    items: Array.isArray(raw.items) ? raw.items : []
  }
  if (typeof raw.title === 'string') {
    feed.title = raw.title
  }
  if (typeof raw.link === 'string') {
    feed.link = raw.link
  }
  if (raw.image && typeof raw.image === 'object') {
    feed.image = { url: typeof raw.image.url === 'string' ? raw.image.url : undefined }
  }
  if (raw.itunes && typeof raw.itunes === 'object') {
    feed.itunes = {
      image: typeof raw.itunes.image === 'string' ? raw.itunes.image : undefined
    }
  }
  return feed
}

/**
 * Default fetcher backed by `rss-parser`. Lazily constructs the underlying
 * parser so unit tests that pass their own fetcher pay no startup cost.
 */
export class RssParserFeedFetcher implements FeedFetcher {
  private parser: Parser<Record<string, never>, ParsedFeedItem> | null = null

  async fetch(feedUrl: string): Promise<ParsedFeed> {
    if (!this.parser) {
      this.parser = new Parser<Record<string, never>, ParsedFeedItem>({ customFields })
    }
    const raw = await this.parser.parseURL(feedUrl)
    return toParsedFeed(raw)
  }
}
