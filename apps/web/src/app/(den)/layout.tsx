import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DenProvider } from '@/components/den/DenProvider';
import { DenShell } from '@/components/den/DenShell';
import { safeNextPath } from '@/lib/oauth-query';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { buildMeDto } from '@/server/queries/me';

/**
 * The messenger shell around every den page: one realtime session, the town panel and the nav live here, so
 * moving between rooms keeps them. Pages below only render their room.
 */
export default async function DenLayout({ children }: { children: ReactNode }) {
  const path = safeNextPath((await headers()).get('x-den-path'), '/');
  const viewer = await requirePageViewer(path);
  const me = await buildMeDto(getDb(), viewer);
  if (!me.onboardingCompleted || !me.noticeAccepted) redirect('/welcome');
  return (
    <DenProvider me={me}>
      <DenShell>{children}</DenShell>
    </DenProvider>
  );
}
