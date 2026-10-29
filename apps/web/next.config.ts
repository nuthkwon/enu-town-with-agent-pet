import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * ENU Den web (Next 16, App Router). The per-request CSP (with a script nonce) is set in
 * src/proxy.ts; the static security headers below apply to every response, API routes included.
 */
const isProd = process.env.NODE_ENV === 'production';
const repoRoot = path.join(import.meta.dirname, '../..');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Same effect as CSP frame-ancestors 'none' for responses the proxy does not touch (API, assets).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Internal packages export TypeScript source.
  transpilePackages: [
    '@enu/auth',
    '@enu/db',
    '@enu/domain',
    '@enu/map',
    '@enu/mcp-tools',
    '@enu/protocol',
    '@enu/shared',
    '@enu/sprites',
  ],
  poweredByHeader: false,
  typedRoutes: false,
  reactStrictMode: true,
  // The repository's CLAUDE.md is the agent guide; do not let `next dev` write apps/web/AGENTS.md.
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
