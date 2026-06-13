/**
 * CLI entrypoint. Wires `process.argv` into the testable `run()` function.
 * The shebang for the bundled output is added by `scripts/build.mjs`'s
 * esbuild banner; we don't need one in source.
 *
 * Phase A: argv slice [2:], stdout / stderr passthrough, exit with run()'s
 * computed code. The yt-dlp spawn path and the `--vidbee-local`
 * production wiring (constructing TaskQueueAPI + YtDlpExecutor) land in
 * Phase B once NEX-131 has merged A1 or A2.
 */

import { run } from './runtime'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const { exitCode } = await run(argv, {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`)
  })
  process.exit(exitCode)
}

main().catch((err) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : String(err) })}\n`
  )
  process.exit(2)
})
