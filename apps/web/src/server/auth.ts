import { createAuth, mcpResourceUrl, type Auth, type DomainPolicy } from '@enu/auth';
import { nextCookies } from 'better-auth/next-js';
import { getDb } from './db';
import { getEnv, publicUrl } from './env';

/**
 * The Better Auth instance (Google sign-in + MCP OAuth authorization server), created lazily
 * on first use and cached per process. nextCookies() must stay the LAST plugin so cookies set
 * by auth.api calls inside server actions reach the browser.
 */
const g = globalThis as unknown as { __enuWebAuth?: Auth };

export function authPolicy(): DomainPolicy {
  const env = getEnv();
  return { allowedHd: env.ALLOWED_GOOGLE_HD, allowedEmails: env.ALLOWED_EMAILS.map((e) => e.toLowerCase()) };
}

export function getAuth(): Auth {
  if (g.__enuWebAuth) return g.__enuWebAuth;
  const env = getEnv();
  g.__enuWebAuth = createAuth({
    db: getDb(),
    publicUrl: publicUrl(),
    secret: env.BETTER_AUTH_SECRET,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : null,
    policy: authPolicy(),
    adminEmails: env.ADMIN_EMAILS,
    cimdAllowedHosts: env.CIMD_ALLOWED_HOSTS,
    allowDcr: env.MCP_ALLOW_DCR,
    accessTokenTtlSeconds: env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: env.OAUTH_REFRESH_TOKEN_TTL_DAYS,
    devLogin: env.DEV_LOGIN_ENABLED && env.NODE_ENV !== 'production',
    extraPlugins: [nextCookies()],
  });
  return g.__enuWebAuth;
}

/** The MCP resource identifier (token audience), e.g. https://town.enu-tech.co.kr/api/mcp */
export function mcpResource(): string {
  return mcpResourceUrl(publicUrl());
}

export function isAdminEmail(email: string): boolean {
  const e = email.toLowerCase();
  return getEnv().ADMIN_EMAILS.some((a) => a.toLowerCase() === e);
}

export function devLoginEnabled(): boolean {
  const env = getEnv();
  return env.DEV_LOGIN_ENABLED && env.NODE_ENV !== 'production';
}

/** Test hook: drop the cached instance (after env changes). */
export function resetAuthCache(): void {
  g.__enuWebAuth = undefined;
}
