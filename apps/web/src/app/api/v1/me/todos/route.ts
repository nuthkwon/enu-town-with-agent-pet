import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { listTodos } from '@/server/queries/todos';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/todos -> TodoDto[] (open/snoozed first, then closed in the last 7 days). */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  return json(await listTodos(getDb(), viewer.userId));
});
