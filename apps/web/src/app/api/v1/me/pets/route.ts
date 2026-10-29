import { petCreate } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody } from '@/server/http';
import { createPet, listMyPets } from '@/server/queries/pets';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/pets -> OwnerPetDto[] (my pets, the default pet first). */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  return json(await listMyPets(getDb(), viewer));
});

/** POST /api/v1/me/pets (petCreate) -> 201 OwnerPetDto; 409 pet_limit | look_taken. */
export const POST = route(async (req) => {
  const viewer = await requireViewer(req);
  const body = await parseBody(req, petCreate);
  enforceRateLimit(viewer.userId, 'petConfig');
  return json(await createPet(getDb(), viewer, body), { status: 201 });
});
