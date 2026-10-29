import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { decodeCursor, json, parseLimit } from '@/server/http';
import { listLogs } from '@/server/queries/logs';
import { methodNotAllowed, route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/work-logs?cursor -> Paginated<WorkLogDto> (my logs, newest day first). */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'date');
  return json(await listLogs(getDb(), viewer, viewer.userId, cursor, parseLimit(url, 20, 50)));
});

/** Work logs are written only by the owner's Claude (MCP post_work_log), never from the web. */
export async function POST(): Promise<Response> {
  return methodNotAllowed('GET', ko.errors.workLogPost);
}
