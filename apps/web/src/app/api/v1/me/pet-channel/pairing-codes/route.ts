import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { createPairingCode } from '@/server/pet-channel/service';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/me/pet-channel/pairing-codes -> 201 PetChannelPairingCodeDto (single use, 10 minutes). */
export const POST = route(async (req) => {
  const viewer = await requireViewer(req);
  enforceRateLimit(viewer.userId, 'pairingCodes');
  return json(await createPairingCode(getDb(), viewer), { status: 201 });
});
