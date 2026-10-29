import { redirect } from 'next/navigation';
import { getDb } from '@/server/db';
import { requirePageViewer } from '@/server/page-session';
import { listMyPets } from '@/server/queries/pets';

/** Opening ENU Den lands in the room with my default pet. */
export default async function Home() {
  const viewer = await requirePageViewer('/');
  const pets = await listMyPets(getDb(), viewer);
  const pet = pets.find((p) => p.isDefault) ?? pets[0];
  redirect(pet ? `/pets/${pet.id}` : '/welcome');
}
