import { defineConfig } from 'tsdown';

/**
 * Bundles the realtime server to dist/index.mjs for Node 24. Workspace packages (@enu/*, shipped as
 * TS source) and their small npm deps (zod, uuid — not resolvable from apps/realtime under pnpm)
 * are inlined; Colyseus, pg, drizzle, jose and pino stay external (one copy, from node_modules).
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  platform: 'node',
  target: 'node24',
  format: 'esm',
  fixedExtension: true,
  outDir: 'dist',
  clean: true,
  dts: false,
  sourcemap: true,
  deps: {
    neverBundle: [/^@colyseus\//, 'express', 'pg', 'pino', 'jose', /^drizzle-orm(\/.*)?$/],
    alwaysBundle: [/^@enu\//],
    onlyBundle: ['zod', 'uuid'],
    onlyImport: [
      '@colyseus/core',
      '@colyseus/schema',
      '@colyseus/ws-transport',
      'pg',
      'pino',
      'jose',
      'drizzle-orm',
    ],
  },
});
