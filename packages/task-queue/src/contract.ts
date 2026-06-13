/**
 * Single source of truth for the host-neutral TaskQueue RPC surface.
 *
 * apps/desktop, apps/api and apps/cli MUST consume this contract directly.
 * The done-gate for NEX-124 enforces byte-equal schema diffs across hosts —
 * any host adding a custom route or a derived schema is a contract bug.
 */
import { oc } from '@orpc/contract'
import {
  AddInputSchema,
  AddOutputSchema,
  ListInputSchema,
  ListOutputSchema,
  PauseInputSchema,
  RetryInputSchema,
  SetMaxConcurrencyInputSchema,
  SetMaxPerGroupInputSchema,
  StatsOutputSchema,
  TaskIdInputSchema,
  TaskSchema,
  VoidOutputSchema
} from './schemas'

export const taskQueueContract = {
  add: oc.input(AddInputSchema).output(AddOutputSchema),
  get: oc.input(TaskIdInputSchema).output(TaskSchema),
  list: oc.input(ListInputSchema).output(ListOutputSchema),
  cancel: oc.input(TaskIdInputSchema).output(VoidOutputSchema),
  pause: oc.input(PauseInputSchema).output(VoidOutputSchema),
  resume: oc.input(TaskIdInputSchema).output(VoidOutputSchema),
  retry: oc.input(RetryInputSchema).output(VoidOutputSchema),
  setMaxConcurrency: oc
    .input(SetMaxConcurrencyInputSchema)
    .output(VoidOutputSchema),
  setMaxPerGroup: oc.input(SetMaxPerGroupInputSchema).output(VoidOutputSchema),
  removeFromHistory: oc.input(TaskIdInputSchema).output(VoidOutputSchema),
  stats: oc.output(StatsOutputSchema)
}

export type TaskQueueContract = typeof taskQueueContract
