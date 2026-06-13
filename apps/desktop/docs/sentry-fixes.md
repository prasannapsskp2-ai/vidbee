# Sentry / GlitchTip Fix Log

This log records remediation work on Sentry / GlitchTip issues for the
`vidbee` project (`org=nex`, `host=error.102417.xyz`,
`release=vidbee-desktop@<version>`).

Each entry captures: root cause, fix summary, files touched, validation
output, current GlitchTip status, and any follow-ups.

## 2026-05-01 — VidBee Desktop quad-issue sweep (NEX-60)

Validation common to all four entries below:

- `pnpm run typecheck` — pass
- `pnpm run check` (`ultracite check && check:i18n && typecheck`) — pass
- `pnpm run build` — pass

The local repo has no `sentry-cli` credentials configured, and the project
description allows skipping the `resolved` step in that case. None of the
four GlitchTip issues were marked resolved from this branch; the next
release of `vidbee-desktop@1.3.11` (or the version that includes these
commits) is the right point for the maintainer to flip them to resolved.

### VIDBEE-6SV — `RangeError: Invalid string length` in main-process Socket

- Sentry: <https://error.102417.xyz/vidbee/issues/7849>
- Level: fatal · events: 4319 · last seen: 2026-04-27 (release 1.3.10, Windows)
- Root cause: yt-dlp / ffmpeg child-process stdout/stderr was being
  accumulated into a single JavaScript string for the lifetime of the
  process. On long downloads, large playlists, or verbose runs the string
  exceeded V8's ~512 MB limit and threw `RangeError: Invalid string length`.
  Five distinct sites had this pattern; the dominant one was
  `executeDownload`'s `ytDlpLog` (live for the entire download), which
  matches the 4 319 fatal-event volume.
- Fix: introduced `createBoundedTextBuffer` (8 MB cap, single-shot truncation
  notice) in `src/main/lib/bounded-output-buffer.ts` and rewired all yt-dlp
  / ffmpeg readers to use it.
- Files:
  - `src/main/lib/bounded-output-buffer.ts` (new)
  - `src/main/lib/download-engine.ts` (`getVideoInfo`,
    `getVideoInfoWithCommand`, `getPlaylistInfo`, `executeDownload`)
  - `src/main/lib/watermark-utils.ts` (`runFfmpeg`)
- GlitchTip status: **unresolved** (no auth token locally)
- Follow-up: confirm by tail-watching `error.102417.xyz/vidbee/issues/7849`
  for new events on the next release. Resolve once a stable run shows zero
  new fatal `RangeError: Invalid string length` events for ≥ 7 days.

### VIDBEE-68 — yt-dlp `Postprocessing` / generic `createError` noise

- Sentry: <https://error.102417.xyz/vidbee/issues/305>
- Level: error · events: 1 325 (group 68 alone) · last seen: 2026-04-30
- Root cause: every yt-dlp child-process error funnelled through
  `YTDlpWrap.createError`, then `download-engine` re-emitted it as a
  `download-error` and `index.ts` captured it to GlitchTip with
  `fingerprint = ['download-error', error.name, error.message]`. The raw
  stderr blob in `error.message` made fingerprints unstable, scattered
  groupings (E / DE / 1G / 6I / 2 / 6FN / 2A …), and buried the small
  number of genuine VidBee defects under upstream / user-side noise.
- Fix: added `classifyDownloadError` (in
  `src/shared/telemetry/yt-dlp-error-classifier.ts`) that maps an error to
  one of `postprocessing | http-error | unsupported-url | access-denied |
  unavailable | rate-limit | network | auth-required | drm-protected |
  no-format | cookies-required | environment | cancelled | unknown`. The
  `download-error` listener in `src/main/index.ts` now skips
  `captureMainException` only when the matched rule is marked operational,
  and tags captured events with `download_error_category` so future grouping
  is stable.
- Follow-up filter audit (NEX-114): generic HTTP failures, generic
  postprocessing failures, extractor/parser failures, broad TLS timeout
  strings, bare Windows error codes, and bare `AggregateError` subscription
  failures were made reportable again. The operational list now keeps only
  narrower user-state, source-availability, and environment cases quiet, while
  still preserving category tags for the reportable cases.
- Files:
  - `src/shared/telemetry/yt-dlp-error-classifier.ts` (new)
  - `src/main/index.ts` (`download-error` listener)
- GlitchTip status: **unresolved**
- Follow-up: monitor for ≥ 1 week on a release that ships this change. If
  the `unknown` bucket is small and stable we can resolve VIDBEE-68 and the
  E/DE/1G/6I/2/6FN/2A siblings. If a new operational pattern appears,
  extend `CATEGORY_RULES` rather than re-listing it in
  `issue-filter.ts` (the classifier is the source of truth now).

### VIDBEE-16 — `DrizzleError: ALTER TABLE add yt_dlp_command`

- Sentry: <https://error.102417.xyz/vidbee/issues/67>
- Level: error · events: 156 · last seen: 2026-04-19 (release 1.3.7, Windows)
- Root cause: legacy 1.3.x desktops applied the `yt_dlp_command` column via
  a raw `ALTER TABLE` on an older release; their `__drizzle_migrations`
  table no longer matched the journal hash, so re-running the migration
  threw `SqliteError: duplicate column name: yt_dlp_command` on startup.
  `reconcileLegacyMigrationState` was already added in 1.3.8 but doesn't
  cover every drift case.
- Fix: in `src/main/lib/database/migrate.ts` added
  `matchDuplicateColumnError` and `findLegacyMigrationForColumn`. When
  `migrate()` throws a duplicate-column error we look up which legacy
  migration adds that column, backfill its hash into
  `__drizzle_migrations`, and retry once. SQLite has no
  `ADD COLUMN IF NOT EXISTS`, so this self-heal pattern is preferred over
  rewriting the journal.
- Files:
  - `src/main/lib/database/migrate.ts`
- GlitchTip status: **unresolved**
- Follow-up: the original error was already trending down post-1.3.8. With
  the duplicate-column retry we expect it to drop to zero on the next
  release. Mark resolved when no events are seen for ≥ 14 days.

### VIDBEE-H8 — `Renderer process became unresponsive`

- Sentry: <https://error.102417.xyz/vidbee/issues/712>
- Level: warning · events: 108 · last seen: 2026-04-29 (release 1.3.10, Windows)
- Root cause: Electron's `unresponsive` event has no JS stack, so previous
  reports were unactionable. The task description explicitly accepts
  diagnostic-only work for this one.
- Fix:
  - Main process (`src/main/index.ts`): only capture `unresponsive` after a
    sustained 5 s freeze (Electron emits transient hangs too). Record the
    measured `unresponsive_ms` on both the captured warning and on the
    `responsive` recovery message, so a 6 s blip and a 60 s lockup can be
    told apart in GlitchTip.
  - Renderer (`src/renderer/src/main.tsx`): install a
    `PerformanceObserver({ entryTypes: ['longtask'] })` that adds a
    `performance` breadcrumb (with duration / startTime) for every
    synchronous task ≥ 200 ms. Breadcrumbs ride along on the next captured
    event, which gives us a localized hint on what was blocking the main
    thread when the freeze started.
- Files:
  - `src/main/index.ts` (`setupRendererErrorHandling`)
  - `src/renderer/src/main.tsx` (`setupLongTaskObserver`)
- GlitchTip status: **unresolved (diagnostic-only)** — by design. We
  intentionally did not attempt a code fix because we don't yet know which
  workload causes the freeze.
- Follow-up: once the diagnostic data lands in GlitchTip on the next
  release, group VIDBEE-H8 events by the new `unresponsive_ms` and
  long-task breadcrumb names to identify the worst offenders. Open
  follow-up tickets for the specific code paths instead of trying to
  resolve VIDBEE-H8 directly.
