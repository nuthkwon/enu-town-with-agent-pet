import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { HttpError, decodeCursor, json, parseLimit } from '@/server/http';
import { chatHistory, type HistoryKind } from '@/server/queries/chat';
import { requireVisibleAuthor } from '@/server/queries/logs';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: readonly HistoryKind[] = ['dm', 'nearby', 'room'];

/**
 * GET /api/v1/users/:id/chat-history?kind=dm|nearby|room&before -> Paginated<ChatItemDto>
 * Items are chronological within a page; nextCursor (pass as ?before=) loads older messages.
 */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') as HistoryKind | null;
  if (!kind || !KINDS.includes(kind)) {
    throw new HttpError(400, 'invalid_query', ko.errors.invalidQuery, [
      { field: 'kind', reason: 'invalid_value' },
    ]);
  }
  const db = getDb();
  await requireVisibleAuthor(db, viewer, id);
  const cursor = decodeCursor(url.searchParams.get('before'), 'micros');
  return json(await chatHistory(db, viewer.userId, id, kind, cursor, parseLimit(url, 30, 100)));
});
