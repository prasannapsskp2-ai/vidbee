#!/usr/bin/env node
import('../index.mjs').catch((e) => {
  process.stderr.write(JSON.stringify({ ok: false, code: 'UNKNOWN_ERROR', message: String(e?.message ?? e) }) + '\n')
  process.exit(2)
})
