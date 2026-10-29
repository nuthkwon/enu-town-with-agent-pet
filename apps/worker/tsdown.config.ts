import { defineConfig } from 'tsdown';

/**
 * Bundles the worker entries to dist/*.mjs for Node 24. Workspace packages (@enu/*, shipped as
 * TS source) and their small npm deps (zod, uuid — not resolvable from apps/worker under pnpm)
 * are inlined; the worker's own runtime deps stay external and come from its node_modules.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    migrate: 'src/migrate.ts',
    healthcheck: 'src/healthcheck.ts',
    'seed-seats': 'src/seed-seats.ts',
  },
  platform: 'node',
  target: 'node24',
  format: 'esm',
  fixedExtension: true,
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: true,
  deps: {
    neverBundle: ['pg', 'pg-boss', 'pino', /^drizzle-orm(\/.*)?$/],
    alwaysBundle: [/^@enu\//],
    onlyBundle: ['zod', 'uuid'],
    onlyImport: ['pg', 'pg-boss', 'pino', 'drizzle-orm'],
  },
});
