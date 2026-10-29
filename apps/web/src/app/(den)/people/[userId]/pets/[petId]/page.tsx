import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ColleaguePetRoom } from '@/components/den/pet/ColleaguePetRoom';
import { ko } from '@/i18n/ko';
import { getDb } from '@/server/db';
import { HttpError } from '@/server/http';
import { requirePageViewer } from '@/server/page-session';
import { listPeople } from '@/server/queries/people';
import { listPetsOf } from '@/server/queries/pets';

export const metadata: Metadata = { title: ko.den.colleague.pets };

/**
 * A colleague's pet room. Only names and looks are rendered on the server; the thread itself is fetched by the
 * client from the colleague API (company messages, dates only), so this payload never carries a time.
 */
export default async function ColleaguePetPage({
  params,
}: {
  params: Promise<{ userId: string; petId: string }>;
}) {
  const { userId, petId } = await params;
  const viewer = await requirePageViewer(
    `/people/${encodeURIComponent(userId)}/pets/${encodeURIComponent(petId)}`,
  );
  const db = getDb();
  const owner = (await listPeople(db)).find((p) => p.userId === userId);
  if (!owner) notFound();
  const pets = await listPetsOf(db, viewer, userId).catch((e: unknown) => {
    if (e instanceof HttpError) notFound();
    throw e;
  });
  const pet = pets.find((p) => p.id === petId);
  if (!pet) notFound();
  return <ColleaguePetRoom ownerId={userId} ownerName={owner.displayName} pet={pet} />;
}
