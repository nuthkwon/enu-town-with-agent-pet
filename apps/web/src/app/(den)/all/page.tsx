import type { Metadata } from 'next';
import { AllRoom } from '@/components/den/rooms/AllRoom';
import { ko } from '@/i18n/ko';

export const metadata: Metadata = { title: ko.den.room.allTitle };

export default function AllPage() {
  return <AllRoom />;
}
