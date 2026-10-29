import { desks, profiles, user } from '@enu/db';
import { avatarSpriteKey } from '@enu/shared';
import { and, asc, eq, like } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ko } from '@/i18n/ko';
import { safeNextPath, signedOAuthQuery, toSearchParams } from '@/lib/oauth-query';
import { devLoginEnabled } from '@/server/auth';
import { normalizeAvatar } from '@/server/dto';
import { getDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { getPageViewer } from '@/server/page-session';
import { SignInPanel, type DevUser } from './SignInPanel';

export const metadata: Metadata = { title: '로그인' };

async function listDevUsers(hd: string): Promise<DevUser[]> {
  const rows = await getDb()
    .select({
      email: user.email,
      name: profiles.displayName,
      avatar: profiles.avatar,
      team: profiles.team,
      deskId: desks.deskId,
      role: user.role,
    })
    .from(user)
    .innerJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(desks, eq(desks.userId, user.id))
    .where(and(like(user.email, `dev.%@${hd}`), eq(user.status, 'active')))
    .orderBy(asc(desks.deskId), asc(user.email));
  return rows.map((r) => {
    const avatar = normalizeAvatar(r.avatar);
    return {
      email: r.email,
      name: r.name,
      avatar,
      avatarKey: avatarSpriteKey(avatar),
      deskId: r.deskId ?? null,
      isAdmin: r.role === 'admin',
    };
  });
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = toSearchParams(await searchParams);
  const env = getEnv();
  const oauthQuery = signedOAuthQuery(sp);
  const next = safeNextPath(sp.get('next'));
  const viewer = await getPageViewer();
  // Already signed in and not in the middle of a connector login: go on.
  if (viewer && !oauthQuery) redirect(next);

  const dev = devLoginEnabled();
  const devUsers = dev ? await listDevUsers(env.ALLOWED_GOOGLE_HD) : [];
  const error = sp.get('error');
  return (
    <SignInPanel
      hd={env.ALLOWED_GOOGLE_HD}
      googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
      devLogin={dev}
      devUsers={devUsers}
      next={next}
      connectorFlow={Boolean(oauthQuery)}
      errorMessage={error ? (ko.signIn.errors[error] ?? ko.signIn.errorDefault) : null}
      signedOut={sp.get('signed_out') === '1'}
    />
  );
}
