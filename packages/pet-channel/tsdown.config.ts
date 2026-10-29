import { defineConfig } from 'tsdown';

/**
 * Bundles the channel server into ONE committed file of the Claude plugin, which is installed from the
 * marketplace without node_modules: everything is inlined. Not minified, so the reviewed file is the shipped one.
 * The script is `bundle`, not `build`, so `turbo build` never rewrites the committed file; CI checks it is fresh.
 */
export default defineConfig({
  entry: { 'den-channel': 'src/main.ts' },
  platform: 'node',
  target: 'node20',
  format: 'esm',
  fixedExtension: true,
  outDir: '../../claude/plugins/enu-den-channel/server',
  clean: false,
  dts: false,
  sourcemap: false,
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
  deps: {
    alwaysBundle: [/.*/],
    onlyBundle: ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod'],
  },
});
