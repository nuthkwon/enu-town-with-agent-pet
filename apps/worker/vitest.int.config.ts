import { defineConfig } from 'vitest/config';

/** Integration tests against DATABASE_URL_TEST; files share one database, so they run serially. */
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
