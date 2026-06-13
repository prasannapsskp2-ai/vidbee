import type { SubscriptionRule } from '@shared/types'

interface SubscriptionStatusMeta {
  dotClass: string
  textClass: string
  label: string
}

const fallbackStatusMeta: SubscriptionStatusMeta = {
  dotClass: 'bg-muted-foreground',
  textClass: 'text-muted-foreground',
  label: 'subscriptions.status.idle'
}

const enabledStatusMeta: Record<SubscriptionRule['status'], SubscriptionStatusMeta> = {
  'up-to-date': {
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600',
    label: 'subscriptions.status.up-to-date'
  },
  checking: {
    dotClass: 'bg-sky-500',
    textClass: 'text-sky-600',
    label: 'subscriptions.status.checking'
  },
  failed: {
    dotClass: 'bg-red-500',
    textClass: 'text-red-600',
    label: 'subscriptions.status.failed'
  },
  idle: fallbackStatusMeta
}

export const disabledStatusMeta: SubscriptionStatusMeta = {
  dotClass: 'bg-zinc-400',
  textClass: 'text-muted-foreground',
  label: 'subscriptions.fields.disabled'
}

/**
 * Resolve the subscription status styles without crashing on stale or unknown values.
 *
 * @param status The persisted subscription status.
 * @param enabled Whether the subscription is enabled.
 * @returns The status style metadata used by the subscriptions UI.
 */
export const getSubscriptionStatusMeta = (
  status: string | undefined,
  enabled: boolean
): SubscriptionStatusMeta => {
  if (!enabled) {
    return disabledStatusMeta
  }

  if (status && status in enabledStatusMeta) {
    return enabledStatusMeta[status as SubscriptionRule['status']]
  }

  return fallbackStatusMeta
}
