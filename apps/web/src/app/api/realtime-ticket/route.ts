import { newId } from '@enu/db';
import { REALTIME_TICKET_AUDIENCE, REALTIME_TICKET_TTL_SECONDS, type RealtimeTicketDto } from '@enu/shared';
import { SignJWT } from 'jose';
import { getEnv } from '@/server/env';
import { json } from '@/server/http';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

/** Short-lived (60 s) HS256 ticket the browser presents to the realtime server. Never cached. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  const env = getEnv();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + REALTIME_TICKET_TTL_SECONDS;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(viewer.userId)
    .setAudience(REALTIME_TICKET_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(newId())
    .sign(new TextEncoder().encode(env.REALTIME_TICKET_SECRET));
  const body: RealtimeTicketDto = {
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
    wsUrl: env.REALTIME_PUBLIC_URL,
  };
  return json(body, { headers: { 'cache-control': 'no-store, private' } });
});
