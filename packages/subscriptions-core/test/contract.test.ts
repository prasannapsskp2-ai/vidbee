import { describe, expect, it } from 'vitest'
import { subscriptionContract } from '../src/contract'
import {
  ResolvedFeedSchema,
  SubscriptionCreateInputSchema,
  SubscriptionListOutputSchema,
  SubscriptionRuleSchema
} from '../src/schemas'

describe('subscriptionContract', () => {
  it('exposes the nine documented routes', () => {
    expect(Object.keys(subscriptionContract).sort()).toEqual(
      [
        'add',
        'get',
        'itemsList',
        'itemsQueue',
        'list',
        'remove',
        'refresh',
        'resolve',
        'update'
      ].sort()
    )
  })

  it('validates a well-formed Subscription', () => {
    const raw = {
      id: 'sub-1',
      title: 'My YT',
      sourceUrl: 'https://example.com',
      feedUrl: 'https://example.com/feed.xml',
      platform: 'youtube',
      keywords: ['tutorial'],
      tags: [],
      onlyDownloadLatest: true,
      enabled: true,
      status: 'idle',
      createdAt: 1,
      updatedAt: 1
    }
    const parsed = SubscriptionRuleSchema.safeParse(raw)
    expect(parsed.success).toBe(true)
  })

  it('rejects unknown platform values', () => {
    const raw = {
      sourceUrl: 'https://example.com',
      feedUrl: 'https://example.com/feed.xml',
      platform: 'twitter'
    }
    const parsed = SubscriptionCreateInputSchema.safeParse(raw)
    expect(parsed.success).toBe(false)
  })

  it('ResolvedFeedSchema rejects empty URLs', () => {
    const parsed = ResolvedFeedSchema.safeParse({
      sourceUrl: '',
      feedUrl: '',
      platform: 'custom'
    })
    expect(parsed.success).toBe(false)
  })

  it('SubscriptionListOutputSchema accepts an empty result', () => {
    const parsed = SubscriptionListOutputSchema.safeParse({ items: [], total: 0 })
    expect(parsed.success).toBe(true)
  })
})
