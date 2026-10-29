import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DmRoom } from '@/components/den/rooms/DmRoom';
import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { listPeople } from '@/server/queries/people';

export const metadata: Metadata = { title: ko.den.nav.rooms };

export default async function DmPage({ params }: { params: Promise<{ peerId: string }> }) {
  const { peerId } = await params;
  const viewer = await requirePageViewer(`/dm/${encodeURIComponent(peerId)}`);
  if (peerId === viewer.userId) notFound();
  const peer = (await listPeople(getDb())).find((p) => p.userId === peerId);
  if (!peer) notFound();
  return <DmRoom peerId={peerId} />;
}
