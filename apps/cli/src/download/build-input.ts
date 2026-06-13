/**
 * Build a TaskInput for the `yt-dlp-forward` kind from raw argv. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §6.2 (ForwardedYtDlpTaskInput)
 *
 * Hosts run `YtDlpExecutor` whose `buildArgsFor` first checks
 * `input.rawArgs` and uses it verbatim when present. We pack:
 *
 *   - `rawArgs`: the unredacted argv (held in memory only by host adapter
 *     for the spawn; do NOT read this back from CLI side).
 *   - `options.sanitizedArgs`: the redacted argv used in envelopes / logs.
 *   - `options.commandPreview`: human-readable `yt-dlp <sanitizedArgs>`.
 *   - `options.outputHints`: best-effort parse of -o / --paths / `-o -`.
 *   - `options.source: 'cli'`.
 *
 * URL extraction is best-effort: yt-dlp accepts a URL anywhere in argv;
 * we use the last bare positional that looks like a URL so the Task row
 * has a meaningful `url`. The executor itself doesn't depend on this
 * field when `rawArgs` is set, so a wrong guess is non-fatal.
 */

import type { TaskInput, TaskKind } from '@vidbee/task-queue'

import type { Flags } from '../parser'
import { redactArgs } from '../parser/redact'

export interface BuildForwardedInputOptions {
  argv: readonly string[]
  flags: Flags
}

export interface BuildForwardedInputResult {
  input: TaskInput
  commandPreview: string
  redacted: boolean
}

const URL_REGEX = /^https?:\/\//i

export function buildForwardedInput(
  opts: BuildForwardedInputOptions
): BuildForwardedInputResult {
  const { args: sanitizedArgs, summary } = redactArgs(opts.argv)
  const url = guessUrl(opts.argv) ?? ''
  const outputHints = parseOutputHints(opts.argv)
  const commandPreview = formatCommand(sanitizedArgs)

  const kind: TaskKind = 'yt-dlp-forward'
  const input: TaskInput = {
    url,
    kind,
    rawArgs: [...opts.argv],
    options: {
      source: 'cli',
      sanitizedArgs,
      commandPreview,
      outputHints,
      vidbee: {
        wait: opts.flags.wait,
        ...(opts.flags.maxAttempts !== undefined && {
          maxAttempts: opts.flags.maxAttempts
        }),
        ...(opts.flags.priority && { priority: opts.flags.priority }),
        ...(opts.flags.groupKey !== undefined && { groupKey: opts.flags.groupKey })
      }
    }
  }
  return { input, commandPreview, redacted: summary.redacted }
}

function formatCommand(argv: readonly string[]): string {
  return ['yt-dlp', ...argv]
    .map((tok) => (needsShellQuote(tok) ? quote(tok) : tok))
    .join(' ')
}

function needsShellQuote(tok: string): boolean {
  return /[\s'"\\$`]/.test(tok)
}

function quote(tok: string): string {
  return `'${tok.replace(/'/g, "'\\''")}'`
}

function guessUrl(argv: readonly string[]): string | null {
  // yt-dlp lets URLs appear at any position — we walk argv and pick the
  // last bare positional that looks like an HTTP(S) URL. Bare = not the
  // value of a flag like `--cookies <path>`.
  let last: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (!tok || tok.startsWith('-')) continue
    const prev = argv[i - 1]
    if (prev !== undefined && prev.startsWith('-') && consumesValue(prev)) continue
    if (URL_REGEX.test(tok)) last = tok
  }
  return last
}

/**
 * The set of yt-dlp flags whose immediately-following positional is a
 * value, not a URL. We don't need to be exhaustive — false negatives only
 * mean a URL might be guessed wrong, which is recoverable (executor uses
 * rawArgs verbatim regardless).
 */
const VALUE_CONSUMING_FLAGS = new Set<string>([
  '-f',
  '--format',
  '-o',
  '--output',
  '--cookies',
  '--cookies-from-browser',
  '--proxy',
  '--user-agent',
  '--referer',
  '--sleep-interval',
  '-r',
  '--limit-rate',
  '--retries',
  '--fragment-retries',
  '--retry-sleep',
  '-N',
  '--concurrent-fragments',
  '--throttled-rate',
  '--add-headers',
  '--add-header',
  '--config-location',
  '--paths',
  '-P',
  '--ffmpeg-location',
  '--postprocessor-args',
  '--user-agent',
  '--print',
  '--username',
  '--password',
  '--video-password',
  '--ap-password',
  '--twofactor',
  '--audio-format',
  '--audio-quality',
  '--merge-output-format',
  '--remux-video',
  '--recode-video',
  '--container'
])

function consumesValue(flag: string): boolean {
  // Strip `=value` since `--foo=value` is one token and never consumes.
  if (flag.includes('=')) return false
  return VALUE_CONSUMING_FLAGS.has(flag)
}

function parseOutputHints(argv: readonly string[]): {
  outputTemplate?: string
  paths?: string[]
  stdoutMode?: boolean
} {
  let outputTemplate: string | undefined
  const paths: string[] = []
  let stdoutMode = false
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (tok === undefined) continue
    if (tok === '-o' || tok === '--output') {
      const v = argv[i + 1]
      if (v === '-') stdoutMode = true
      else if (v) outputTemplate = v
      continue
    }
    if (tok === '-o-' || tok === '-o=-' || tok === '--output=-') {
      stdoutMode = true
      continue
    }
    if (tok.startsWith('-o=')) {
      outputTemplate = tok.slice(3)
      continue
    }
    if (tok.startsWith('--output=')) {
      outputTemplate = tok.slice('--output='.length)
      continue
    }
    if (tok === '-P' || tok === '--paths') {
      const v = argv[i + 1]
      if (v) paths.push(v)
    }
  }
  const out: { outputTemplate?: string; paths?: string[]; stdoutMode?: boolean } = {}
  if (outputTemplate !== undefined) out.outputTemplate = outputTemplate
  if (paths.length > 0) out.paths = paths
  if (stdoutMode) out.stdoutMode = true
  return out
}
