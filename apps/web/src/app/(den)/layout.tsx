import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DenProvider } from '@/components/den/DenProvider';
import { DenShell } from '@/components/den/DenShell';
import s from '@/components/den/den.module.css';
import { ko } from '@/i18n/ko';
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
  if (!me.onboardingCompleted || !me.noticeAccepted) {
    // 내 정보 (export, unlinking Claude, settings) stays reachable before the current notice is accepted,
    // without the messenger: realtime refuses until then.
    if (/^\/me(?:[/?]|$)/.test(path)) {
      return (
        <div className={s.plain}>
          <div className={s.plainBar}>
            <span className={s.brand}>{ko.den.title}</span>
            <Link href="/welcome">{ko.den.nav.finishWelcome}</Link>
          </div>
          <main id="main" className={s.plainMain}>
            {children}
          </main>
        </div>
      );
    }
    redirect('/welcome');
  }
  return (
    <DenProvider me={me}>
      <DenShell>{children}</DenShell>
    </DenProvider>
  );
}
