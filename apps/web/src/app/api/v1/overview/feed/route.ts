import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { loadFeed } from '@/server/queries/overview';
import { enforceRateLimit } from '@/server/rate-limit';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/overview/feed?day=YYYY-MM-DD -> WorkLogFeedDto (ADR 0007): one office day of the company work feed,
 * the same for every viewer. `HH:MM` only for today's office-hours writes of authors who share activity.
 */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  enforceRateLimit(viewer.userId, 'overviewRead');
  return json(await loadFeed(getDb(), new URL(req.url).searchParams.get('day')));
});
