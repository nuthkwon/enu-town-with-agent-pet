import { defaultPetOf } from '@enu/db';
import type { MyPetDto } from '@enu/shared';
import { mcpResource } from '@/server/auth';
import { asLinkState, petOrDefault } from '@/server/dto';
import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { listClaudeLinks } from '@/server/queries/links';
import { ensureProfile } from '@/server/queries/me';
import { listActiveNudges } from '@/server/queries/nudges';
import { listTodos } from '@/server/queries/todos';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/pet -> MyPetDto (my pet panel: open to-dos, active bubbles, links, connector URL). */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  const db = getDb();
  const p = await ensureProfile(db, viewer);
  const now = new Date();
  const [todos, nudges, links, pet] = await Promise.all([
    listTodos(db, viewer.userId, now, { activeOnly: true }),
    listActiveNudges(db, viewer.userId, now),
    listClaudeLinks(db, viewer.userId, { activeOnly: true }),
    defaultPetOf(db, viewer.userId),
  ]);
  const body: MyPetDto = {
    pet: petOrDefault(pet),
    linkState: asLinkState(p.linkState),
    lastWorkLogAt: p.lastWorkLogAt ? p.lastWorkLogAt.toISOString() : null,
    todos,
    nudges,
    links,
    mcpUrl: mcpResource(),
  };
  return json(body);
});
