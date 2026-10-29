import { defineConfig } from 'vitest/config';

/** Integration tests against a real Postgres (DATABASE_URL_TEST, must end with _test); run serially. */
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
