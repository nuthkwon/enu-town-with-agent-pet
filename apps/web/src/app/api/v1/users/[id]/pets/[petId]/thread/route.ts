import { getDb } from '@/server/db';
import { decodeCursor, json, parseLimit, uuidParam } from '@/server/http';
import { PET_THREAD_PAGE, colleaguePetThread } from '@/server/queries/pet-messages';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/users/:id/pets/:petId/thread?cursor -> PetThreadPageDto<ColleaguePetMessageDto>: company messages with
 * the date only (no time, no answer or read state). The owner gets the same view (preview).
 */
export const GET = route<{ id: string; petId: string }>(async (req, { id, petId }) => {
  const viewer = await requireViewer(req);
  const pet = uuidParam(petId);
  enforceRateLimit(viewer.userId, 'colleaguePetThread');
  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'ref');
  return json(
    await colleaguePetThread(
      getDb(),
      viewer,
      id,
      pet,
      cursor,
      parseLimit(url, PET_THREAD_PAGE.def, PET_THREAD_PAGE.max),
    ),
  );
});
