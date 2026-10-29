import { getDb } from '@/server/db';
import { decodeCursor, json, parseLimit } from '@/server/http';
import { listLogs } from '@/server/queries/logs';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/users/:id/work-logs?cursor -> Paginated<WorkLogDto> (only logs the viewer may see). */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'date');
  return json(await listLogs(getDb(), viewer, id, cursor, parseLimit(url, 10, 50)));
});
