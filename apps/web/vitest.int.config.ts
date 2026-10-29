import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests: route handlers called in-process against a real Postgres
 * (DATABASE_URL_TEST, must end with _test). Files share one database, so they run serially.
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['test/int-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
