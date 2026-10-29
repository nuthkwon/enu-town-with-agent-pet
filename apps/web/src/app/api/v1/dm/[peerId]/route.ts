import { getDb } from '@/server/db';
import { decodeCursor, json, parseLimit } from '@/server/http';
import { chatHistory } from '@/server/queries/chat';
import { requireVisibleAuthor } from '@/server/queries/logs';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/dm/:peerId?before -> Paginated<ChatItemDto> (DMs with that person). */
export const GET = route<{ peerId: string }>(async (req, { peerId }) => {
  const viewer = await requireViewer(req);
  const db = getDb();
  await requireVisibleAuthor(db, viewer, peerId);
  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get('before'), 'micros');
  return json(await chatHistory(db, viewer.userId, peerId, 'dm', cursor, parseLimit(url, 50, 100)));
});
