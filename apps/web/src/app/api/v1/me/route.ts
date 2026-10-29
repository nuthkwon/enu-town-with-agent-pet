import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { buildMeDto } from '@/server/queries/me';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me -> MeDto */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  return json(await buildMeDto(getDb(), viewer));
});
