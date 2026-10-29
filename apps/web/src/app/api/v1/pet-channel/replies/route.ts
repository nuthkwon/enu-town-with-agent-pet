import { postPetReplies } from '@enu/mcp-tools';
import { petChannelReplyInput, type PetChannelReplyOutput } from '@enu/shared';
import { getDb } from '@/server/db';
import { HttpError, json, parseBody } from '@/server/http';
import { channelRoute } from '@/server/pet-channel/route';
import { enforceRateLimit } from '@/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/pet-channel/replies (petChannelReplyInput) -> PetChannelReplyOutput: one reply part through the
 * shared reply core. A message the owner deleted is `skipped_owner_deleted`; any other refusal is 422 with the
 * reason (text problems: rewrite; already_answered and route_not_allowed: do not retry).
 */
export const POST = channelRoute(async (req, caller) => {
  const body = await parseBody(req, petChannelReplyInput);
  enforceRateLimit(caller.userId, 'channelReply');
  const [outcome] = await postPetReplies(
    getDb(),
    {
      userId: caller.userId,
      clientId: caller.clientId,
      source: 'claude_code_channel',
      tokenId: caller.tokenId,
    },
    [
      {
        inReplyTo: body.in_reply_to.toLowerCase(),
        text: body.text,
        part: body.part,
        ...(body.visibility ? { visibility: body.visibility } : {}),
      },
    ],
    new Date(),
  );
  if (!outcome) throw new Error('reply core returned nothing');
  let out: PetChannelReplyOutput;
  if (outcome.ok) {
    out = { result: outcome.result, message_id: outcome.messageId, visibility: outcome.visibility };
  } else if (outcome.reason === 'unknown_message') {
    out = { result: 'skipped_owner_deleted', message_id: null, visibility: null };
  } else {
    throw new HttpError(422, outcome.reason, outcome.detail);
  }
  return json(out, { status: out.result === 'created' ? 201 : 200 });
});
