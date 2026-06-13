/**
 * Auto-download policy: given a freshly parsed feed and the current
 * subscription state, decide which items should be queued in the shared
 * task-queue and what cover/title metadata to refresh on the subscription.
 *
 * The policy is host-neutral. Hosts call this and then feed each returned
 * item through `taskQueueAPI.add({ kind: 'subscription-item', priority: 10,
 * groupKey: subscription.id, ... })`.
 */
import { dedupeFeedItems, normalizeFeedItems, resolveFeedCover } from './feed-items'
import type {
  AutoDownloadDecision,
  NormalizedFeedItem,
  ParsedFeed,
  SubscriptionFeedItem,
  SubscriptionRule
} from './types'

export interface AutoDownloadInputs {
  subscription: SubscriptionRule
  /** Items currently persisted on the subscription (most-recent-first ok). */
  knownItems: SubscriptionFeedItem[]
  /** Parsed RSS feed (rss-parser output, normalized to ParsedFeed shape). */
  feed: ParsedFeed
  /**
   * Optional: returns true if a candidate URL is already in the global
   * download history (so we shouldn't re-queue it). Hosts can wire this to
   * their own history table; defaults to "always false".
   */
  isHistoryDup?: (url: string) => boolean
  now?: () => number
}

const lastKnownPublishedAt = (
  subscription: SubscriptionRule,
  knownItems: SubscriptionFeedItem[]
): number => {
  const fromItems = knownItems.reduce((max, item) => Math.max(max, item.publishedAt), 0)
  return Math.max(subscription.latestVideoPublishedAt ?? 0, fromItems)
}

const filterRecent = (
  subscription: SubscriptionRule,
  items: NormalizedFeedItem[],
  knownItems: SubscriptionFeedItem[]
): NormalizedFeedItem[] => {
  const cutoff = lastKnownPublishedAt(subscription, knownItems)
  if (cutoff === 0) {
    return subscription.onlyDownloadLatest ? items.slice(0, 1) : items
  }
  return items.filter((item) => item.publishedAt > cutoff)
}

const filterUnseen = (
  knownItems: SubscriptionFeedItem[],
  items: NormalizedFeedItem[]
): NormalizedFeedItem[] => {
  const seen = new Set(knownItems.map((item) => item.id))
  return items.filter((item) => !seen.has(item.id))
}

const matchesKeywords = (item: NormalizedFeedItem, keywords: string[]): boolean => {
  if (keywords.length === 0) {
    return true
  }
  const lowered = item.title.toLowerCase()
  return keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))
}

/**
 * Pure function — no side effects. Hosts feed the returned items into the
 * task queue. The caller owns persistence; this function only computes.
 */
export const decideAutoDownloads = ({
  subscription,
  knownItems,
  feed,
  isHistoryDup,
  now = () => Date.now()
}: AutoDownloadInputs): AutoDownloadDecision => {
  const rawItems = Array.isArray(feed.items) ? feed.items : []
  const normalized = normalizeFeedItems(rawItems, { now })

  const recent = filterRecent(subscription, normalized, knownItems)
  const unseen = filterUnseen(knownItems, recent)
  const keywordFiltered = unseen.filter((item) => matchesKeywords(item, subscription.keywords))
  const deduped = dedupeFeedItems(keywordFiltered)
    .filter((item) => !(isHistoryDup?.(item.url) ?? false))
    .sort((a, b) => b.publishedAt - a.publishedAt)

  const items =
    subscription.onlyDownloadLatest && deduped.length > 0
      ? [deduped[0] as NormalizedFeedItem]
      : deduped

  const latest = normalized[0]
  const coverUrl = resolveFeedCover(feed, normalized, rawItems)

  const decision: AutoDownloadDecision = {
    subscription,
    items,
    feedItemsToPersist: normalized,
    latestPublishedAt: latest?.publishedAt ?? null
  }
  if (latest?.title) {
    decision.latestVideoTitle = latest.title
  }
  if (coverUrl) {
    decision.coverUrl = coverUrl
  }
  return decision
}
