import { getDb } from '@/server/db';
import { decodeCursor, json, parseLimit } from '@/server/http';
import { roomChat } from '@/server/queries/chat';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/chat/room?before -> Paginated<ChatItemDto> (chronological page, older via nextCursor). */
export const GET = route(async (req) => {
  await requireViewer(req);
  const url = new URL(req.url);
  const cursor = decodeCursor(url.searchParams.get('before'), 'micros');
  return json(await roomChat(getDb(), cursor, parseLimit(url, 50, 100)));
});
