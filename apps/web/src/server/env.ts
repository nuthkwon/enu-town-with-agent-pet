import { loadEnv, webEnvSchema, type WebEnv } from '@enu/shared/env';

/**
 * Lazily parsed web environment. Never read at import time of route modules, so `next build`
 * works without secrets (set SKIP_ENV_VALIDATION=1 there: invalid env then falls back to
 * harmless placeholders instead of throwing).
 */
let cached: WebEnv | undefined;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/invalid',
  PUBLIC_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'build-placeholder-secret-not-for-runtime-use-0000',
  REALTIME_TICKET_SECRET: 'build-placeholder-secret-not-for-runtime-use-0000',
  REALTIME_PUBLIC_URL: 'ws://localhost:2567',
  DEV_LOGIN_ENABLED: '1',
};

export function getEnv(): WebEnv {
  if (cached) return cached;
  const skip = ['1', 'true'].includes((process.env.SKIP_ENV_VALIDATION ?? '').toLowerCase());
  if (skip) {
    const parsed = webEnvSchema.safeParse(process.env);
    if (parsed.success) {
      cached = parsed.data;
      return cached;
    }
    // Build-time only: never cached, so a real request with a fixed env still validates.
    console.warn('[enu-town] SKIP_ENV_VALIDATION=1 and env is invalid: using build placeholders');
    return loadEnv(webEnvSchema, { ...BUILD_PLACEHOLDERS, NODE_ENV: 'development' });
  }
  cached = loadEnv(webEnvSchema);
  return cached;
}

/** Public origin without trailing slash, e.g. https://town.enu-tech.co.kr */
export function publicUrl(): string {
  return getEnv().PUBLIC_URL.replace(/\/+$/, '');
}

/** Base URL this process can reach itself on (JWKS fetch for MCP token verification). */
export function internalBaseUrl(): string {
  const override = process.env.INTERNAL_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, '');
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

/** Test hook: forget the parsed env (tests mutate process.env between suites). */
export function resetEnvCache(): void {
  cached = undefined;
}
