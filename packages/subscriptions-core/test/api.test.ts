import { beforeEach, describe, expect, it } from 'vitest'
import { SubscriptionsApi, SUBSCRIPTION_DUPLICATE_FEED_ERROR } from '../src/api'
import type { FeedFetcher } from '../src/feed-parser'
import { InMemoryMetaStore } from '../src/store'
import type {
  EnqueueItemContext
} from '../src/api'
import type {
  ParsedFeed,
  SubscriptionCreateInput,
  SubscriptionWithItems
} from '../src/types'
import type { SubscriptionsStore } from '../src/store'

class InMemoryStore implements SubscriptionsStore {
  private subs = new Map<string, SubscriptionWithItems>()
  private nextId = 1

  async list() {
    return Array.from(this.subs.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  async get(id: string) {
    return this.subs.get(id) ?? null
  }
  async findDuplicateFeed(feedUrl: string, ignoreId?: string) {
    for (const sub of this.subs.values()) {
      if (sub.id !== ignoreId && sub.feedUrl === feedUrl) {
        return sub.id
      }
    }
    return null
  }
  async add(input: SubscriptionCreateInput) {
    const id = `sub-${this.nextId++}`
    const now = Date.now()
    const created: SubscriptionWithItems = {
      id,
      title: input.title ?? input.sourceUrl,
      sourceUrl: input.sourceUrl,
      feedUrl: input.feedUrl,
      platform: input.platform,
      keywords: input.keywords ?? [],
      tags: input.tags ?? [],
      onlyDownloadLatest: input.onlyDownloadLatest ?? true,
      enabled: input.enabled ?? true,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      items: []
    }
    this.subs.set(id, created)
    return created
  }
  async update(id: string, patch: Record<string, unknown>) {
    const existing = this.subs.get(id)
    if (!existing) return null
    const next: SubscriptionWithItems = {
      ...existing,
      ...patch,
      updatedAt: Date.now()
    } as SubscriptionWithItems
    this.subs.set(id, next)
    return next
  }
  async remove(id: string) {
    return this.subs.delete(id)
  }
  async replaceItems(
    subscriptionId: string,
    items: Array<{
      id: string
      url: string
      title: string
      publishedAt: number
      thumbnail?: string
    }>
  ) {
    const sub = this.subs.get(subscriptionId)
    if (!sub) return
    sub.items = items.map((item) => {
      const next: SubscriptionWithItems['items'][number] = {
        id: item.id,
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt,
        addedToQueue: false
      }
      if (item.thumbnail) next.thumbnail = item.thumbnail
      return next
    })
  }
  async markItemQueued(subscriptionId: string, itemId: string, taskId: string | null) {
    const sub = this.subs.get(subscriptionId)
    if (!sub) return
    const item = sub.items.find((entry) => entry.id === itemId)
    if (!item) return
    item.addedToQueue = taskId !== null
    if (taskId) {
      item.taskId = taskId
    } else {
      delete item.taskId
    }
  }
}

class FakeFetcher implements FeedFetcher {
  feeds = new Map<string, ParsedFeed>()
  calls: string[] = []
  async fetch(feedUrl: string) {
    this.calls.push(feedUrl)
    return (
      this.feeds.get(feedUrl) ?? {
        title: 'Empty',
        items: []
      }
    )
  }
}

describe('SubscriptionsApi', () => {
  let store: InMemoryStore
  let metaStore: InMemoryMetaStore
  let fetcher: FakeFetcher
  let enqueued: EnqueueItemContext[]
  let api: SubscriptionsApi

  beforeEach(() => {
    store = new InMemoryStore()
    metaStore = new InMemoryMetaStore()
    fetcher = new FakeFetcher()
    enqueued = []
    let counter = 0
    api = new SubscriptionsApi({
      kind: 'desktop',
      pid: 1,
      store,
      metaStore,
      fetcher,
      enqueueItem: async (ctx) => {
        enqueued.push(ctx)
        counter += 1
        return `task-${counter}`
      },
      leader: { scheduleInterval: () => null, clearInterval: () => undefined },
      scheduler: {
        setTimeoutImpl: () => null,
        clearTimeoutImpl: () => undefined
      }
    })
  })

  it('add() rejects duplicate feed URLs with SUBSCRIPTION_DUPLICATE_FEED_URL', async () => {
    await api.add({
      sourceUrl: 'https://x',
      feedUrl: 'https://x/feed',
      platform: 'custom'
    })
    await expect(
      api.add({
        sourceUrl: 'https://x',
        feedUrl: 'https://x/feed',
        platform: 'custom'
      })
    ).rejects.toThrow(SUBSCRIPTION_DUPLICATE_FEED_ERROR)
  })

  it('refreshOne() persists feed items and enqueues new ones', async () => {
    const created = await api.add({
      sourceUrl: 'https://yt',
      feedUrl: 'https://yt/feed',
      platform: 'youtube',
      onlyDownloadLatest: false
    })
    fetcher.feeds.set('https://yt/feed', {
      title: 'YT',
      items: [
        {
          title: 'Latest',
          link: 'https://yt/v/1',
          guid: 'v1',
          isoDate: '2026-04-01T00:00:00Z'
        },
        {
          title: 'Older',
          link: 'https://yt/v/2',
          guid: 'v2',
          isoDate: '2024-01-01T00:00:00Z'
        }
      ]
    })

    await api.refreshOne(created.id)
    const fresh = await api.get({ id: created.id })
    expect(fresh.items).toHaveLength(2)
    expect(fresh.status).toBe('up-to-date')
    expect(enqueued.map((entry) => entry.item.id).sort()).toEqual(['v1', 'v2'])
    const newest = fresh.items.find((item) => item.id === 'v1')
    expect(newest?.addedToQueue).toBe(true)
    expect(newest?.taskId).toBe('task-1')
  })

  it('refreshOne() marks the subscription failed when fetch throws', async () => {
    const created = await api.add({
      sourceUrl: 'https://x',
      feedUrl: 'https://x/feed',
      platform: 'custom'
    })
    fetcher.fetch = async () => {
      throw new Error('boom')
    }
    await api.refreshOne(created.id)
    const fresh = await api.get({ id: created.id })
    expect(fresh.status).toBe('failed')
    expect(fresh.lastError).toBe('boom')
  })

  it('itemsQueue() is idempotent for already-queued items', async () => {
    const created = await api.add({
      sourceUrl: 'https://yt',
      feedUrl: 'https://yt/feed',
      platform: 'youtube',
      onlyDownloadLatest: false
    })
    fetcher.feeds.set('https://yt/feed', {
      title: 'YT',
      items: [
        {
          title: 'Latest',
          link: 'https://yt/v/1',
          guid: 'v1',
          isoDate: '2026-04-01T00:00:00Z'
        }
      ]
    })
    await api.refreshOne(created.id)

    const first = await api.itemsQueue({
      subscriptionId: created.id,
      itemId: 'v1'
    })
    expect(first.queued).toBe(false) // already queued by the auto-pass
    expect(first.taskId).toBe('task-1')
  })

  it('start() acquires the lease; only the leader runs scheduled refreshes', async () => {
    await api.start()
    expect(api.isLeader()).toBe(true)

    const otherStore = new InMemoryStore()
    const otherEnqueued: EnqueueItemContext[] = []
    const other = new SubscriptionsApi({
      kind: 'api',
      pid: 2,
      store: otherStore,
      metaStore,
      fetcher,
      enqueueItem: async (ctx) => {
        otherEnqueued.push(ctx)
        return 'task-other'
      },
      leader: { scheduleInterval: () => null, clearInterval: () => undefined },
      scheduler: {
        setTimeoutImpl: () => null,
        clearTimeoutImpl: () => undefined
      }
    })
    await other.start()
    expect(other.isLeader()).toBe(false)
  })
})
