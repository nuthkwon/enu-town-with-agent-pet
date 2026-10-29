import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PersonPage } from '@/components/den/people/PersonPage';
import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { listPeople } from '@/server/queries/people';

export const metadata: Metadata = { title: ko.den.nav.people };

export default async function PersonRoute({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  await requirePageViewer(`/people/${encodeURIComponent(userId)}`);
  const person = (await listPeople(getDb())).find((p) => p.userId === userId);
  if (!person) notFound();
  return <PersonPage person={person} />;
}
