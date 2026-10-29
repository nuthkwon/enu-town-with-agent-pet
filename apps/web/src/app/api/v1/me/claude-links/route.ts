import { getDb } from '@/server/db';
import { json } from '@/server/http';
import { listClaudeLinks } from '@/server/queries/links';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/claude-links -> ClaudeLinkDto[] */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  return json(await listClaudeLinks(getDb(), viewer.userId));
});
