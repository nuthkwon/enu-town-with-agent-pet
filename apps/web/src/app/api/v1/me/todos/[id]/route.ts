import { todoPatch } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody, uuidParam } from '@/server/http';
import { patchTodo } from '@/server/queries/todos';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/v1/me/todos/:id (todoPatch) -> TodoDto; the user's status wins (status_source='user'). */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  const todoId = uuidParam(id);
  const body = await parseBody(req, todoPatch);
  return json(await patchTodo(getDb(), viewer, todoId, body));
});
