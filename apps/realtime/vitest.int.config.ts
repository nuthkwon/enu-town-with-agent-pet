import { defineConfig } from 'vitest/config';

/**
 * Integration tests: a real Colyseus server (@colyseus/testing, one port per file) against
 * DATABASE_URL_TEST. Files share one database and the matchmaker, so they run serially.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
