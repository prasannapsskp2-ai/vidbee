/**
 * Talks to the `/automation/v1/*` HTTP surface used by both Desktop
 * loopback (NEX-131 A1) and the remote Web/API host. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §5.1, §5.3, §8.1
 *
 * Wire format (POST JSON, GET for stats / health / events):
 *   POST /automation/v1/handshake             -> { token, expiresAt, ttlMs }
 *   POST /automation/v1/add                   -> AddOutput
 *   POST /automation/v1/get                   -> { task, projection } | null
 *   POST /automation/v1/list                  -> { tasks, nextCursor }
 *   POST /automation/v1/cancel|pause|resume   -> { ok: true }
 *   POST /automation/v1/retry                 -> { ok: true }
 *   POST /automation/v1/setMaxConcurrency     -> { ok: true }
 *   POST /automation/v1/setMaxPerGroup        -> { ok: true }
 *   POST /automation/v1/removeFromHistory     -> { ok: true }
 *   GET  /automation/v1/stats                 -> stats
 *   GET  /automation/v1/health                -> health (no auth)
 *   GET  /automation/v1/events                -> SSE
 *
 * The client owns a short-lived bearer token. It re-handshakes on:
 *   - first call (no token cached)
 *   - explicit 401 from the server
 *   - token within `expiresAtSlackMs` of expiry
 */

import type { Task, AddTaskRequest } from '@vidbee/task-queue'

import type { ContractClient, ListInput } from '../subcommands'

export interface AutomationClientOptions {
  /** Base URL such as `http://127.0.0.1:27100` (no trailing slash, no path). */
  baseUrl: string
  /** Pre-supplied bearer token (e.g. from `--vidbee-token` or env). */
  token?: string
  /** Skip handshake; only legal when `token` is provided. */
  skipHandshake?: boolean
  /** Request timeout per call (ms). Default 30s. */
  requestTimeoutMs?: number
  /** Renew when fewer than this many ms remain on the token. Default 60_000. */
  expiresAtSlackMs?: number
  /**
   * fetch override for tests. Defaults to global fetch.
   */
  fetch?: typeof fetch
  /** Test seam — defaults to Date.now. */
  clock?: () => number
}

export interface HandshakeResponse {
  token: string
  expiresAt: number
  ttlMs: number
  schemaVersion: string
}

export class AutomationHttpError extends Error {
  readonly status: number
  readonly body: string
  readonly code: 'AUTH_FAILED' | 'API_UNREACHABLE' | 'CONTRACT_ERROR' | 'UNKNOWN'

  constructor(
    code: AutomationHttpError['code'],
    status: number,
    message: string,
    body = ''
  ) {
    super(message)
    this.code = code
    this.status = status
    this.body = body
  }
}

export class AutomationClient implements ContractClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly clock: () => number
  private readonly requestTimeoutMs: number
  private readonly expiresAtSlackMs: number
  private readonly skipHandshake: boolean
  private token: string | null
  private tokenExpiresAt: number | null

  constructor(opts: AutomationClientOptions) {
    this.baseUrl = stripTrailingSlash(opts.baseUrl)
    this.fetchImpl = opts.fetch ?? globalThis.fetch
    this.clock = opts.clock ?? Date.now
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000
    this.expiresAtSlackMs = opts.expiresAtSlackMs ?? 60_000
    this.skipHandshake = opts.skipHandshake ?? false
    this.token = opts.token ?? null
    this.tokenExpiresAt = opts.token ? Number.POSITIVE_INFINITY : null
  }

  // ───────────── Handshake ─────────────

  async handshake(): Promise<HandshakeResponse> {
    const res = await this.rawFetch('POST', '/automation/v1/handshake', {})
    if (!res.ok) {
      throw new AutomationHttpError(
        'API_UNREACHABLE',
        res.status,
        `handshake failed: ${res.status} ${res.statusText}`,
        res.bodyText
      )
    }
    const body = res.json as HandshakeResponse
    if (!body || typeof body.token !== 'string' || typeof body.expiresAt !== 'number') {
      throw new AutomationHttpError(
        'CONTRACT_ERROR',
        res.status,
        'handshake response missing token/expiresAt',
        res.bodyText
      )
    }
    this.token = body.token
    this.tokenExpiresAt = body.expiresAt
    return body
  }

  async ensureToken(): Promise<string> {
    if (this.skipHandshake) {
      if (!this.token) {
        throw new AutomationHttpError(
          'AUTH_FAILED',
          0,
          'skipHandshake set but no token provided'
        )
      }
      return this.token
    }
    if (this.token && this.tokenExpiresAt !== null) {
      if (this.tokenExpiresAt - this.clock() > this.expiresAtSlackMs) {
        return this.token
      }
    }
    const res = await this.handshake()
    return res.token
  }

  // ───────────── ContractClient ─────────────

  async list(input: ListInput): Promise<{ items: Task[]; nextCursor: string | null }> {
    const body = await this.callPost<{
      tasks: { task: Task; projection: unknown }[] | Task[]
      nextCursor: string | null
    }>('list', input)
    return {
      items: Array.isArray(body.tasks)
        ? body.tasks.map((t) => ('task' in (t as Record<string, unknown>) ? (t as { task: Task }).task : (t as Task)))
        : [],
      nextCursor: body.nextCursor ?? null
    }
  }

  async get(id: string): Promise<Task> {
    const body = await this.callPost<{ task: Task; projection: unknown } | Task | null>(
      'get',
      { id }
    )
    if (!body) {
      throw new AutomationHttpError(
        'CONTRACT_ERROR',
        404,
        `task ${id} not found`
      )
    }
    if ('task' in (body as Record<string, unknown>)) return (body as { task: Task }).task
    return body as Task
  }

  async stats(): Promise<unknown> {
    await this.ensureToken()
    const res = await this.rawFetch('GET', '/automation/v1/stats')
    if (res.status === 401) {
      this.token = null
      await this.ensureToken()
      const retry = await this.rawFetch('GET', '/automation/v1/stats')
      if (!retry.ok) {
        throw new AutomationHttpError('UNKNOWN', retry.status, 'stats failed', retry.bodyText)
      }
      return retry.json
    }
    if (!res.ok) {
      throw new AutomationHttpError('UNKNOWN', res.status, 'stats failed', res.bodyText)
    }
    return res.json
  }

  async removeFromHistory(id: string): Promise<void> {
    await this.callPost<{ ok: true }>('removeFromHistory', { id })
  }

  // Phase B writers
  async add(req: AddTaskRequest): Promise<{ id: string; task: Task }> {
    const { id } = await this.callPost<{ id: string }>('add', req)
    const task = await this.get(id)
    return { id, task }
  }
  async cancel(id: string): Promise<void> {
    await this.callPost<{ ok: true }>('cancel', { id })
  }
  async pause(id: string, reason?: string): Promise<void> {
    await this.callPost<{ ok: true }>('pause', { id, reason })
  }
  async resume(id: string): Promise<void> {
    await this.callPost<{ ok: true }>('resume', { id })
  }
  async retry(id: string): Promise<void> {
    await this.callPost<{ ok: true }>('retry', { id })
  }

  // ───────────── Internals ─────────────

  private async callPost<T>(op: string, body: unknown): Promise<T> {
    await this.ensureToken()
    const res = await this.rawFetch('POST', `/automation/v1/${op}`, body)
    if (res.status === 401) {
      this.token = null
      await this.ensureToken()
      const retry = await this.rawFetch('POST', `/automation/v1/${op}`, body)
      if (!retry.ok) {
        throw httpErrorOf(retry, op)
      }
      return retry.json as T
    }
    if (!res.ok) {
      throw httpErrorOf(res, op)
    }
    return res.json as T
  }

  private async rawFetch(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<{ ok: boolean; status: number; statusText: string; json: unknown; bodyText: string }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.requestTimeoutMs)
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json'
      }
      if (this.token) headers.Authorization = `Bearer ${this.token}`
      if (method === 'POST') headers['Content-Type'] = 'application/json'
      const init: RequestInit = {
        method,
        headers,
        signal: ctrl.signal
      }
      if (method === 'POST') init.body = JSON.stringify(body ?? {})
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, init)
      const text = await res.text()
      let json: unknown = null
      if (text.length > 0) {
        try {
          json = JSON.parse(text)
        } catch {
          /* leave as null; bodyText preserved for diagnostics */
        }
      }
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        json,
        bodyText: text
      }
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err)
      throw new AutomationHttpError(
        'API_UNREACHABLE',
        0,
        `automation request failed: ${cause}`
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function httpErrorOf(
  res: { status: number; statusText: string; bodyText: string },
  op: string
): AutomationHttpError {
  if (res.status === 401 || res.status === 403) {
    return new AutomationHttpError(
      'AUTH_FAILED',
      res.status,
      `automation ${op} unauthorized`,
      res.bodyText
    )
  }
  if (res.status === 0) {
    return new AutomationHttpError(
      'API_UNREACHABLE',
      res.status,
      `automation ${op} unreachable`,
      res.bodyText
    )
  }
  return new AutomationHttpError(
    'UNKNOWN',
    res.status,
    `automation ${op} failed: ${res.status} ${res.statusText}`,
    res.bodyText
  )
}
