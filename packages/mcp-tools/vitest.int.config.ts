import { defineConfig } from 'vitest/config';

/** Integration tests against the real Postgres test database (DATABASE_URL_TEST); run serially. */
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
