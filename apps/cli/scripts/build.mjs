#!/usr/bin/env node
/**
 * Bundles the CLI as a single ESM file (`dist/index.mjs`) plus the
 * npm-bin shim (`dist/bin/vidbee.mjs`).
 *
 * The published artifact is the standalone npm tarball — Desktop no
 * longer bundles the CLI (NEX-148). `--vidbee-local` requires the bundled
 * `@vidbee/task-queue` and `@vidbee/downloader-core`; the bundler inlines
 * them. `better-sqlite3` is left external so the npm consumer installs it
 * as an `optionalDependency` only when crash-recovery is wanted.
 */
import { build } from 'esbuild'
import { mkdirSync, chmodSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = join(root, 'dist')

// Wipe `dist/` on every build so a previous build's artifacts (e.g. the
// pre-NEX-148 `dist/shim/` directory) can never sneak into the published
// tarball.
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
mkdirSync(join(dist, 'bin'), { recursive: true })

await build({
  entryPoints: [join(root, 'src/bin.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: join(dist, 'index.mjs'),
  external: ['better-sqlite3', 'electron', 'yt-dlp-wrap-plus', '@opentelemetry/api'],
  legalComments: 'inline',
  banner: {
    js: '#!/usr/bin/env node\n// @vidbee/cli — standalone build (NEX-148). Built by scripts/build.mjs.'
  }
})

// npm bin shim: thin wrapper that runs the bundled index.mjs.
const npmBin = `#!/usr/bin/env node
import('../index.mjs').catch((e) => {
  process.stderr.write(JSON.stringify({ ok: false, code: 'UNKNOWN_ERROR', message: String(e?.message ?? e) }) + '\\n')
  process.exit(2)
})
`
const npmBinPath = join(dist, 'bin', 'vidbee.mjs')
mkdirSync(dirname(npmBinPath), { recursive: true })
const fs = await import('node:fs/promises')
await fs.writeFile(npmBinPath, npmBin, 'utf-8')
chmodSync(npmBinPath, 0o755)

console.log('built', dist)
