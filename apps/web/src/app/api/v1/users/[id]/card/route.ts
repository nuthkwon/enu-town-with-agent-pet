import type { ProfileCardDto } from '@enu/shared';
import { toPersonDto } from '@/server/dto';
import { getDb } from '@/server/db';
import { json, notFound } from '@/server/http';
import { latestVisibleLog } from '@/server/queries/logs';
import { findPerson } from '@/server/queries/people';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/users/:id/card -> ProfileCardDto (404 for unknown or deactivated people). */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const viewer = await requireViewer(req);
  const db = getDb();
  const person = await findPerson(db, id);
  if (!person || (person.status !== 'active' && id !== viewer.userId)) throw notFound();
  const dto = toPersonDto(person.profile, person.deskId);
  const latestLog = await latestVisibleLog(db, viewer, id, {
    name: dto.displayName,
    active: person.status === 'active',
  });
  const body: ProfileCardDto = { person: dto, latestLog, stale: dto.linkState === 'stale' };
  return json(body);
});
