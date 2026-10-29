import { audit } from '@enu/db';
import { getDb } from '@/server/db';
import { buildExport } from '@/server/queries/export';
import { route } from '@/server/route';
import { requireViewer } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/me/export -> JSON attachment with all of my data (none of other people's). */
export const GET = route(async (req) => {
  const viewer = await requireViewer(req);
  const db = getDb();
  const now = new Date();
  const data = await buildExport(db, viewer.userId, now);
  await audit(db, { actorType: 'user', actorUserId: viewer.userId, action: 'me.export' });
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="enu-den-export-${stamp}.json"`,
      'cache-control': 'no-store, private',
    },
  });
});
