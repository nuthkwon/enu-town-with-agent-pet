import { revokeClaudeLinks } from '@enu/auth';
import { claudeLinkRevoke } from '@enu/shared';
import { getDb } from '@/server/db';
import { isUuid, json, notFound, parseBody } from '@/server/http';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/me/claude-links/revoke ({ link_id? }) -> { revoked } (one grant, or all when omitted). */
export const POST = route(async (req) => {
  const viewer = await requireViewer(req);
  const body = await parseBody(req, claudeLinkRevoke);
  if (body.link_id !== undefined && !isUuid(body.link_id)) throw notFound();
  const revoked = await revokeClaudeLinks(getDb(), viewer.userId, { linkId: body.link_id, actor: 'user', reason: 'user_revoked' });
  return json({ revoked });
});
