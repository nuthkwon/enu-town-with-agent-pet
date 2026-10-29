import { getDb } from '@/server/db';
import { channelRoute } from '@/server/pet-channel/route';
import { unpairPetChannel } from '@/server/pet-channel/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/v1/pet-channel/token -> 204: this machine unpairs itself (`enu-pet unpair`). */
export const DELETE = channelRoute(async (_req, caller) => {
  await unpairPetChannel(getDb(), caller);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
