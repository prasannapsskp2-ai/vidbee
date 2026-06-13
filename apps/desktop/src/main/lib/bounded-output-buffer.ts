// Sentry issue VIDBEE-6SV showed the desktop main process crashing with
// `RangeError: Invalid string length` when yt-dlp / ffmpeg child processes
// produced more than V8's ~512MB string limit on stdout/stderr. The wrappers
// below bound the accumulated output so the process can keep running.

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const TRUNCATION_NOTICE = '\n[VidBee] Output truncated to keep memory usage bounded.\n'

export interface BoundedTextBuffer {
  append(chunk: string | Buffer | undefined | null): void
  get(): string
  isTruncated(): boolean
}

export const createBoundedTextBuffer = (
  maxBytes: number = DEFAULT_MAX_BYTES
): BoundedTextBuffer => {
  let value = ''
  let truncated = false

  return {
    append(chunk: string | Buffer | undefined | null): void {
      if (!chunk) {
        return
      }
      const text = typeof chunk === 'string' ? chunk : chunk.toString()
      if (!text) {
        return
      }

      if (value.length >= maxBytes) {
        if (!truncated) {
          value += TRUNCATION_NOTICE
          truncated = true
        }
        return
      }

      const remaining = maxBytes - value.length
      if (text.length > remaining) {
        value += text.slice(0, remaining)
        value += TRUNCATION_NOTICE
        truncated = true
        return
      }

      value += text
    },
    get(): string {
      return value
    },
    isTruncated(): boolean {
      return truncated
    }
  }
}
