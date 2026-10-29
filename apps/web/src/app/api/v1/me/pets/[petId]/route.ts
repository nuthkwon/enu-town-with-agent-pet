import { petPatch } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody, uuidParam } from '@/server/http';
import { deletePet, patchPet } from '@/server/queries/pets';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/v1/me/pets/:petId (petPatch) -> OwnerPetDto; 409 pet_taken | look_taken. */
export const PATCH = route<{ petId: string }>(async (req, { petId }) => {
  const viewer = await requireViewer(req);
  const id = uuidParam(petId);
  const body = await parseBody(req, petPatch);
  enforceRateLimit(viewer.userId, 'petConfig');
  return json(await patchPet(getDb(), viewer, id, body));
});

/** DELETE /api/v1/me/pets/:petId -> 204 (its conversation goes with it); 409 default_pet. */
export const DELETE = route<{ petId: string }>(async (req, { petId }) => {
  const viewer = await requireViewer(req);
  const id = uuidParam(petId);
  enforceRateLimit(viewer.userId, 'petConfig');
  await deletePet(getDb(), viewer, id);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
