/**
 * Subcommand dispatch for `vidbee :…` invocations. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §4.1
 *
 * Phase A delivered the read-only commands; Phase B fills in the write
 * verbs under `:download` (cancel/pause/resume/retry/logs).
 */

import type { AddTaskRequest, Task, TaskQueueAPI, TaskStatus } from '@vidbee/task-queue'
import { errorEnvelope, type ErrorEnvelope } from '../envelope'

export interface ContractClient {
  /**
   * Minimal surface of `taskQueueContract` the CLI needs. Phase A only
   * required readers; Phase B added writers (add/cancel/pause/resume/retry).
   * The transport layer (loopback HTTP / remote HTTPS / `--vidbee-local`)
   * supplies an implementation.
   */
  list: (input: ListInput) => Promise<{ items: Task[]; nextCursor: string | null }>
  get: (id: string) => Promise<Task>
  stats: () => Promise<unknown>
  removeFromHistory: (id: string) => Promise<void>
  add?: (req: AddTaskRequest) => Promise<{ id: string; task: Task }>
  cancel?: (id: string) => Promise<void>
  pause?: (id: string, reason?: string) => Promise<void>
  resume?: (id: string) => Promise<void>
  retry?: (id: string) => Promise<void>
}

export interface ListInput {
  status?: TaskStatus
  groupKey?: string
  parentId?: string
  limit?: number
  cursor?: string | null
}

export interface SubcommandContext {
  client: ContractClient
  /**
   * `--vidbee-local` instantiates this directly. Read-only commands don't
   * need it but `:download logs <id>` reaches into attempt rows that the
   * orchestrator owns; future work will add a route to the contract.
   */
  api?: TaskQueueAPI
}

export type SubcommandResult =
  | { kind: 'value'; value: unknown }
  | { kind: 'error'; envelope: ErrorEnvelope }

export async function dispatchSubcommand(
  subcommand: string,
  args: readonly string[],
  ctx: SubcommandContext
): Promise<SubcommandResult> {
  const path = subcommand.split('/').filter(Boolean)
  switch (path[0]) {
    case 'status':
      return ok(await ctx.client.stats())
    case 'download':
      return await handleDownload(path.slice(1), args, ctx)
    case 'history':
      return await handleHistory(path.slice(1), args, ctx)
    case 'rss':
      return notImplemented('rss', 'NEX-132 owns :rss subcommands')
    default:
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'PARSE_ERROR',
          `unknown subcommand: :${subcommand}`,
          { subcommand }
        )
      }
  }
}

async function handleDownload(
  rest: readonly string[],
  args: readonly string[],
  ctx: SubcommandContext
): Promise<SubcommandResult> {
  const verb = rest[0] ?? args[0]
  const tail = (rest.length > 0 ? args : args.slice(1)).filter(
    (s): s is string => typeof s === 'string'
  )
  switch (verb) {
    case 'list': {
      const input = parseListArgs(tail)
      return ok(await ctx.client.list(input))
    }
    case 'status': {
      const id = tail[0]
      if (!id) return missingArg(':download status <id>', 'id')
      return ok(await ctx.client.get(id))
    }
    case 'logs': {
      const id = tail[0]
      if (!id) return missingArg(':download logs <id>', 'id')
      // The contract doesn't expose a per-attempt logs route. We surface
      // the task object (which includes `lastError.stderrTail`) so callers
      // can inspect failures without a separate round-trip. A dedicated
      // logs route is tracked as a follow-up that needs new contract
      // schema work in @vidbee/task-queue.
      const task = await ctx.client.get(id)
      const stderrTail =
        (task.lastError as { stderrTail?: string } | null)?.stderrTail ?? null
      return ok({ task, logs: { stderrTail } })
    }
    case 'cancel': {
      const id = tail[0]
      if (!id) return missingArg(':download cancel <id>', 'id')
      if (!ctx.client.cancel) return capabilityError('cancel')
      await ctx.client.cancel(id)
      return ok({ id, status: 'cancel-requested' })
    }
    case 'pause': {
      const id = tail[0]
      if (!id) return missingArg(':download pause <id> [--reason text]', 'id')
      const reason = readNamedArg(tail, '--reason')
      if (!ctx.client.pause) return capabilityError('pause')
      await ctx.client.pause(id, reason)
      return ok({ id, status: 'pause-requested' })
    }
    case 'resume': {
      const id = tail[0]
      if (!id) return missingArg(':download resume <id>', 'id')
      if (!ctx.client.resume) return capabilityError('resume')
      await ctx.client.resume(id)
      return ok({ id, status: 'resume-requested' })
    }
    case 'retry': {
      const id = tail[0]
      if (!id) return missingArg(':download retry <id>', 'id')
      if (!ctx.client.retry) return capabilityError('retry')
      await ctx.client.retry(id)
      return ok({ id, status: 'retry-requested' })
    }
    default:
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'PARSE_ERROR',
          `unknown :download verb: ${verb ?? '(missing)'}`
        )
      }
  }
}

async function handleHistory(
  rest: readonly string[],
  args: readonly string[],
  ctx: SubcommandContext
): Promise<SubcommandResult> {
  const verb = rest[0] ?? args[0]
  const tail = (rest.length > 0 ? args : args.slice(1)).filter(
    (s): s is string => typeof s === 'string'
  )
  switch (verb) {
    case 'list': {
      const input = parseListArgs(tail)
      // History view is a list filtered to terminal statuses; the contract
      // doesn't expose a separate history route — the projection happens
      // host-side. Here we just forward.
      return ok(await ctx.client.list(input))
    }
    case 'remove': {
      if (tail.length === 0) return missingArg(':history remove <id...>', 'id')
      const removed: string[] = []
      for (const id of tail) {
        await ctx.client.removeFromHistory(id)
        removed.push(id)
      }
      return ok({ removed })
    }
    default:
      return {
        kind: 'error',
        envelope: errorEnvelope(
          'PARSE_ERROR',
          `unknown :history verb: ${verb ?? '(missing)'}`
        )
      }
  }
}

const KNOWN_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'queued',
  'running',
  'processing',
  'paused',
  'retry-scheduled',
  'completed',
  'failed',
  'cancelled'
])

export function parseListArgs(args: readonly string[]): ListInput {
  const input: ListInput = {}
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]
    if (tok === undefined) continue
    const eq = tok.indexOf('=')
    const name = eq === -1 ? tok : tok.slice(0, eq)
    const inline = eq === -1 ? null : tok.slice(eq + 1)
    const consume = (): string => {
      if (inline !== null) return inline
      const next = args[i + 1]
      if (next === undefined) {
        throw Object.assign(new Error(`${name} requires a value`), {
          code: 'MISSING_VALUE'
        })
      }
      i += 1
      return next
    }
    switch (name) {
      case '--status': {
        const v = consume()
        if (!(KNOWN_STATUSES as Set<string>).has(v)) {
          throw Object.assign(new Error(`unknown status: ${v}`), {
            code: 'INVALID_STATUS'
          })
        }
        input.status = v as TaskStatus
        break
      }
      case '--group':
      case '--group-key':
        input.groupKey = consume()
        break
      case '--parent':
        input.parentId = consume()
        break
      case '--limit': {
        const v = consume()
        const n = Number.parseInt(v, 10)
        if (!Number.isFinite(n) || n <= 0) {
          throw Object.assign(new Error(`invalid limit: ${v}`), {
            code: 'INVALID_LIMIT'
          })
        }
        input.limit = n
        break
      }
      case '--cursor':
        input.cursor = consume()
        break
      default:
        throw Object.assign(new Error(`unknown flag: ${name}`), {
          code: 'UNKNOWN_FLAG'
        })
    }
  }
  return input
}

function ok(value: unknown): SubcommandResult {
  return { kind: 'value', value }
}

function notImplemented(what: string, why: string): SubcommandResult {
  return {
    kind: 'error',
    envelope: errorEnvelope('NOT_IMPLEMENTED', `${what} not implemented`, {
      reason: why
    })
  }
}

function missingArg(usage: string, argName: string): SubcommandResult {
  return {
    kind: 'error',
    envelope: errorEnvelope('PARSE_ERROR', `missing ${argName}; usage: ${usage}`)
  }
}

function capabilityError(op: string): SubcommandResult {
  return {
    kind: 'error',
    envelope: errorEnvelope(
      'CONTRACT_VERSION_MISMATCH',
      `transport does not support ${op}; upgrade Desktop or API host`
    )
  }
}

function readNamedArg(args: readonly string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]
    if (tok === undefined) continue
    if (tok === name) return args[i + 1]
    if (tok.startsWith(`${name}=`)) return tok.slice(name.length + 1)
  }
  return undefined
}
