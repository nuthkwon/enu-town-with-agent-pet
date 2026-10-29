import { workLogPatch } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody, uuidParam } from '@/server/http';
import { deleteOwnLog, patchOwnLog } from '@/server/queries/logs';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/v1/me/work-logs/:id (workLogPatch) -> WorkLogDto */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  const logId = uuidParam(id);
  const body = await parseBody(req, workLogPatch);
  return json(await patchOwnLog(getDb(), viewer, logId, body));
});

/** DELETE /api/v1/me/work-logs/:id -> 204 (soft delete; content is nulled immediately). */
export const DELETE = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  await deleteOwnLog(getDb(), viewer, uuidParam(id));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
