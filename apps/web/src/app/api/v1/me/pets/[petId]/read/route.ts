import { petRead } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody, uuidParam } from '@/server/http';
import { markPetRead } from '@/server/queries/pet-messages';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/me/pets/:petId/read (petRead) -> { unread } (owner-only; nobody else learns it). */
export const POST = route<{ petId: string }>(async (req, { petId }) => {
  const viewer = await requireViewer(req);
  const id = uuidParam(petId);
  const body = await parseBody(req, petRead);
  enforceRateLimit(viewer.userId, 'petRead');
  return json(await markPetRead(getDb(), viewer, id, body.last_message_id.toLowerCase()));
});
