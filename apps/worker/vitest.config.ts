import { defineConfig } from 'vitest/config';

/** Unit tests only; integration tests (*.int.test.ts) need Postgres and run via vitest.int.config.ts. */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.int.test.ts', '**/node_modules/**', '**/dist/**'],
  },
});
