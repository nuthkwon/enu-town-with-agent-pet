import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { petChannelStatus } from '@/server/pet-channel/service';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/pet-channel/status -> PetChannelStatusDto (owner only; `live` comes from memory, never stored). */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  return json(await petChannelStatus(getDb(), viewer));
});
