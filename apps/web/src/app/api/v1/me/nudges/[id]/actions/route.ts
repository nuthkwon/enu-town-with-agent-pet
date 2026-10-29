import { nudgeAction } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody, uuidParam } from '@/server/http';
import { applyNudgeAction } from '@/server/queries/nudges';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/me/nudges/:id/actions (nudgeAction) -> NudgeDto */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  const nudgeId = uuidParam(id);
  const body = await parseBody(req, nudgeAction);
  return json(await applyNudgeAction(getDb(), viewer, nudgeId, body));
});
