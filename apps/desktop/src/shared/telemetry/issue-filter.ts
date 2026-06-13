import { classifyDownloadMessages } from './yt-dlp-error-classifier'

const GLOBAL_OPERATIONAL_PATTERNS = [
  'ffmpeg not initialized. call initialize() first.',
  'manual download feedback submitted'
]

const SUBSCRIPTION_OPERATIONAL_PATTERNS = [
  'status code 404',
  'status code 500',
  'status code 502',
  'status code 503',
  'request timed out after 60000ms',
  'request path contains unescaped characters',
  'attribute without value',
  'non-whitespace before first tag.',
  'unexpected close tag',
  'feed not recognized as rss 1 or 2.',
  'invalid character in entity name',
  'invalid character in tag name',
  'net::err_connection_reset',
  'net::err_timed_out',
  'net::err_name_not_resolved',
  // Sentry issues VIDBEE-61S / VIDBEE-5VB showed DNS lookup failures can
  // surface from subscription checks as bare Node getaddrinfo errors.
  'getaddrinfo enotfound',
  'net::err_proxy_connection_failed',
  'net::err_internet_disconnected',
  'client network socket disconnected before secure tls connection was established',
  'connect etimedout'
]

const AUTO_UPDATER_OPERATIONAL_PATTERNS = [
  'enoent: no such file or directory, rename',
  // Sentry issue VIDBEE-1S showed GitHub release asset requests can return
  // transient 502 Unicorn pages that are outside the desktop app control path.
  'httperror: 502',
  'net::err_connection_reset',
  'net::err_connection_closed',
  'net::err_connection_timed_out',
  'net::err_timed_out',
  'net::err_internet_disconnected',
  'net::err_proxy_connection_failed',
  'net::err_connection_refused',
  'net::err_network_io_suspended',
  'net::err_name_not_resolved',
  'net::err_http2_protocol_error',
  'net::err_network_changed',
  'net::err_connection_aborted',
  'net::err_ssl_protocol_error',
  'net::err_address_unreachable',
  'net::err_socket_not_connected',
  'net::err_cert_authority_invalid',
  'net::err_tunnel_connection_failed',
  'net::err_network_access_denied',
  // Sentry issue VIDBEE-48 can also surface as a bare Node DNS failure before
  // Electron normalizes it to net::ERR_NAME_NOT_RESOLVED.
  'getaddrinfo enotfound'
] as const

const AUTO_UPDATER_REQUEST_PATTERNS = [
  'github.com/nexmoe/vidbee/releases/latest/download/latest',
  'github.com/nexmoe/vidbee/releases/download/',
  'release-assets.githubusercontent.com/github-production-release-asset/'
] as const

// Sentry issues VIDBEE-31 / VIDBEE-1LV / VIDBEE-1N2 / VIDBEE-1N7 /
// VIDBEE-1N6 / VIDBEE-1N4 / VIDBEE-1N3 are upstream RSS transport failures and
// should be treated the same way as the existing subscription 4xx noise.

// Sentry issues VIDBEE-28B / VIDBEE-25A / VIDBEE-23B still surface generic
// provider-side 500 responses that should be handled like the existing 502/503
// subscription outages.

interface TelemetryContextShape {
  tags?: Record<string, boolean | number | string | undefined>
}

interface TelemetryEventTag {
  key?: string
  value?: unknown
}

interface TelemetryEventExceptionValue {
  type?: string
  value?: string
  stacktrace?: {
    frames?: TelemetryEventStackFrame[]
  }
}

interface TelemetryEventBreadcrumb {
  category?: string
  data?: Record<string, unknown>
}

interface TelemetryEventStackFrame {
  filename?: string
  function?: string
  module?: string
}

interface TelemetryEventEntry {
  type?: string
  data?: {
    values?: TelemetryEventBreadcrumb[]
  }
}

interface TelemetryEventShape {
  exception?: {
    values?: TelemetryEventExceptionValue[]
  }
  message?: string
  tags?: Record<string, unknown> | TelemetryEventTag[]
  entries?: TelemetryEventEntry[]
}

/**
 * Normalize telemetry text so pattern matching is stable across platforms.
 *
 * @param value The raw telemetry text.
 * @returns The normalized lowercase text.
 */
const normalizeTelemetryText = (value: string | undefined | null): string => {
  return value?.trim().toLowerCase() ?? ''
}

/**
 * Read the telemetry source tag from Sentry scope or event tags.
 *
 * @param tags The telemetry tags bag.
 * @returns The normalized source tag.
 */
const readSourceTag = (tags: Record<string, unknown> | TelemetryEventTag[] | undefined): string => {
  if (Array.isArray(tags)) {
    const sourceTag = tags.find((tag) => tag.key === 'source')
    return typeof sourceTag?.value === 'string' ? normalizeTelemetryText(sourceTag.value) : ''
  }

  const source = tags?.source
  return typeof source === 'string' ? normalizeTelemetryText(source) : ''
}

/**
 * Infer the updater source from serialized Electron network breadcrumbs.
 *
 * @param event The telemetry event candidate.
 * @returns The inferred source tag when the breadcrumbs match the updater path.
 */
const inferSourceFromBreadcrumbs = (event: TelemetryEventShape): string => {
  // Sentry issues VIDBEE-9 / VIDBEE-17 / VIDBEE-1H / VIDBEE-1O showed
  // updater transport failures can arrive without the explicit source tag.
  for (const entry of event.entries ?? []) {
    if (entry.type !== 'breadcrumbs') {
      continue
    }

    for (const breadcrumb of entry.data?.values ?? []) {
      if (breadcrumb.category !== 'electron.net') {
        continue
      }

      const url = breadcrumb.data?.url
      if (typeof url !== 'string') {
        continue
      }

      const normalizedUrl = normalizeTelemetryText(url)
      if (
        normalizedUrl.includes('github.com/nexmoe/vidbee/releases/') ||
        normalizedUrl.includes('objects.githubusercontent.com/github-production-release-asset-')
      ) {
        return 'auto-updater'
      }
    }
  }

  return ''
}

/**
 * Check whether any normalized message contains one of the known patterns.
 *
 * @param messages The normalized telemetry messages.
 * @param patterns The operational error patterns to match.
 * @returns True when a known pattern is present.
 */
const matchesAnyPattern = (messages: string[], patterns: readonly string[]): boolean => {
  return patterns.some((pattern) => messages.some((message) => message.includes(pattern)))
}

/**
 * Collect breadcrumb entries from a finalized telemetry event.
 *
 * @param event The telemetry event candidate.
 * @returns The flattened breadcrumb values.
 */
const collectBreadcrumbs = (
  event: TelemetryEventShape
): Array<{ category?: string; data?: Record<string, unknown> }> => {
  return (
    event.entries
      ?.filter((entry) => entry.type === 'breadcrumbs')
      .flatMap((entry) => entry.data?.values ?? []) ?? []
  )
}

/**
 * Check whether an event includes a known auto-updater request breadcrumb.
 *
 * @param event The telemetry event candidate.
 * @returns True when the event came from the updater request path.
 */
const hasAutoUpdaterRequestBreadcrumb = (event: TelemetryEventShape): boolean => {
  return collectBreadcrumbs(event).some((breadcrumb) => {
    if (breadcrumb.category !== 'electron.net') {
      return false
    }

    const url = breadcrumb.data?.url
    if (typeof url !== 'string') {
      return false
    }

    const normalizedUrl = normalizeTelemetryText(url)
    return AUTO_UPDATER_REQUEST_PATTERNS.some((pattern) => normalizedUrl.includes(pattern))
  })
}

/**
 * Check whether serialized event messages mention a known updater request URL.
 *
 * @param messages The normalized telemetry messages.
 * @returns True when the updater release URLs appear in the serialized payload.
 */
const hasAutoUpdaterRequestMessage = (messages: string[]): boolean => {
  return messages.some((message) =>
    AUTO_UPDATER_REQUEST_PATTERNS.some((pattern) => message.includes(pattern))
  )
}

/**
 * Build a list of normalized messages from an error object and optional plain message.
 *
 * @param error The error candidate captured by telemetry.
 * @param fallbackMessage An additional plain-text message to inspect.
 * @returns Normalized non-empty message fragments.
 */
const collectErrorMessages = (error: unknown, fallbackMessage?: string): string[] => {
  const messages = new Set<string>()

  if (typeof fallbackMessage === 'string') {
    const normalizedFallback = normalizeTelemetryText(fallbackMessage)
    if (normalizedFallback) {
      messages.add(normalizedFallback)
    }
  }

  if (error instanceof Error) {
    const normalizedName = normalizeTelemetryText(error.name)
    const normalizedMessage = normalizeTelemetryText(error.message)
    const normalizedStack = normalizeTelemetryText(error.stack)

    if (normalizedName) {
      messages.add(normalizedName)
    }
    if (normalizedMessage) {
      messages.add(normalizedMessage)
    }
    if (normalizedStack) {
      messages.add(normalizedStack)
    }
  } else if (typeof error === 'string') {
    const normalizedError = normalizeTelemetryText(error)
    if (normalizedError) {
      messages.add(normalizedError)
    }
  }

  return [...messages]
}

/**
 * Build a list of normalized messages from a telemetry event payload.
 *
 * @param event The telemetry event candidate.
 * @returns Normalized non-empty event message fragments.
 */
const collectEventMessages = (event: TelemetryEventShape): string[] => {
  const messages = new Set<string>()
  const normalizedMessage = normalizeTelemetryText(event.message)

  if (normalizedMessage) {
    messages.add(normalizedMessage)
  }

  for (const value of event.exception?.values ?? []) {
    const normalizedType = normalizeTelemetryText(value.type)
    const normalizedValue = normalizeTelemetryText(value.value)

    if (normalizedType) {
      messages.add(normalizedType)
    }
    if (normalizedValue) {
      messages.add(normalizedValue)
    }
    if (normalizedType && normalizedValue) {
      messages.add(`${normalizedType}: ${normalizedValue}`)
    }
  }

  return [...messages]
}

/**
 * Collect normalized stack-frame hints from serialized exception payloads.
 *
 * @param event The telemetry event candidate.
 * @returns Flattened normalized frame filename, function, and module text.
 */
const collectExceptionFrameHints = (event: TelemetryEventShape): string[] => {
  const hints = new Set<string>()

  for (const value of event.exception?.values ?? []) {
    for (const frame of value.stacktrace?.frames ?? []) {
      const normalizedFilename = normalizeTelemetryText(frame.filename)
      const normalizedFunction = normalizeTelemetryText(frame.function)
      const normalizedModule = normalizeTelemetryText(frame.module)

      if (normalizedFilename) {
        hints.add(normalizedFilename)
      }
      if (normalizedFunction) {
        hints.add(normalizedFunction)
      }
      if (normalizedModule) {
        hints.add(normalizedModule)
      }
      if (normalizedFilename && normalizedFunction) {
        hints.add(`${normalizedFilename} ${normalizedFunction}`)
      }
    }
  }

  return [...hints]
}

/**
 * Infer the telemetry source from serialized exception stack frames and messages.
 *
 * @param event The telemetry event candidate.
 * @param messages The normalized event messages.
 * @returns The inferred source tag.
 */
const inferSourceFromExceptionFrames = (event: TelemetryEventShape, messages: string[]): string => {
  const frameHints = collectExceptionFrameHints(event)

  // Sentry issues VIDBEE-23C / VIDBEE-6Q1 / VIDBEE-6QB showed serialized
  // yt-dlp errors can lose the explicit source tag even though the stack still
  // points at YTDlpWrap.createError.
  if (
    frameHints.some(
      (hint) =>
        hint.includes('yt-dlp-wrap-plus/dist/index.js') || hint.includes('ytdlpwrap.createerror')
    )
  ) {
    return 'download-engine'
  }

  // Sentry issues VIDBEE-6M0 / VIDBEE-6M1 / VIDBEE-6M2 / VIDBEE-6LV showed
  // RSS parser outages can also arrive without the serialized source tag.
  if (frameHints.some((hint) => hint.includes('rss-parser/lib/parser.js'))) {
    return 'subscription.check'
  }

  // Sentry issues VIDBEE-13C / VIDBEE-17 / VIDBEE-1H / VIDBEE-1S showed
  // updater transport failures can lose both the source tag and breadcrumb
  // URL, but still retain Electron loader frames or GitHub release URLs.
  if (
    frameHints.some(
      (hint) =>
        hint.includes('node:electron/js2c/browser_init') && hint.includes('simpleurlloaderwrapper')
    ) ||
    hasAutoUpdaterRequestMessage(messages)
  ) {
    return 'auto-updater'
  }

  return ''
}

/**
 * Resolve the best telemetry source from tags, breadcrumbs, or serialized exception hints.
 *
 * @param event The telemetry event candidate.
 * @param messages The normalized event messages.
 * @returns The normalized source tag.
 */
const resolveEventSource = (event: TelemetryEventShape, messages: string[]): string => {
  return (
    readSourceTag(event.tags) ||
    inferSourceFromBreadcrumbs(event) ||
    inferSourceFromExceptionFrames(event, messages)
  )
}

/**
 * Determine whether a telemetry payload is an expected operational issue.
 *
 * @param messages The normalized telemetry message fragments.
 * @param source The normalized telemetry source tag.
 * @returns True when the payload should be dropped from Sentry issue reporting.
 */
const isOperationalTelemetry = (messages: string[], source: string): boolean => {
  if (matchesAnyPattern(messages, GLOBAL_OPERATIONAL_PATTERNS)) {
    return true
  }

  if (
    source.startsWith('download') ||
    source === 'one-click-download' ||
    source === 'subscription.download'
  ) {
    return classifyDownloadMessages(messages).isOperational
  }

  if (source.startsWith('subscription')) {
    return matchesAnyPattern(messages, SUBSCRIPTION_OPERATIONAL_PATTERNS)
  }

  if (source.startsWith('auto-updater')) {
    return matchesAnyPattern(messages, AUTO_UPDATER_OPERATIONAL_PATTERNS)
  }

  return false
}

/**
 * Decide whether an exception should be skipped before sending it to Sentry.
 *
 * @param error The captured error candidate.
 * @param context The telemetry context carrying tags.
 * @param message The optional plain-text message being captured.
 * @returns True when the issue is expected and should not create a Sentry issue.
 */
export const shouldSkipTelemetryError = (
  error: unknown,
  context?: TelemetryContextShape,
  message?: string
): boolean => {
  const source = readSourceTag(context?.tags)
  const messages = collectErrorMessages(error, message)
  return isOperationalTelemetry(messages, source)
}

/**
 * Decide whether a finalized Sentry event should be dropped before transport.
 *
 * @param event The Sentry event payload.
 * @returns True when the event is expected operational noise.
 */
export const shouldDropTelemetryEvent = (event: TelemetryEventShape): boolean => {
  const messages = collectEventMessages(event)
  const source = resolveEventSource(event, messages)
  if (isOperationalTelemetry(messages, source)) {
    return true
  }

  // Sentry issues VIDBEE-7 and VIDBEE-9 showed ElectronNet can auto-capture
  // updater transport errors before our explicit `source` tag is attached.
  return (
    matchesAnyPattern(messages, AUTO_UPDATER_OPERATIONAL_PATTERNS) &&
    hasAutoUpdaterRequestBreadcrumb(event)
  )
}
