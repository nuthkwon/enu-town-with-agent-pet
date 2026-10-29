import { getDb } from '@/server/db';
import { decodeCursor, json, parseLimit, uuidParam } from '@/server/http';
import { PET_THREAD_PAGE, ownerPetThread } from '@/server/queries/pet-messages';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/pets/:petId/thread?cursor&limit -> PetThreadPageDto<OwnerPetMessageDto> (newest page first). */
export const GET = route<{ petId: string }>(async (req, { petId }) => {
  const viewer = await requireViewer(req);
  const id = uuidParam(petId);
  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'micros');
  return json(
    await ownerPetThread(
      getDb(),
      viewer,
      id,
      cursor,
      parseLimit(url, PET_THREAD_PAGE.def, PET_THREAD_PAGE.max),
    ),
  );
});
