import { getDb } from '@/server/db';
import { decodeCursor, json, parseLimit } from '@/server/http';
import { listClaudeSummaries } from '@/server/queries/logs';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/users/:id/claude-summaries?cursor -> Paginated<ClaudeSummaryDto> */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get('cursor'), 'date');
  return json(await listClaudeSummaries(getDb(), viewer, id, cursor, parseLimit(url, 10, 50)));
});
