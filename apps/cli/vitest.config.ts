import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', '__integration__/**/*.test.ts'],
    testTimeout: 10_000
  }
})
