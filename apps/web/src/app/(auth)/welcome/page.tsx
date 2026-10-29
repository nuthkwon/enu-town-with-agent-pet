import { AVATAR_SWATCHES } from '@enu/sprites';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { buildMeDto } from '@/server/queries/me';
import { listDesks } from '@/server/queries/people';
import { WelcomeWizard } from './WelcomeWizard';

export const metadata: Metadata = { title: '시작하기' };

export default async function WelcomePage() {
  const viewer = await requirePageViewer('/welcome');
  const db = getDb();
  const me = await buildMeDto(db, viewer);
  if (me.onboardingCompleted && me.noticeAccepted) redirect('/town');
  const desks = await listDesks(db);
  return <WelcomeWizard me={me} desks={desks} swatches={AVATAR_SWATCHES} />;
}
