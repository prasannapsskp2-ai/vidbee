/**
 * Sensitive-argument redaction. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §8.2
 *
 * `rawArgs` is held in memory only; before any envelope, persisted task
 * row, attempt log tail, or projection sees the argv it MUST go through
 * `redactArgs`. Same rules apply to URL query strings encountered in the
 * argv (query tokens are scrubbed in place).
 *
 * The function is intentionally conservative — when in doubt, redact.
 */

const REDACTED = '<redacted>'

/** Flags whose immediately-following value is sensitive in full. */
const VALUE_FLAGS_FULL = new Set<string>([
  '--username',
  '--password',
  '--video-password',
  '--ap-password',
  '--twofactor',
  '--ap-username'
])

/**
 * Header-shaped flags. Value form is `name:value`; if the header name is
 * one of the sensitive ones, only the value half is replaced.
 */
const HEADER_FLAGS = new Set<string>(['--add-headers', '--add-header'])
const SENSITIVE_HEADER_NAMES = new Set<string>([
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'x-token',
  'bearer',
  'x-auth',
  'x-auth-token',
  'proxy-authorization'
])

/** URL query parameters whose value should be scrubbed. */
const SENSITIVE_QUERY_KEYS = new Set<string>([
  'token',
  'access_token',
  'auth_token',
  'id_token',
  'signature',
  'sig',
  'policy',
  'key',
  'secret',
  'apikey',
  'api_key',
  'password',
  'pass',
  'pwd'
])

export interface RedactSummary {
  /** True when at least one substitution was performed. */
  redacted: boolean
}

export function redactArgs(
  args: readonly string[]
): { args: string[]; summary: RedactSummary } {
  const out: string[] = []
  let redacted = false

  for (let i = 0; i < args.length; i++) {
    const tok = args[i]
    if (tok === undefined) continue

    const eq = tok.indexOf('=')
    const head = eq === -1 ? tok : tok.slice(0, eq)
    const inline = eq === -1 ? null : tok.slice(eq + 1)

    if (VALUE_FLAGS_FULL.has(head)) {
      if (inline !== null) {
        out.push(`${head}=${REDACTED}`)
        redacted = true
      } else {
        out.push(head)
        if (i + 1 < args.length) {
          out.push(REDACTED)
          redacted = true
          i += 1
        }
      }
      continue
    }

    if (HEADER_FLAGS.has(head)) {
      const consumed = handleHeader(head, inline, args, i, out)
      if (consumed.redacted) redacted = true
      i += consumed.skip
      continue
    }

    // URL-shaped tokens — scrub query string
    if (looksLikeUrl(tok)) {
      const scrubbed = scrubUrl(tok)
      if (scrubbed.changed) redacted = true
      out.push(scrubbed.value)
      continue
    }

    out.push(tok)
  }

  return { args: out, summary: { redacted } }
}

/**
 * Best-effort scrub of free-form text (stdout / stderr tail). We only
 * scrub things that have a structural shape — URL query strings and
 * `Authorization:` style header lines. A fancier regex pass risks false
 * positives in download progress output, so we keep it tight.
 */
export function redactText(text: string): string {
  let out = text
  out = out.replace(/(authorization|cookie|x-auth-token|bearer)\s*:\s*[^\n\r]+/gi, (m, name) => {
    return `${name}: ${REDACTED}`
  })
  out = out.replace(/\bhttps?:\/\/[^\s'"]+/g, (url) => scrubUrl(url).value)
  return out
}

function handleHeader(
  head: string,
  inline: string | null,
  args: readonly string[],
  i: number,
  out: string[]
): { skip: number; redacted: boolean } {
  let value: string | null
  let skip = 0
  if (inline !== null) {
    value = inline
  } else if (i + 1 < args.length) {
    value = args[i + 1] ?? null
    skip = 1
  } else {
    out.push(head)
    return { skip: 0, redacted: false }
  }
  if (value === null) {
    out.push(head)
    return { skip: 0, redacted: false }
  }
  const colon = value.indexOf(':')
  if (colon === -1) {
    if (inline !== null) out.push(`${head}=${value}`)
    else {
      out.push(head)
      out.push(value)
    }
    return { skip, redacted: false }
  }
  const name = value.slice(0, colon).trim().toLowerCase()
  const rendered = SENSITIVE_HEADER_NAMES.has(name)
    ? `${value.slice(0, colon)}: ${REDACTED}`
    : value
  const changed = rendered !== value
  if (inline !== null) out.push(`${head}=${rendered}`)
  else {
    out.push(head)
    out.push(rendered)
  }
  return { skip, redacted: changed }
}

function looksLikeUrl(tok: string): boolean {
  return /^https?:\/\//i.test(tok)
}

function scrubUrl(raw: string): { value: string; changed: boolean } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { value: raw, changed: false }
  }
  let changed = false
  for (const key of Array.from(url.searchParams.keys())) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.set(key, REDACTED)
      changed = true
    }
  }
  // Preserve the original token byte-for-byte when nothing was redacted —
  // `new URL().toString()` normalizes the form (e.g. adds a trailing /,
  // re-encodes punycode), and that normalization is undesirable for argv
  // we're going to log or echo back to the user.
  return { value: changed ? url.toString() : raw, changed }
}

export const REDACTED_PLACEHOLDER = REDACTED
