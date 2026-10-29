import type { Metadata } from 'next';
import { OwnerPetRoute } from '@/components/den/pet/OwnerPetRoute';
import { ko } from '@/i18n/ko';

export const metadata: Metadata = { title: ko.den.nav.myPets };

export default async function PetRoomPage({ params }: { params: Promise<{ petId: string }> }) {
  const { petId } = await params;
  return <OwnerPetRoute petId={petId} />;
}
