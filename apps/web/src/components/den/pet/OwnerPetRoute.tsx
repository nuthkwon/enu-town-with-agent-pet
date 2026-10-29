'use client';

import Link from 'next/link';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { useDen } from '../DenProvider';
import { OwnerPetRoom } from './OwnerPetRoom';
import s from '../den.module.css';

/** /pets/[petId]: one of my pets, taken from the list the shell keeps fresh (unread counts, renames). */
export function OwnerPetRoute({ petId }: { petId: string }) {
  const { pets, petsError, reloadPets } = useDen();
  if (!pets) {
    return (
      <div className={s.empty} role={petsError ? 'alert' : 'status'}>
        {petsError ? (
          <>
            <p>{ko.den.pet.loadFailed}</p>
            <Button size="sm" onClick={() => void reloadPets()}>
              {ko.common.retry}
            </Button>
          </>
        ) : (
          ko.common.loading
        )}
      </div>
    );
  }
  const pet = pets.find((p) => p.id === petId);
  if (!pet) {
    return (
      <div className={s.empty}>
        <p>{ko.den.pet.notFound}</p>
        <Link href="/">{ko.den.pet.backHome}</Link>
      </div>
    );
  }
  return <OwnerPetRoom key={pet.id} pet={pet} />;
}
