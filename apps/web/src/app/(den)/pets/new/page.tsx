import type { Metadata } from 'next';
import { NewPetWizard } from '@/components/den/pet/NewPetWizard';
import { ko } from '@/i18n/ko';

export const metadata: Metadata = { title: ko.den.newPet.title };

export default function NewPetPage() {
  return <NewPetWizard />;
}
