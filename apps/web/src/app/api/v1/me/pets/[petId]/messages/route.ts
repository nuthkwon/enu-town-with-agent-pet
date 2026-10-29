import { petMessageSend } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody, uuidParam } from '@/server/http';
import { sendPetMessage } from '@/server/queries/pet-messages';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/me/pets/:petId/messages (petMessageSend) -> 201 OwnerPetMessageDto, or 200 with the stored message
 * for a repeated client_msg_id; 422 pii_public when a company-visible message contains personal data.
 */
export const POST = route<{ petId: string }>(async (req, { petId }) => {
  const viewer = await requireViewer(req);
  const id = uuidParam(petId);
  const body = await parseBody(req, petMessageSend);
  enforceRateLimit(viewer.userId, 'petMessageSend');
  const { created, message } = await sendPetMessage(getDb(), viewer, id, body);
  return json(message, { status: created ? 201 : 200 });
});
