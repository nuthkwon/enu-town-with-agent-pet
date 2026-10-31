import { defineConfig } from 'vitest/config';

// Rendering every effect (and the short-palette and determinism passes) takes a few seconds each.
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000 } });
