import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { loadToday } from '@/server/queries/overview';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/overview/today -> OverviewTodayDto (ADR 0007): the people with a company log today, as it is now. */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  enforceRateLimit(viewer.userId, 'overviewRead');
  return json(await loadToday(getDb()));
});
