import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { listPetsOf } from '@/server/queries/pets';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/users/:id/pets -> PetInfoDto[] (names and looks; 404 for unknown or deactivated people). */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  return json(await listPetsOf(getDb(), viewer, id));
});
