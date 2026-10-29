import { profilePatch } from '@enu/shared';
import { getDb } from '@/server/db';
import { json, parseBody } from '@/server/http';
import { buildMeDto } from '@/server/queries/me';
import { patchProfile } from '@/server/queries/profile';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/v1/me/profile (profilePatch) -> MeDto */
export const PATCH = route(async (req) => {
  const viewer = await requireViewer(req);
  const body = await parseBody(req, profilePatch);
  await patchProfile(getDb(), viewer, body);
  return json(await buildMeDto(getDb(), viewer));
});
