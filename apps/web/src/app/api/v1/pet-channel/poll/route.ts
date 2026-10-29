import { petChannelPollInput } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody } from '@/server/http';
import { channelRoute } from '@/server/pet-channel/route';
import { pollPetChannel } from '@/server/pet-channel/service';
import { enforceRateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/pet-channel/poll (petChannelPollInput) -> PetChannelPollOutput. Long-poll (up to 25 s) for owner
 * messages this machine may answer; it claims them for 10 minutes. Never audited or logged per user.
 */
export const POST = channelRoute(async (req, caller) => {
  const body = await parseBody(req, petChannelPollInput);
  enforceRateLimit(caller.userId, 'channelPoll');
  return json(await pollPetChannel(getDb(), caller, body, req.signal));
});
