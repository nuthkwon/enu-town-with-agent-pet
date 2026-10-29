import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import TownClient from '@/components/town/TownClient';
import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { buildMeDto } from '@/server/queries/me';

export const metadata: Metadata = { title: ko.nav.town };

export default async function TownPage() {
  const viewer = await requirePageViewer('/town');
  const me = await buildMeDto(getDb(), viewer);
  if (!me.onboardingCompleted || !me.noticeAccepted) redirect('/welcome');
  return <TownClient me={me} />;
}
