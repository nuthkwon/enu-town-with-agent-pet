import type { DbHandle } from '@enu/db';
import { setupTestDb, truncateAll } from '@enu/testing';
import { expect } from 'vitest';
import { POST as authPost, GET as authGet } from '@/app/api/auth/[...all]/route';

export const ORIGIN = 'http://localhost:3000';

/** Tables seeded once per Better Auth instance (oauth resource row, signing keys). */
export const KEEP_TABLES = ['oauth_resource', 'jwks'] as const;

export async function freshDb(h?: DbHandle): Promise<DbHandle> {
  const handle = h ?? (await setupTestDb());
  await truncateAll(handle.db, { keep: KEEP_TABLES });
  return handle;
}

/** Signs in through the real dev-login endpoint (auth.handler) and returns the session cookie. */
export async function devLogin(email: string, oauthQuery?: string): Promise<{ cookie: string; body: unknown }> {
  const res = await authPost(
    new Request(`${ORIGIN}/api/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(oauthQuery ? { email, oauth_query: oauthQuery } : { email }),
    }),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cookie, body: await res.json() };
}

export { authGet, authPost };

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

export interface CallOptions<P> {
  method?: string;
  cookie?: string;
  body?: unknown;
  params?: P;
  origin?: string | null;
  headers?: Record<string, string>;
}

/** Calls a route handler in-process like Next would (Request + awaited params). */
export async function call<P extends Record<string, string | string[] | undefined>>(
  handler: Handler<P>,
  path: string,
  opts: CallOptions<P> = {},
): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.origin !== null && method !== 'GET') headers.set('origin', opts.origin ?? ORIGIN);
  if (opts.body !== undefined) headers.set('content-type', 'application/json');
  const req = new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return handler(req, { params: Promise.resolve((opts.params ?? {}) as P) });
}

export async function jsonOf<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
