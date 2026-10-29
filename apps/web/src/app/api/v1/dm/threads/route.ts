import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { dmThreads } from '@/server/queries/chat';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/dm/threads -> DmThreadDto[] (most recent first). */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  return json(await dmThreads(getDb(), viewer.userId));
});
