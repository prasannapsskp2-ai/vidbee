/**
 * Single source of truth for the host-neutral subscription RPC surface.
 *
 * apps/desktop, apps/api and apps/cli MUST consume this contract directly.
 * NEX-132's done-gate enforces byte-equal schema diffs across hosts — any
 * host adding a custom route or a derived schema is a contract bug.
 */
import { oc } from '@orpc/contract'
import {
  ItemsListInputSchema,
  ItemsQueueInputSchema,
  ItemsQueueOutputSchema,
  RefreshInputSchema,
  ResolvedFeedSchema,
  ResolveInputSchema,
  SubscriptionCreateInputSchema,
  SubscriptionIdInputSchema,
  SubscriptionItemsListOutputSchema,
  SubscriptionListOutputSchema,
  SubscriptionUpdateInputSchema,
  SubscriptionWithItemsSchema,
  VoidOutputSchema
} from './schemas'

export const subscriptionContract = {
  list: oc.output(SubscriptionListOutputSchema),
  get: oc.input(SubscriptionIdInputSchema).output(SubscriptionWithItemsSchema),
  resolve: oc.input(ResolveInputSchema).output(ResolvedFeedSchema),
  add: oc.input(SubscriptionCreateInputSchema).output(SubscriptionWithItemsSchema),
  update: oc
    .input(SubscriptionIdInputSchema.merge(SubscriptionUpdateInputSchema))
    .output(SubscriptionWithItemsSchema),
  remove: oc.input(SubscriptionIdInputSchema).output(VoidOutputSchema),
  refresh: oc.input(RefreshInputSchema).output(SubscriptionWithItemsSchema),
  itemsList: oc.input(ItemsListInputSchema).output(SubscriptionItemsListOutputSchema),
  itemsQueue: oc.input(ItemsQueueInputSchema).output(ItemsQueueOutputSchema)
}

export type SubscriptionContract = typeof subscriptionContract
