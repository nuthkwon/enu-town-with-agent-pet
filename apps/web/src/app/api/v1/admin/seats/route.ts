import { seatAssign } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody } from '@/server/http';
import { adminSeats, assignSeat } from '@/server/queries/admin';
import { route } from '@/server/route';
import { requireAdmin } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/admin/seats -> AdminSeatsDto (admins only). */
export const GET = route(async (req) => {
  await requireAdmin(req);
  return json(await adminSeats(getDb()));
});

/** POST /api/v1/admin/seats ({ desk_id, user_id | null }) -> AdminSeatsDto */
export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, seatAssign);
  const db = getDb();
  await assignSeat(db, admin, body.desk_id, body.user_id);
  return json(await adminSeats(db));
});
