import { deactivateUser } from '@enu/auth';
import { user } from '@enu/db';
import { eq } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { HttpError, json, notFound } from '@/server/http';
import { route } from '@/server/route';
import { requireAdmin } from '@/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/v1/admin/users/:id/deactivate -> { ok: true } (blocks sign-in, revokes tokens and links, frees the desk). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const admin = await requireAdmin(req);
  if (id === admin.userId) throw new HttpError(400, 'self_deactivate', ko.errors.selfDeactivate);
  const db = getDb();
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, id)).limit(1);
  if (!target) throw notFound();
  await deactivateUser(db, id, admin.userId);
  return json({ ok: true as const });
});
