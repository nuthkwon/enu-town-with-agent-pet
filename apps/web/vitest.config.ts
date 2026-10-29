import path from 'node:path';
import { defineConfig } from 'vitest/config';

/** Unit tests only; integration tests (*.int.test.ts) need Postgres and run via vitest.int.config.ts. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['test/**/*.int.test.ts', '**/node_modules/**', '**/.next/**'],
  },
});
