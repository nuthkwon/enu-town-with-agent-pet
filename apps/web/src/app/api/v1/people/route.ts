import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { listPeople } from '@/server/queries/people';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/people -> PersonDto[] (active colleagues). */
export const GET = route(async (req) => {
  await requireViewer(req);
  return json(await listPeople(getDb()));
});
