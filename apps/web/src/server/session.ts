import { ko } from '@/i18n/ko';
import { getAuth, isAdminEmail } from './auth';
import { HttpError } from './http';

/** The signed-in person behind a request (session cookie), with ENU Town's account fields. */
export interface Viewer {
  userId: string;
  email: string;
  name: string;
  role: string;
  isAdmin: boolean;
  sessionId: string;
}

interface SessionUserFields {
  id: string;
  email: string;
  name: string;
  status?: string | null;
  role?: string | null;
}

export function isAdmin(u: { role?: string | null; email: string }): boolean {
  return u.role === 'admin' || isAdminEmail(u.email);
}

/** Session + user for these request headers, or null (no/expired cookie, deactivated user). */
export async function getViewer(headers: Headers): Promise<Viewer | null> {
  const s = await getAuth().api.getSession({ headers });
  if (!s) return null;
  const u = s.user as unknown as SessionUserFields;
  if (u.status && u.status !== 'active') return null;
  return {
    userId: u.id,
    email: u.email,
    name: u.name,
    role: u.role ?? 'member',
    isAdmin: isAdmin({ role: u.role, email: u.email }),
    sessionId: s.session.id,
  };
}

/** For route handlers: 401 JSON when there is no valid session. */
export async function requireViewer(req: Request): Promise<Viewer> {
  const v = await getViewer(req.headers);
  if (!v) throw new HttpError(401, 'unauthorized', ko.errors.unauthorized);
  return v;
}

/** For admin route handlers: 401 without a session, 403 for members. */
export async function requireAdmin(req: Request): Promise<Viewer> {
  const v = await requireViewer(req);
  if (!v.isAdmin) throw new HttpError(403, 'forbidden', ko.errors.adminOnly);
  return v;
}
