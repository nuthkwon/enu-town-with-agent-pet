import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { listDesks } from '@/server/queries/people';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/desks -> DeskDto[] (the 14 seats of 606호 in floor-plan order). */
export const GET = route(async (req) => {
  await requireViewer(req);
  return json(await listDesks(getDb()));
});
