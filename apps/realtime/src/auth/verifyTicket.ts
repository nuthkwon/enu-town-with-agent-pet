import type { DbOrTx } from '@enu/db';
import { REALTIME_TICKET_AUDIENCE } from '@enu/shared';
import { errors, jwtVerify } from 'jose';
import { emailInDomain, loadUserSnapshot, type UserSnapshot } from '../infra/profiles';

/** What the room knows about an authenticated connection (`client.auth`; never sent to clients). */
export type AuthData = Omit<UserSnapshot, 'status'>;

export type TicketRejectReason =
  | 'missing_ticket'
  | 'invalid_ticket'
  | 'expired_ticket'
  | 'unknown_user'
  | 'user_inactive'
  | 'domain_not_allowed';

export class TicketError extends Error {
  constructor(readonly reason: TicketRejectReason) {
    super(reason);
    this.name = 'TicketError';
  }
}

export interface VerifyTicketDeps {
  secret: string;
  allowedHd: string;
  db: DbOrTx;
  /** Override "now" for JWT time checks (tests). Defaults to the real time. */
  currentDate?: Date;
}

/**
 * Verifies the short-lived HS256 ticket minted by the web app, then re-reads the user from the DB
 * (active, allowed e-mail domain) so a revoked or deactivated account cannot join with an old ticket.
 */
export async function verifyTicket(
  token: string | null | undefined,
  deps: VerifyTicketDeps,
): Promise<AuthData> {
  if (!token) throw new TicketError('missing_ticket');

  let sub: string;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(deps.secret), {
      algorithms: ['HS256'],
      audience: REALTIME_TICKET_AUDIENCE,
      maxTokenAge: '2m',
      clockTolerance: 30,
      requiredClaims: ['sub', 'iat', 'exp'],
      currentDate: deps.currentDate,
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 64) {
      throw new TicketError('invalid_ticket');
    }
    sub = payload.sub;
  } catch (err) {
    if (err instanceof TicketError) throw err;
    if (err instanceof errors.JWTExpired) throw new TicketError('expired_ticket');
    throw new TicketError('invalid_ticket');
  }

  const snapshot = await loadUserSnapshot(deps.db, sub);
  if (!snapshot) throw new TicketError('unknown_user');
  if (snapshot.status !== 'active') throw new TicketError('user_inactive');
  if (!emailInDomain(snapshot.email, deps.allowedHd)) throw new TicketError('domain_not_allowed');

  const { status: _status, ...auth } = snapshot;
  return auth;
}

/** Origin allow-list check shared by the matchmake `onAuth` and the WebSocket `beforeUpgrade` hook. */
export function isOriginAllowed(origin: string | null | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return false;
  return allowed.includes(origin);
}
