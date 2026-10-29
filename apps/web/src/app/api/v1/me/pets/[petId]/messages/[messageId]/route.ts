import { petMessagePatch } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody, uuidParam } from '@/server/http';
import { deletePetMessage, setPetMessageVisibility } from '@/server/queries/pet-messages';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { petId: string; messageId: string };

/** PATCH /api/v1/me/pets/:petId/messages/:messageId (petMessagePatch) -> OwnerPetMessageDto (the owner decides). */
export const PATCH = route<Params>(async (req, { petId, messageId }) => {
  const viewer = await requireViewer(req);
  const ids = { pet: uuidParam(petId), message: uuidParam(messageId) };
  const body = await parseBody(req, petMessagePatch);
  enforceRateLimit(viewer.userId, 'petMessageEdit');
  return json(await setPetMessageVisibility(getDb(), viewer, ids.pet, ids.message, body.visibility));
});

/** DELETE /api/v1/me/pets/:petId/messages/:messageId -> 204 (my message takes its replies with it). */
export const DELETE = route<Params>(async (req, { petId, messageId }) => {
  const viewer = await requireViewer(req);
  const ids = { pet: uuidParam(petId), message: uuidParam(messageId) };
  enforceRateLimit(viewer.userId, 'petMessageEdit');
  await deletePetMessage(getDb(), viewer, ids.pet, ids.message);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
