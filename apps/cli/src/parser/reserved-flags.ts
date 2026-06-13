/**
 * The full set of `--vidbee-*` flags the CLI knows about. Reference:
 *   docs/vidbee-desktop-first-cli-ytdlp-rss-design.md §4.2
 *
 * `kind` controls how the parser splits argv:
 *   - 'switch'        — boolean; presence sets value true
 *   - 'value'         — consumes the next argv token, OR accepts `--flag=value`
 *
 * Any unknown `--vidbee-*` token causes the parser to reject argv with
 * exit 2; we never silently forward unrecognized vidbee flags to yt-dlp.
 */

export type ReservedFlagKind = 'switch' | 'value'

export interface ReservedFlag {
  name: string
  kind: ReservedFlagKind
}

export const RESERVED_FLAGS: readonly ReservedFlag[] = [
  { name: '--vidbee-api', kind: 'value' },
  { name: '--vidbee-local', kind: 'switch' },
  { name: '--vidbee-target', kind: 'value' },
  { name: '--vidbee-json', kind: 'switch' },
  { name: '--vidbee-pretty', kind: 'switch' },
  { name: '--vidbee-wait', kind: 'switch' },
  { name: '--vidbee-detach', kind: 'switch' },
  { name: '--vidbee-priority', kind: 'value' },
  { name: '--vidbee-max-attempts', kind: 'value' },
  { name: '--vidbee-no-retry', kind: 'switch' },
  { name: '--vidbee-group-key', kind: 'value' },
  { name: '--vidbee-timeout', kind: 'value' },
  { name: '--vidbee-no-autostart', kind: 'switch' },
  { name: '--vidbee-token', kind: 'value' }
]

const RESERVED_BY_NAME = new Map<string, ReservedFlag>(
  RESERVED_FLAGS.map((f) => [f.name, f])
)

export function findReservedFlag(name: string): ReservedFlag | undefined {
  return RESERVED_BY_NAME.get(name)
}

/**
 * True if `tok` looks like a VidBee flag. We deliberately match the loose
 * prefix `--vidb` (which has no overlap with any yt-dlp option as of
 * yt-dlp 2024.x — `--video-*` does not start with `--vidb`) so that typos
 * like `--vidbe-wait` are caught and reported instead of being silently
 * forwarded to yt-dlp. Reference: design doc §4.5 edge-case table.
 *
 * The strict membership check (against RESERVED_FLAGS) happens on the
 * canonical `--vidbee-*` / `--vidbee:*` form; anything else with the
 * `--vidb` prefix is rejected as an unknown VidBee flag.
 */
export function isVidbeePrefixed(tok: string): boolean {
  return tok.startsWith('--vidb')
}
