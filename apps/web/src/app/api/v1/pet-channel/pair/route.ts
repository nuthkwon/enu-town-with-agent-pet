import { petChannelPairInput } from '@enu/shared';
import { getDb } from '@/server/db';
import { errorResponse, json, parseBody } from '@/server/http';
import { clientAddress, requireJson } from '@/server/pet-channel/route';
import { pairPetChannel } from '@/server/pet-channel/service';
import { enforceRateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/pet-channel/pair (petChannelPairInput) -> 201 PetChannelPairOutput. Unauthenticated: the one-time
 * code a person typed in a terminal (`enu-pet pair`) is the credential; limited per address and globally.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    requireJson(req);
    enforceRateLimit('*', 'channelPairGlobal');
    enforceRateLimit(`ip:${clientAddress(req)}`, 'channelPairPerIp');
    const body = await parseBody(req, petChannelPairInput);
    return json(await pairPetChannel(getDb(), body), { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
