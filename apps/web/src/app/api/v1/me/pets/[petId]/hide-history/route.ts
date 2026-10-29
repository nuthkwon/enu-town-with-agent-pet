import { getDb } from '@/server/db';
import { json, uuidParam } from '@/server/http';
import { hidePetHistory } from '@/server/queries/pet-messages';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/me/pets/:petId/hide-history -> { updated } (every message of the pet becomes 나만 보기). */
export const POST = route<{ petId: string }>(async (req, { petId }) => {
  const viewer = await requireViewer(req);
  const id = uuidParam(petId);
  enforceRateLimit(viewer.userId, 'petConfig');
  return json(await hidePetHistory(getDb(), viewer, id));
});
