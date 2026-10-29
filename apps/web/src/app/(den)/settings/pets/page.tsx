import type { Metadata } from 'next';
import { PetSettings } from '@/components/den/settings/PetSettings';
import { ko } from '@/i18n/ko';

export const metadata: Metadata = { title: ko.den.nav.petSettings };

export default function PetSettingsPage() {
  return <PetSettings />;
}
