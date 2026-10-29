import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { mcp } from '@better-auth/mcp';
import { audit, newId, schema, type Db } from '@enu/db';
import { devLoginBody } from '@enu/shared';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { jwt } from 'better-auth/plugins';
import { checkEmailAllowed, checkGoogleProfile, type DomainPolicy } from './domain-guard';
import { provisionProfile, recordGoogleSub } from './provision';

export interface AuthConfig {
  db: Db;
  /** Public origin, e.g. https://town.enu-tech.co.kr (no trailing slash). */
  publicUrl: string;
  secret: string;
  google: { clientId: string; clientSecret: string } | null;
  policy: DomainPolicy;
  adminEmails: readonly string[];
  cimdAllowedHosts: readonly string[];
  allowDcr: boolean;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  /** Development-only email sign-in (never in production; enforced here and by env validation). */
  devLogin: boolean;
  /** Appended last (e.g. nextCookies() in the web app). */
  extraPlugins?: BetterAuthPlugin[];
}

export const AUTH_BASE_PATH = '/api/auth';

export function mcpResourceUrl(publicUrl: string): string {
  return `${publicUrl.replace(/\/$/, '')}/api/mcp`;
}

export function hostAllowed(url: string, allowed: readonly string[]): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== 'https:') return false;
    return allowed.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Development-only login: signs in an existing (or new, in-domain) user by email and resumes OAuth. */
function devLoginPlugin(cfg: AuthConfig) {
  return {
    id: 'enu-dev-login',
    endpoints: {
      enuDevLogin: createAuthEndpoint('/dev/login', { method: 'POST', body: devLoginBody }, async (ctx) => {
        if (!cfg.devLogin || process.env.NODE_ENV === 'production') throw new APIError('NOT_FOUND');
        const email = ctx.body.email.toLowerCase();
        const allowed = checkEmailAllowed(email, cfg.policy);
        if (!allowed.ok) throw new APIError('FORBIDDEN', { message: allowed.description });
        const found = await ctx.context.internalAdapter.findUserByEmail(email);
        const u =
          found?.user ??
          (await ctx.context.internalAdapter.createUser(
            { email, name: email.split('@')[0] ?? email, emailVerified: true },
            { method: 'dev-login' },
          ));
        const created = await ctx.context.internalAdapter.createSession(u.id);
        await setSessionCookie(ctx, { session: created, user: u });
        return ctx.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}

export function createAuth(cfg: AuthConfig) {
  const { db, policy } = cfg;
  const resource = mcpResourceUrl(cfg.publicUrl);
  const isAdminEmail = (email: string) =>
    cfg.adminEmails.map((e) => e.toLowerCase()).includes(email.toLowerCase());
  const isAdminUser = (u: { role?: unknown; email?: unknown } | undefined) =>
    !!u && (u.role === 'admin' || (typeof u.email === 'string' && isAdminEmail(u.email)));

  return betterAuth({
    appName: 'ENU Town',
    baseURL: cfg.publicUrl,
    basePath: AUTH_BASE_PATH,
    secret: cfg.secret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        jwks: schema.jwks,
        oauthClient: schema.oauthClient,
        oauthResource: schema.oauthResource,
        oauthClientResource: schema.oauthClientResource,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthAccessToken: schema.oauthAccessToken,
        oauthConsent: schema.oauthConsent,
        oauthClientAssertion: schema.oauthClientAssertion,
      },
    }),
    emailAndPassword: { enabled: false },
    socialProviders: cfg.google
      ? {
          google: {
            clientId: cfg.google.clientId,
            clientSecret: cfg.google.clientSecret,
            // Better Auth rejects ID tokens whose verified `hd` claim differs. Do NOT override getUserInfo.
            hd: policy.allowedHd,
            prompt: 'select_account',
            mapProfileToUser: (p) => ({ name: p.name, image: p.picture }),
          },
        }
      : {},
    account: { accountLinking: { enabled: false } },
    user: {
      additionalFields: {
        googleSub: { type: 'string', required: false, input: false },
        hd: { type: 'string', required: false, input: false },
        status: { type: 'string', required: false, input: false, defaultValue: 'active' },
        role: { type: 'string', required: false, input: false, defaultValue: 'member' },
        tokensRevokedAt: { type: 'date', required: false, input: false },
      },
      validateUserInfo: ({ user: info, source }) => {
        if (source.method === 'oauth') {
          if (source.oauth?.providerId !== 'google') return { error: 'provider_not_allowed' };
          const r = checkGoogleProfile(source.oauth.profile, policy);
          return r.ok ? undefined : { error: r.error, errorDescription: r.description };
        }
        if (source.method === 'dev-login' && cfg.devLogin && process.env.NODE_ENV !== 'production') {
          const r = checkEmailAllowed(typeof info.email === 'string' ? info.email : null, policy);
          return r.ok ? undefined : { error: r.error, errorDescription: r.description };
        }
        return { error: 'method_not_allowed', errorDescription: 'Google 계정으로만 로그인할 수 있습니다.' };
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    trustedOrigins: [cfg.publicUrl],
    disabledPaths: ['/token'],
    rateLimit: { enabled: true, window: 60, max: 120, storage: 'memory' },
    advanced: { database: { generateId: () => newId() } },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            const r = checkEmailAllowed(u.email, policy);
            if (!r.ok) return false;
            return {
              data: {
                ...u,
                hd: policy.allowedHd,
                status: 'active',
                role: isAdminEmail(u.email) ? 'admin' : 'member',
              },
            };
          },
          after: async (u) => {
            await provisionProfile(db, { id: u.id, name: u.name, email: u.email });
            await audit(db, { actorType: 'user', actorUserId: u.id, action: 'auth.user_created' });
          },
        },
      },
      account: {
        create: {
          before: async (a) => {
            // Only Google accounts can be attached (dev-login creates no account rows).
            if (a.providerId !== 'google') return false;
          },
          after: async (a) => {
            if (a.providerId === 'google') await recordGoogleSub(db, a.userId, a.accountId);
          },
        },
      },
      session: {
        create: {
          before: async (s) => {
            const found = await db.query.user.findFirst({ where: (t, { eq }) => eq(t.id, s.userId) });
            if (!found || found.status !== 'active') return false;
            if (!checkEmailAllowed(found.email, policy).ok) return false;
          },
          after: async (s) => {
            await audit(db, { actorType: 'user', actorUserId: s.userId, action: 'auth.sign_in' });
          },
        },
      },
    },
    plugins: [
      jwt({ jwks: { keyPairConfig: { alg: 'ES256' } }, disableSettingJwtHeader: true }),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource,
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        accessTokenExpiresIn: cfg.accessTokenTtlSeconds,
        refreshTokenExpiresIn: cfg.refreshTokenTtlDays * 24 * 60 * 60,
        allowDynamicClientRegistration: cfg.allowDcr,
        allowUnauthenticatedClientRegistration: cfg.allowDcr,
        clientRegistrationDefaultApplicationType: 'infer',
        // Claude registers itself through CIMD (which never reaches these hooks). Manually managed
        // clients and resources (create-client, admin endpoints, update, delete, ...) are admin-only.
        clientPrivileges: ({ user }) => isAdminUser(user),
        resourcePrivileges: ({ user }) => isAdminUser(user),
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
        isMetadataDocumentUrlAllowed: async (clientIdUrl) => {
          const ok = hostAllowed(clientIdUrl, cfg.cimdAllowedHosts);
          if (!ok) {
            await audit(db, {
              actorType: 'system',
              action: 'oauth.cimd_rejected',
              metadata: { host: safeHost(clientIdUrl) },
            });
          }
          return ok;
        },
        onClientCreated: async ({ client }) => {
          await audit(db, {
            actorType: 'system',
            action: 'oauth.client_discovered',
            oauthClientId: String((client as { clientId?: string }).clientId ?? ''),
          });
        },
      }),
      ...(cfg.devLogin ? [devLoginPlugin(cfg)] : []),
      ...(cfg.extraPlugins ?? []),
    ],
  });
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export type Auth = ReturnType<typeof createAuth>;
