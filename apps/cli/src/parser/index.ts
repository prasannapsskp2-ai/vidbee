/**
 * The CLI's only argv splitter. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §4.1, §4.2, §4.5
 *
 * Rules:
 *   - Tokens matching a known `--vidbee-*` flag are consumed (along with
 *     their value when `kind === 'value'`).
 *   - Tokens that look like `--vidbee-*` / `--vidbee:*` but are NOT in the
 *     reserved table cause an error with exit code 2 — never silently
 *     passed through to yt-dlp.
 *   - The first positional token starting with `:` selects a VidBee
 *     subcommand; subsequent positional tokens after a subcommand are the
 *     subcommand's own args (NOT yt-dlp args).
 *   - Everything else is order-preserved and handed to yt-dlp.
 *   - `--` is honored: every token after `--` is yt-dlp passthrough,
 *     including ones that would otherwise look like VidBee flags.
 */

import { findProbeFlag } from './probe-flags'
import {
  findReservedFlag,
  isVidbeePrefixed,
  type ReservedFlag
} from './reserved-flags'

export interface VidbeeFlags {
  api?: string
  local: boolean
  target?: 'desktop' | 'api' | 'local'
  json: boolean
  pretty: boolean
  wait: boolean
  detach: boolean
  priority?: 'user' | 'subscription' | 'background'
  maxAttempts?: number
  noRetry: boolean
  groupKey?: string
  timeoutMs?: number
  noAutostart: boolean
  token?: string
}

export type ParsedArgv =
  | { kind: 'subcommand'; flags: VidbeeFlags; subcommand: string; subArgs: readonly string[] }
  | {
      kind: 'ytdlp'
      flags: VidbeeFlags
      mode: 'probe' | 'download'
      ytArgs: readonly string[]
      probeFlag: string | null
    }

export class ParseError extends Error {
  readonly exitCode: 2
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.exitCode = 2
  }
}

const PRIORITY_VALUES = new Set<VidbeeFlags['priority']>([
  'user',
  'subscription',
  'background'
])
const TARGET_VALUES = new Set<VidbeeFlags['target']>(['desktop', 'api', 'local'])

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const flags = defaultFlags()
  const yt: string[] = []
  let subcommand: string | null = null
  let passthroughOnly = false

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === undefined) continue

    if (passthroughOnly) {
      yt.push(tok)
      continue
    }

    if (tok === '--') {
      passthroughOnly = true
      yt.push(tok)
      continue
    }

    // Subcommand: a `:` positional collects all remaining argv as its args.
    // We do not try to mix subcommand args with yt-dlp args.
    if (subcommand === null && tok.startsWith(':') && tok.length > 1) {
      subcommand = tok.slice(1)
      const subArgs = argv.slice(i + 1).filter((s): s is string => typeof s === 'string')
      // We still need to honor --vidbee-* in the subcommand tail (e.g.
      // `vidbee --vidbee-pretty :download list`); those have already been
      // consumed by earlier iterations. Anything inside subArgs is owned by
      // the subcommand handler — no further parsing here.
      return { kind: 'subcommand', flags, subcommand, subArgs }
    }

    // VidBee-prefixed flags: must match the reserved table or we fail loud.
    if (isVidbeePrefixed(tok)) {
      const eq = tok.indexOf('=')
      const name = eq === -1 ? tok : tok.slice(0, eq)
      const inlineValue = eq === -1 ? null : tok.slice(eq + 1)
      const def = findReservedFlag(name)
      if (!def) {
        throw new ParseError(
          'UNKNOWN_VIDBEE_FLAG',
          `unknown VidBee flag: ${name}`
        )
      }
      const consumed = consumeReserved(flags, def, argv, i, inlineValue)
      i += consumed
      continue
    }

    // Anything else is yt-dlp territory.
    yt.push(tok)
  }

  if (subcommand !== null) {
    return { kind: 'subcommand', flags, subcommand, subArgs: [] }
  }

  // §4.5: -o - in non-probe modes is rejected up front. We don't pretend to
  // understand more of -o than that single edge case.
  const probeFlag = findProbeFlag(yt)
  const mode: 'probe' | 'download' = probeFlag === null ? 'download' : 'probe'
  if (mode === 'download' && hasStdoutOutput(yt)) {
    throw new ParseError(
      'STDOUT_OUTPUT_DISALLOWED',
      '-o - is only allowed in probe mode'
    )
  }

  return { kind: 'ytdlp', flags, mode, ytArgs: yt, probeFlag }
}

function defaultFlags(): VidbeeFlags {
  return {
    local: false,
    json: true,
    pretty: false,
    wait: false,
    detach: false,
    noRetry: false,
    noAutostart: false
  }
}

function consumeReserved(
  flags: VidbeeFlags,
  def: ReservedFlag,
  argv: readonly string[],
  i: number,
  inlineValue: string | null
): number {
  if (def.kind === 'switch') {
    if (inlineValue !== null) {
      throw new ParseError(
        'UNEXPECTED_VALUE',
        `${def.name} does not take a value`
      )
    }
    applySwitch(flags, def.name)
    return 0
  }
  // value flag
  let value: string
  let consumed = 0
  if (inlineValue !== null) {
    value = inlineValue
  } else {
    const next = argv[i + 1]
    if (next === undefined) {
      throw new ParseError('MISSING_VALUE', `${def.name} requires a value`)
    }
    value = next
    consumed = 1
  }
  applyValue(flags, def.name, value)
  return consumed
}

function applySwitch(flags: VidbeeFlags, name: string): void {
  switch (name) {
    case '--vidbee-local':
      flags.local = true
      break
    case '--vidbee-json':
      flags.json = true
      break
    case '--vidbee-pretty':
      flags.pretty = true
      break
    case '--vidbee-wait':
      flags.wait = true
      break
    case '--vidbee-detach':
      flags.detach = true
      break
    case '--vidbee-no-retry':
      flags.noRetry = true
      flags.maxAttempts = 0
      break
    case '--vidbee-no-autostart':
      flags.noAutostart = true
      break
    default:
      throw new ParseError(
        'UNKNOWN_VIDBEE_FLAG',
        `unknown VidBee switch: ${name}`
      )
  }
}

function applyValue(flags: VidbeeFlags, name: string, value: string): void {
  switch (name) {
    case '--vidbee-api':
      flags.api = value
      break
    case '--vidbee-target':
      if (!(TARGET_VALUES as Set<string>).has(value)) {
        throw new ParseError(
          'INVALID_TARGET',
          `--vidbee-target must be one of desktop|api|local; got ${value}`
        )
      }
      flags.target = value as VidbeeFlags['target']
      break
    case '--vidbee-priority':
      if (!(PRIORITY_VALUES as Set<string>).has(value)) {
        throw new ParseError(
          'INVALID_PRIORITY',
          `--vidbee-priority must be user|subscription|background; got ${value}`
        )
      }
      flags.priority = value as VidbeeFlags['priority']
      break
    case '--vidbee-max-attempts': {
      const n = Number.parseInt(value, 10)
      if (!Number.isFinite(n) || n < 0 || `${n}` !== value) {
        throw new ParseError(
          'INVALID_MAX_ATTEMPTS',
          `--vidbee-max-attempts must be a non-negative integer; got ${value}`
        )
      }
      flags.maxAttempts = n
      if (n === 0) flags.noRetry = true
      break
    }
    case '--vidbee-group-key':
      flags.groupKey = value
      break
    case '--vidbee-timeout': {
      const n = Number.parseInt(value, 10)
      if (!Number.isFinite(n) || n <= 0) {
        throw new ParseError(
          'INVALID_TIMEOUT',
          `--vidbee-timeout must be a positive integer (ms); got ${value}`
        )
      }
      flags.timeoutMs = n
      break
    }
    case '--vidbee-token':
      flags.token = value
      break
    default:
      throw new ParseError(
        'UNKNOWN_VIDBEE_FLAG',
        `unknown VidBee value flag: ${name}`
      )
  }
}

/**
 * §4.5: writing yt-dlp output to stdout (`-o -`) is only legal in probe
 * mode. We detect it by `-o`-followed-by-`-` or `-o-`/`--output -`.
 */
function hasStdoutOutput(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === '-o' || tok === '--output') {
      if (argv[i + 1] === '-') return true
    } else if (tok === '-o-' || tok === '--output=-' || tok === '-o=-') {
      return true
    }
  }
  return false
}

export type { VidbeeFlags as Flags }
